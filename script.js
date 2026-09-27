import * as THREE from 'three';

// ---------- helpers ----------
const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, '0');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const D = ms => reduceMotion ? 1 : ms; // shrink every animated duration when motion is reduced
const ease = t => 1 - Math.pow(1 - t, 3);
function tween(ms, fn) {
  return new Promise(done => {
    const t0 = performance.now();
    (function tick(now) {
      const t = Math.min(1, (now - t0) / ms);
      fn(ease(t));
      t < 1 ? requestAnimationFrame(tick) : done();
    })(t0);
  });
}

// ---------- search: town/state/year/season, matched against a precomputed string per item ----------
// meteorological seasons, indexed by Date#getMonth() (0 = Jan)
const SEASON_BY_MONTH = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'fall', 'fall', 'fall', 'winter'];
const STATE_NAME = { al: 'alabama', ak: 'alaska', az: 'arizona', ar: 'arkansas', ca: 'california', co: 'colorado', ct: 'connecticut', de: 'delaware', fl: 'florida', ga: 'georgia', hi: 'hawaii', id: 'idaho', il: 'illinois', in: 'indiana', ia: 'iowa', ks: 'kansas', ky: 'kentucky', la: 'louisiana', me: 'maine', md: 'maryland', ma: 'massachusetts', mi: 'michigan', mn: 'minnesota', ms: 'mississippi', mo: 'missouri', mt: 'montana', ne: 'nebraska', nv: 'nevada', nh: 'new hampshire', nj: 'new jersey', nm: 'new mexico', ny: 'new york', nc: 'north carolina', nd: 'north dakota', oh: 'ohio', ok: 'oklahoma', or: 'oregon', pa: 'pennsylvania', ri: 'rhode island', sc: 'south carolina', sd: 'south dakota', tn: 'tennessee', tx: 'texas', ut: 'utah', vt: 'vermont', va: 'virginia', wa: 'washington', wv: 'west virginia', wi: 'wisconsin', wy: 'wyoming', dc: 'district of columbia' };

// ---------- three.js: nothing but the sphere you step into ----------
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 200);
camera.rotation.order = 'YXZ';
const loader = new THREE.TextureLoader();

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

// Inverted sphere the camera sits at the center of.
const sphere = new THREE.Mesh(
  new THREE.SphereGeometry(50, 96, 48).scale(-1, 1, 1),
  new THREE.MeshBasicMaterial({ depthWrite: false })
);
sphere.rotation.y = -Math.PI / 2; // matches the thumbnail crop's horizon-centered framing
sphere.visible = false;
scene.add(sphere);

// ---------- state ----------
let items = [];
let mode = 'browse'; // browse | entering | pano | leaving
let active = -1;
let lon = 0, lat = 0, vLon = 0, vLat = 0; // look direction inside a pano (degrees)

// ---------- DOM ----------
const browseEl = $('browse'), viewerEl = $('viewer'), entriesEl = $('entries');
const detailPhoto = $('detailPhoto'), detailImg = $('detailImg'), detailTitle = $('detailTitle'), detailMeta = $('detailMeta');
const searchBox = $('search'), searchClear = $('searchClear'), searchCount = $('searchCount');
const compassWrap = $('compassWrap'), backBtn = $('back'), hintEl = $('hint');
const mapEl = $('map'), sortDirBtn = $('sortDir'), factsEl = $('detailFacts');
const phoneLayout = matchMedia('(max-width: 780px)'); // no detail pane there: tapping a row steps straight in

function metaLine(it) {
  return [it.date, it.time, it.alt && it.alt + ' up'].filter(Boolean);
}
function fillMeta(el, it) {
  el.replaceChildren(...metaLine(it).map(t => Object.assign(document.createElement('span'), { textContent: t })));
}

// "Sep 19, 2026" + "4:10 pm" -> Date, parsed by hand so Safari and Chrome agree
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
function parseWhen(it) {
  const d = /([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/i.exec(it.date || '');
  if (!d || MONTHS[d[1].toLowerCase()] === undefined) return null;
  const t = /(\d{1,2}):(\d{2})\s*([ap])/i.exec(it.time || '');
  const h = t ? (+t[1] % 12) + (t[3].toLowerCase() === 'p' ? 12 : 0) : 0;
  return new Date(+d[3], MONTHS[d[1].toLowerCase()], +d[2], h, t ? +t[2] : 0);
}

// ---------- load the gallery ----------
const data = await fetch('gallery.json').then(r => r.json());
items = data.panoramas || [];
const towns = data.towns || {}; // "Town, ST" -> { ll: [lat, lng] of the town center, county, elev_ft }
const townLL = loc => { const t = towns[loc]; return Array.isArray(t) ? t : t && t.ll; };
items.forEach(it => {
  const [town = '', st = ''] = (it.location || '').split(',').map(s => s.trim());
  it._town = town;
  it._state = STATE_NAME[st.toLowerCase()] || st;
  it._when = parseWhen(it);
  it._search = [town, st, it._state, it._when && it._when.getFullYear(), it._when && SEASON_BY_MONTH[it._when.getMonth()], it.location]
    .filter(Boolean).join(' ').toLowerCase();
});
$('total').textContent = pad(items.length);

// ---------- list rows (built once, reordered by sorting) ----------
let sel = -1; // the selected entry, shown on the right
const rows = items.map((it, i) => {
  const li = document.createElement('li'); li.className = 'row';
  const btn = document.createElement('button');
  btn.className = 'entry'; btn.type = 'button';
  const img = document.createElement('img');
  img.src = it.thumb || it.file; img.alt = ''; img.loading = 'lazy';
  const text = document.createElement('span'); text.className = 'entryText';
  const strong = document.createElement('strong'); strong.textContent = it.location || '';
  const em = document.createElement('em'); em.textContent = metaLine(it).join(' · ');
  text.append(strong, em);
  btn.append(img, text);
  btn.addEventListener('click', () => phoneLayout.matches ? enter(i, img) : select(i));
  btn.addEventListener('dblclick', () => enter(i, detailImg));
  btn.addEventListener('keydown', e => { if (e.key === 'Enter' && sel === i && !phoneLayout.matches) { e.preventDefault(); enter(i, detailImg); } });
  li.append(btn);
  return li;
});

// ---------- sorting ----------
const byDate = (a, b) => (b._when || 0) - (a._when || 0); // newest first
const SORTS = {
  date:  { cmp: byDate, group: it => it._when ? it._when.toLocaleString('en-US', { month: 'long', year: 'numeric' }) : 'undated', dir: ['newest first', 'oldest first'] },
  city:  { cmp: (a, b) => a._town.localeCompare(b._town) || byDate(a, b), group: it => it.location, dir: ['a to z', 'z to a'] },
  state: { cmp: (a, b) => a._state.localeCompare(b._state) || a._town.localeCompare(b._town) || byDate(a, b), group: it => it._state, dir: ['a to z', 'z to a'] },
};
let sortKey = 'date', sortRev = false, order = [];
try { const s = JSON.parse(localStorage.getItem('sort')); if (s && SORTS[s.key]) { sortKey = s.key; sortRev = !!s.rev; } } catch {}

function renderList() {
  const s = SORTS[sortKey];
  order = items.map((_, i) => i).sort((a, b) => s.cmp(items[a], items[b]));
  if (sortRev) order.reverse();
  const nodes = [];
  let lastGroup = null;
  for (const i of order) {
    const g = s.group(items[i]);
    if (g !== lastGroup) { nodes.push(Object.assign(document.createElement('li'), { className: 'group', textContent: g })); lastGroup = g; }
    nodes.push(rows[i]);
  }
  entriesEl.replaceChildren(...nodes);
  document.querySelectorAll('.sort').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.sort === sortKey)));
  sortDirBtn.textContent = s.dir[sortRev ? 1 : 0];
  try { localStorage.setItem('sort', JSON.stringify({ key: sortKey, rev: sortRev })); } catch {}
  filterRows();
}
document.querySelectorAll('.sort').forEach(b => b.addEventListener('click', () => {
  if (b.dataset.sort === sortKey) sortRev = !sortRev; // clicking the active sort flips it
  else { sortKey = b.dataset.sort; sortRev = false; }
  renderList();
}));
sortDirBtn.addEventListener('click', () => { sortRev = !sortRev; renderList(); });

// ---------- search ----------
let matched = null; // null = no search active; else one bool per item
const visible = i => !matched || matched[i];

function filterRows() { // hide non-matching rows, and any group header left with nothing under it
  rows.forEach((li, i) => { li.hidden = !visible(i); });
  let header = null, any = false;
  for (const li of entriesEl.children) {
    if (li.classList.contains('group')) { if (header) header.hidden = !any; header = li; any = false; }
    else if (!li.hidden) any = true;
  }
  if (header) header.hidden = !any;
}

function applySearch(raw) {
  const q = raw.trim().toLowerCase();
  searchClear.hidden = !q;
  matched = q ? items.map(it => it._search.includes(q)) : null;
  filterRows();
  const n = order.filter(visible).length;
  searchCount.textContent = !q ? '' : n ? `${n} of ${items.length}` : 'no matches';
  searchCount.classList.toggle('empty', !!q && n === 0);
  updateMarkers();
  fitMap();
  if (n === 0) return showEmpty(raw.trim());
  if (sel < 0 || !visible(sel)) select(order.find(visible), { pan: false });
}
searchBox.addEventListener('input', e => applySearch(e.target.value));
searchClear.addEventListener('click', () => { searchBox.value = ''; applySearch(''); searchBox.focus(); });
addEventListener('keydown', e => { if (e.key === 'Escape' && document.activeElement === searchBox && searchBox.value) { searchBox.value = ''; applySearch(''); } });


// ---------- conditions next to the photo (filled in by enrich.js) ----------
const WMO = { 0: 'clear', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast', 45: 'fog', 48: 'freezing fog',
  51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle', 56: 'freezing drizzle', 57: 'freezing drizzle',
  61: 'light rain', 63: 'rain', 65: 'heavy rain', 66: 'freezing rain', 67: 'freezing rain',
  71: 'light snow', 73: 'snow', 75: 'heavy snow', 77: 'snow grains', 80: 'light showers', 81: 'showers', 82: 'heavy showers',
  85: 'snow showers', 86: 'snow showers', 95: 'thunderstorms', 96: 'thunderstorms with hail', 99: 'thunderstorms with hail' };
const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
const toCompass = deg => COMPASS[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
const num = n => Number(n).toLocaleString('en-US');
const mins = n => n < 60 ? `${n} min` : `${Math.floor(n / 60)} hr ${n % 60 ? `${n % 60} min` : ''}`.trim();

function weatherLines(w) {
  if (!w) return [];
  return [
    [w.temp_f != null && `${w.temp_f}°f`, WMO[w.code]].filter(Boolean).join(', '),
    w.wind_mph != null && (w.wind_mph < 2 ? 'calm' : `wind ${w.wind_mph} mph from the ${toCompass(w.wind_dir)}${w.gust_mph > w.wind_mph + 4 ? `, gusts ${w.gust_mph}` : ''}`),
    [w.humidity != null && `${w.humidity}% humidity`, w.visibility_mi != null && `${w.visibility_mi} mi visibility`].filter(Boolean).join(', '),
  ];
}
function sunLines(s) {
  if (!s) return [];
  const phase = s.alt < -6 ? 'after dark' : s.alt < -4 ? 'blue hour' : s.alt < 6 ? 'golden hour' : s.alt < 20 ? 'low sun' : 'high sun';
  const toSet = s.mins_to_sunset, sinceRise = s.mins_since_sunrise;
  const timing = toSet != null && toSet >= 0 && toSet <= 120 ? `${mins(toSet)} before sunset`
    : toSet != null && toSet < 0 && toSet >= -90 ? `${mins(-toSet)} after sunset`
    : sinceRise != null && sinceRise >= 0 && sinceRise <= 120 ? `${mins(sinceRise)} after sunrise`
    : sinceRise != null && sinceRise < 0 && sinceRise >= -90 ? `${mins(-sinceRise)} before sunrise`
    : s.sunset && `sunset at ${s.sunset}`;
  const where = Math.round(s.alt) === 0 ? 'sun right on the horizon' : s.alt > 0 ? `sun ${Math.round(s.alt)}° up in the ${toCompass(s.az)}` : `sun ${Math.round(-s.alt)}° below the horizon`;
  return [phase, timing, where];
}
function flightLines(f) {
  if (!f) return [];
  const range = (a, unit = '') => a && (a[0] === a[1] ? `${a[0]}${unit}` : `${a[0]} to ${a[1]}${unit}`);
  return [
    [f.frames && `${f.frames} frames`, f.duration_s && `shot in ${f.duration_s < 60 ? `${f.duration_s} s` : `${Math.floor(f.duration_s / 60)} min ${f.duration_s % 60} s`}`].filter(Boolean).join(', '),
    f.msl_m != null && `${num(Math.round(f.msl_m * 3.28084))} ft above sea level`,
    [f.shutter && range(f.shutter, ' s'), f.iso && `iso ${range(f.iso)}`, f.f && `f/${f.f}`].filter(Boolean).join(', '),
    f.gimbal && `gimbal ${f.gimbal[0]}° to ${f.gimbal[1]}°`,
  ];
}
function placeLines(it) {
  const t = towns[it.location] || {};
  return [
    [t.county, it._state].filter(Boolean).join(', '),
    t.elev_ft != null && `town elevation ${num(t.elev_ft)} ft`,
  ];
}
function renderFacts(it) {
  const groups = [['weather', weatherLines(it.weather)], ['light', sunLines(it.sun)], ['flight', flightLines(it.flight)], ['place', placeLines(it)]];
  factsEl.replaceChildren(...groups.map(([name, lines]) => {
    lines = lines.filter(Boolean);
    if (!lines.length) return null;
    const g = document.createElement('div'); g.className = 'fact';
    g.append(Object.assign(document.createElement('h3'), { textContent: name }));
    for (const l of lines) g.append(Object.assign(document.createElement('p'), { textContent: l }));
    return g;
  }).filter(Boolean));
}

// ---------- the drifting 360 behind the list ----------
let texFor = -1, backdropTimer;
const loadTex = i => loader.loadAsync(items[i].file).then(t => { t.colorSpace = THREE.SRGBColorSpace; return t; });
function applyTex(tex, i) {
  if (sphere.material.map) sphere.material.map.dispose(); // one full-size pano in memory at a time
  sphere.material.map = tex; sphere.material.needsUpdate = true; sphere.visible = true; texFor = i;
}
function backdrop(i) { // waits a beat so arrowing down the list doesn't download every pano
  clearTimeout(backdropTimer);
  backdropTimer = setTimeout(async () => {
    if (texFor === i) return;
    const tex = await loadTex(i);
    if (sel !== i || mode !== 'browse') return tex.dispose(); // moved on while it loaded
    canvas.classList.add('dip');
    await new Promise(r => setTimeout(r, texFor < 0 ? 0 : D(700)));
    applyTex(tex, i);
    canvas.classList.remove('dip');
  }, 300);
}

// ---------- the right pane ----------
function select(i, { pan = true, scroll = false } = {}) {
  const it = items[i];
  if (!it) return;
  if (sel >= 0) rows[sel].firstChild.removeAttribute('aria-current');
  sel = i;
  rows[i].firstChild.setAttribute('aria-current', 'true');
  if (scroll) rows[i].scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
  detailPhoto.hidden = false;
  detailPhoto.setAttribute('aria-label', `step inside the 360 from ${it.location}`);
  detailImg.src = it.thumb || it.file; detailImg.alt = it.location || '';
  detailTitle.textContent = it.location || '';
  fillMeta(detailMeta, it);
  renderFacts(it);
  backdrop(i);
  highlightTown(it.location, pan);
}
function showEmpty(query) {
  if (sel >= 0) rows[sel].firstChild.removeAttribute('aria-current');
  sel = -1;
  detailPhoto.hidden = true; detailImg.removeAttribute('src');
  detailTitle.textContent = 'nothing here';
  detailMeta.replaceChildren(Object.assign(document.createElement('span'), { textContent: `no town, state, year, or season matches "${query}"` }));
  factsEl.replaceChildren();
  highlightTown(null, false);
}
detailPhoto.addEventListener('click', () => { if (sel >= 0) enter(sel, detailImg); });

// up/down walks the list, enter steps in (while browsing, outside the search box)
addEventListener('keydown', e => {
  if (mode !== 'browse' || document.activeElement === searchBox || phoneLayout.matches) return;
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const vis = order.filter(visible);
  if (!vis.length) return;
  e.preventDefault();
  const at = vis.indexOf(sel);
  const next = vis[Math.max(0, Math.min(vis.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))];
  select(next, { scroll: true });
  rows[next].firstChild.focus({ preventScroll: true });
});

// ---------- map (Leaflet; town centers only, never flight GPS) ----------
// CARTO basemap key (free tier). Public by design: it ships in the page, so restrict it to mulvey.world at dashboard.basemaps.carto.com
const CARTO_KEY = 'cb1_3zpy_1_da3421da4fbdb6f2bebd3acc';
let map = null;
const markers = new Map(); // location -> circle marker
let activeTown = null;
const MARK = { radius: 6, color: '#1b1a17', weight: 1.5, fillColor: '#efebe4', fillOpacity: 1 };
const MARK_ON = { radius: 9, color: '#1b1a17', weight: 1.5, fillColor: '#e2522b', fillOpacity: 1 };

function ensureMap() { // built lazily: Leaflet can't size itself inside a hidden pane (phones)
  if (map || !window.L || !mapEl.offsetWidth) return;
  map = L.map(mapEl, { zoomSnap: 0.5, attributionControl: true });
  L.tileLayer(`https://basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}{r}.png?key=${CARTO_KEY}`, {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  }).addTo(map);
  for (const loc of new Set(items.map(it => it.location))) {
    const ll = townLL(loc);
    if (!ll) continue;
    const m = L.circleMarker(ll, MARK).addTo(map);
    m.on('click', () => openTown(loc, m));
    markers.set(loc, m);
  }
  updateMarkers();
  fitMap(false);
  if (sel >= 0) highlightTown(items[sel].location, false);
}
addEventListener('resize', () => { ensureMap(); map && map.invalidateSize(); });

// clicking a pin lists every 360 from that town; pick one to show it on the right
function openTown(loc, m) {
  const here = order.filter(j => items[j].location === loc && visible(j));
  if (!here.length) return;
  if (sel < 0 || items[sel].location !== loc) select(here[0], { scroll: true, pan: false });
  if (here.length === 1) return;
  const box = document.createElement('div'); box.className = 'townPop';
  box.append(Object.assign(document.createElement('strong'), { textContent: `${loc} · ${here.length} 360s` }));
  const grid = document.createElement('div'); grid.className = 'townGrid';
  for (const j of here) {
    const it = items[j];
    const b = document.createElement('button'); b.type = 'button';
    if (j === sel) b.setAttribute('aria-current', 'true');
    const img = Object.assign(document.createElement('img'), { src: it.thumb || it.file, alt: '' });
    const cap = Object.assign(document.createElement('span'), { textContent: `${(it.date || '').replace(/,\s*\d{4}$/, '')}, ${it.time || ''}` });
    b.append(img, cap);
    b.addEventListener('click', () => {
      select(j, { scroll: true, pan: false });
      grid.querySelectorAll('button').forEach(x => x.toggleAttribute('aria-current', x === b));
    });
    grid.append(b);
  }
  box.append(grid);
  m.unbindPopup().bindPopup(box, { className: 'townPopup', closeButton: false, offset: [0, -4], maxWidth: 320, autoPanPadding: [20, 20] }).openPopup();
}

function updateMarkers() { // hide towns a search filtered out; tooltip counts what's left
  if (!map) return;
  for (const [loc, m] of markers) {
    const n = items.filter((it, i) => it.location === loc && visible(i)).length;
    if (n && !map.hasLayer(m)) m.addTo(map);
    if (!n && map.hasLayer(m)) m.remove();
    m.unbindTooltip().bindTooltip(`${loc} · ${n} ${n === 1 ? '360' : '360s'}`, { direction: 'top', offset: [0, -8] });
  }
}
function fitMap(animate = true) {
  if (!map) return;
  const pts = [...markers].filter(([, m]) => map.hasLayer(m)).map(([loc]) => townLL(loc));
  if (!pts.length) return;
  if (pts.length === 1) map.setView(pts[0], 10, { animate: animate && !reduceMotion });
  else map.fitBounds(pts, { padding: [36, 36], maxZoom: 10, animate: animate && !reduceMotion });
}
function highlightTown(loc, pan) {
  if (!map) return;
  if (activeTown && markers.get(activeTown)) markers.get(activeTown).setStyle(MARK).setRadius(MARK.radius);
  activeTown = loc;
  const m = loc && markers.get(loc);
  if (!m) return;
  m.setStyle(MARK_ON).setRadius(MARK_ON.radius).bringToFront();
  if (!pan) return;
  const ll = m.getLatLng();
  if (map.getZoom() >= 7 && map.getBounds().pad(-0.15).contains(ll)) return; // already in view, don't make it lurch
  reduceMotion ? map.setView(ll, 9) : map.flyTo(ll, 9, { duration: 0.9 });
}

renderList();
ensureMap();
if (order.length) select(order[0], { pan: false });

// ---------- hide text while turning (inside a pano) ----------
let quietOn = false, quietTimer;
try { quietOn = localStorage.getItem('quiet') === '1'; } catch {}
const quietBtn = $('quiet');
const syncQuiet = () => quietBtn.setAttribute('aria-pressed', String(quietOn));
syncQuiet();
quietBtn.addEventListener('click', () => {
  quietOn = !quietOn; syncQuiet();
  try { localStorage.setItem('quiet', quietOn ? '1' : '0'); } catch {}
  if (!quietOn) document.body.classList.remove('quiet');
});
function turning() {
  if (!quietOn || mode !== 'pano') return;
  document.body.classList.add('quiet');
  clearTimeout(quietTimer);
  quietTimer = setTimeout(() => document.body.classList.remove('quiet'), 1000);
}

// ---------- auto spin (inside a pano) ----------
let spinOn = false;
$('spin').addEventListener('click', e => { spinOn = !spinOn; e.currentTarget.setAttribute('aria-pressed', String(spinOn)); });

// ---------- full screen ----------
const fsBtn = $('fs');
if (document.fullscreenEnabled) { // not on iPhone Safari, which only allows full screen for video
  fsBtn.hidden = false;
  const toggleFs = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
  fsBtn.addEventListener('click', toggleFs);
  addEventListener('keydown', e => { if (e.key === 'f' && !e.metaKey && !e.ctrlKey && document.activeElement !== searchBox) toggleFs(); });
  document.addEventListener('fullscreenchange', () => { fsBtn.textContent = document.fullscreenElement ? 'exit full screen' : 'full screen'; });
}

// ---------- look around + zoom inside a pano ----------
// zoom = camera field of view: smaller fov, closer view. 70 is where you land.
const FOV_MIN = 25, FOV_MAX = 90, FOV_HOME = 70;
let fovTarget = FOV_HOME;
const setZoom = f => { fovTarget = THREE.MathUtils.clamp(f, FOV_MIN, FOV_MAX); };
const zoomBy = factor => setZoom(fovTarget * factor);

const pointers = new Map(); // active touches/mouse, for drag and pinch
let dragging = false, last = null, pinchDist = 0;
const spread = () => { const [a, b] = [...pointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };

canvas.addEventListener('pointerdown', e => {
  if (mode !== 'pano') return;
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1) { dragging = true; last = [e.clientX, e.clientY]; }
  if (pointers.size === 2) { dragging = false; pinchDist = spread(); }
});
canvas.addEventListener('pointermove', e => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) { // pinch: fingers apart = zoom in
    const d = spread();
    if (pinchDist) zoomBy(pinchDist / d);
    pinchDist = d;
    return;
  }
  if (!dragging) return;
  const dx = e.clientX - last[0], dy = e.clientY - last[1];
  last = [e.clientX, e.clientY];
  const k = 0.12 * (camera.fov / FOV_HOME); // zoomed in = slower drag, so the image tracks your finger
  vLon = -dx * k; vLat = dy * k; lon += vLon; lat += vLat;
  turning();
});
const release = e => {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinchDist = 0;
  if (pointers.size === 1) { const p = [...pointers.values()][0]; dragging = true; last = [p.x, p.y]; } // pinch -> drag without a jump
  if (pointers.size === 0) dragging = false;
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);

addEventListener('wheel', e => {
  if (mode !== 'pano') return;
  e.preventDefault();
  // trackpad pinch arrives as ctrl+wheel with small deltas; mouse wheel as bigger ones
  zoomBy(Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
}, { passive: false });
canvas.addEventListener('dblclick', () => { if (mode === 'pano') setZoom(fovTarget > FOV_HOME - 5 ? 40 : FOV_HOME); });

addEventListener('keydown', e => {
  if (document.activeElement === searchBox || mode !== 'pano') return;
  if (e.key === 'Escape') leave();
  if (e.key === 'ArrowRight') { vLon += 3; turning(); }
  if (e.key === 'ArrowLeft') { vLon -= 3; turning(); }
  if (e.key === 'ArrowUp') vLat += 2;
  if (e.key === 'ArrowDown') vLat -= 2;
  if (e.key === '+' || e.key === '=') zoomBy(0.8);
  if (e.key === '-' || e.key === '_') zoomBy(1.25);
  if (e.key === '0') setZoom(FOV_HOME);
});
$('zoomIn').addEventListener('click', () => zoomBy(0.8));
$('zoomOut').addEventListener('click', () => zoomBy(1.25));
backBtn.addEventListener('click', () => leave());

// ---------- caption shown while inside a pano ----------
function showCaption(i) {
  const it = items[i];
  $('idx').textContent = pad(order.indexOf(i) + 1); // position in the list as currently sorted
  $('title').textContent = it.location || '';
  fillMeta($('meta'), it);
}

// ---------- step inside: morph the clicked thumb into the full sphere ----------
async function enter(i, sourceImg = detailImg) {
  if (mode !== 'browse') return;
  const it = items[i];
  if (!it) return;
  mode = 'entering'; active = i;

  const thumbEl = sourceImg.getBoundingClientRect().width ? sourceImg : rows[i].querySelector('img');
  const round = thumbEl === detailImg;
  const r = (round ? detailPhoto : thumbEl).getBoundingClientRect();
  const flyer = document.createElement('img');
  flyer.src = thumbEl.currentSrc || thumbEl.src;
  flyer.className = 'flyer';
  if (round) flyer.style.borderRadius = '50%'; // round from the first frame, not after the fade
  Object.assign(flyer.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  document.body.appendChild(flyer);

  clearTimeout(backdropTimer);
  const texReady = texFor === i ? null : loadTex(i);

  await tween(D(350), t => { browseEl.style.opacity = String(1 - t); });
  browseEl.hidden = true; browseEl.style.opacity = '';
  $('browseControls').hidden = true;

  if (round) { // through the porthole: the circle swells past the screen edges, like flying through the window
    const d = Math.hypot(innerWidth, innerHeight);
    Object.assign(flyer.style, { transitionDuration: '.9s', transitionTimingFunction: 'cubic-bezier(.55, 0, .25, 1)' });
    requestAnimationFrame(() => requestAnimationFrame(() => Object.assign(flyer.style, {
      left: `${(innerWidth - d) / 2}px`, top: `${(innerHeight - d) / 2}px`, width: `${d}px`, height: `${d}px`,
    })));
  } else requestAnimationFrame(() => flyer.classList.add('full'));
  await (reduceMotion ? Promise.resolve() : new Promise(res => flyer.addEventListener('transitionend', res, { once: true })));

  if (texReady) applyTex(await texReady, i);
  canvas.classList.remove('dip');
  lon = 0; lat = 0; vLon = vLat = 0; // face the direction the card showed
  fovTarget = FOV_HOME; camera.fov = FOV_HOME; camera.updateProjectionMatrix();
  document.body.classList.add('viewing');
  viewerEl.hidden = false;
  compassWrap.hidden = false; $('viewerControls').hidden = false;
  await tween(D(400), t => { flyer.style.opacity = String(1 - t); document.body.classList.toggle('inside', t > 0.5); });
  flyer.remove();

  mode = 'pano';
  backBtn.hidden = false;
  showCaption(i);
  hintEl.textContent = matchMedia('(pointer: coarse)').matches ? 'drag to look around · pinch to zoom' : 'drag to look around · scroll to zoom · esc to leave';
}

async function leave() {
  if (mode !== 'pano') return;
  mode = 'leaving';
  backBtn.hidden = true;
  document.body.classList.remove('viewing', 'inside'); // canvas eases back down to a faint backdrop
  fovTarget = FOV_HOME;
  viewerEl.hidden = true;
  compassWrap.hidden = true; $('viewerControls').hidden = true; $('browseControls').hidden = false;
  browseEl.hidden = false; browseEl.style.opacity = '0';
  ensureMap(); map && map.invalidateSize();
  await tween(D(350), t => { browseEl.style.opacity = String(t); });
  browseEl.style.opacity = '';
  mode = 'browse';
}

// ---------- loop (only while a pano is on screen) ----------
function frame() {
  if (mode === 'pano' && !dragging) { lon += vLon; lat += vLat; vLon *= 0.92; vLat *= 0.92; }
  if (mode === 'pano' && spinOn && !dragging) lon += 0.05;
  if (mode === 'browse') { lat *= 0.97; if (!reduceMotion) lon += 0.025; } // slow drift behind the list
  if (sphere.visible) {
    if (Math.abs(camera.fov - fovTarget) > 0.01) { camera.fov += (fovTarget - camera.fov) * (reduceMotion ? 1 : 0.18); camera.updateProjectionMatrix(); }
    lat = THREE.MathUtils.clamp(lat, -85, 85);
    const phi = THREE.MathUtils.degToRad(lat), th = THREE.MathUtils.degToRad(lon);
    const dir = new THREE.Vector3(Math.sin(th) * Math.cos(phi), Math.sin(phi), -Math.cos(th) * Math.cos(phi));
    camera.lookAt(camera.position.clone().add(dir));
    const hdg = Math.round(((lon % 360) + 360) % 360);
    $('hdg').textContent = String(hdg).padStart(3, '0');
    $('tape').style.backgroundPositionX = `${-hdg * 1.6}px, ${-hdg * 1.6}px`;
    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
