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
  new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
);
sphere.rotation.y = -Math.PI / 2; // matches the thumbnail crop's horizon-centered framing
sphere.visible = false;
scene.add(sphere);

// ---------- state ----------
let items = [];
let matched = null; // null = no search active; else one bool per item
let mode = 'browse'; // browse | entering | pano | leaving
let active = -1;
let lon = 0, lat = 0, vLon = 0, vLat = 0; // look direction inside a pano (degrees)

// ---------- DOM ----------
const browseEl = $('browse'), viewerEl = $('viewer'), entriesEl = $('entries');
const detailImg = $('detailImg'), detailTitle = $('detailTitle'), detailMeta = $('detailMeta'), detailEnter = $('detailEnter');
const searchBox = $('search'), searchClear = $('searchClear'), searchCount = $('searchCount');
const compassWrap = $('compassWrap'), backBtn = $('back'), hintEl = $('hint');

function metaLine(it) {
  return [it.date, it.time, it.alt && it.alt + ' up'].filter(Boolean);
}
function fillMeta(el, it) {
  el.replaceChildren(...metaLine(it).map(t => Object.assign(document.createElement('span'), { textContent: t })));
}

// ---------- load the gallery and build the list ----------
const data = await fetch('gallery.json').then(r => r.json());
items = data.panoramas || [];
items.forEach(it => {
  const [town, st] = (it.location || '').split(',').map(s => s && s.trim());
  const when = it.date ? new Date(it.date) : null;
  const ok = when && !isNaN(when);
  it._search = [town, st, st && STATE_NAME[st.toLowerCase()], ok && when.getFullYear(), ok && SEASON_BY_MONTH[when.getMonth()], it.location]
    .filter(Boolean).join(' ').toLowerCase();
});
$('total').textContent = pad(items.length);

items.forEach((it, i) => {
  const li = document.createElement('li');
  const btn = document.createElement('button');
  btn.className = 'entry'; btn.type = 'button'; btn.dataset.i = String(i);
  const img = document.createElement('img');
  img.src = it.thumb || it.file; img.alt = ''; img.loading = 'lazy';
  const text = document.createElement('span'); text.className = 'entryText';
  const strong = document.createElement('strong'); strong.textContent = it.location || '';
  const em = document.createElement('em'); em.textContent = metaLine(it).join(' · ');
  text.append(strong, em);
  btn.append(img, text);
  btn.addEventListener('mouseenter', () => showDetail(i));
  btn.addEventListener('focus', () => showDetail(i));
  btn.addEventListener('click', () => enter(i));
  li.append(btn);
  entriesEl.append(li);
});
if (items.length) showDetail(0);

function showDetail(i) {
  const it = items[i];
  if (!it) return;
  detailImg.style.display = ''; detailImg.src = it.thumb || it.file; detailImg.alt = it.location || '';
  detailTitle.textContent = it.location || '';
  fillMeta(detailMeta, it);
  detailEnter.hidden = false;
  detailEnter.onclick = () => enter(i);
}
function showEmptyDetail(query) {
  detailImg.style.display = 'none'; detailImg.removeAttribute('src'); detailImg.alt = '';
  detailTitle.textContent = 'nothing here';
  detailMeta.replaceChildren(Object.assign(document.createElement('span'), { textContent: `try a different town, state, year, or season than "${query}"` }));
  detailEnter.hidden = true; detailEnter.onclick = null;
}

// ---------- search ----------
function applySearch(raw) {
  const q = raw.trim().toLowerCase();
  searchClear.hidden = !q;
  matched = q ? items.map(it => it._search.includes(q)) : null;
  [...entriesEl.children].forEach((li, i) => { li.hidden = !!matched && !matched[i]; });
  if (!matched) { searchCount.textContent = ''; searchCount.classList.remove('empty'); if (items.length) showDetail(0); return; }
  const first = matched.findIndex(Boolean);
  const n = matched.filter(Boolean).length;
  searchCount.textContent = n ? `${n} of ${items.length}` : 'no matches';
  searchCount.classList.toggle('empty', n === 0);
  first >= 0 ? showDetail(first) : showEmptyDetail(raw.trim());
}
searchBox.addEventListener('input', e => applySearch(e.target.value));
searchClear.addEventListener('click', () => { searchBox.value = ''; applySearch(''); searchBox.focus(); });
addEventListener('keydown', e => { if (e.key === 'Escape' && document.activeElement === searchBox && searchBox.value) { searchBox.value = ''; applySearch(''); } });

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
  $('idx').textContent = pad(i + 1);
  $('title').textContent = it.location || '';
  fillMeta($('meta'), it);
}

// ---------- step inside: morph the clicked thumb into the full sphere ----------
async function enter(i) {
  if (mode !== 'browse') return;
  const it = items[i];
  if (!it) return;
  mode = 'entering'; active = i;

  const thumbEl = entriesEl.querySelector(`.entry[data-i="${i}"] img`) || detailImg;
  const r = thumbEl.getBoundingClientRect();
  const flyer = document.createElement('img');
  flyer.src = thumbEl.currentSrc || thumbEl.src;
  flyer.className = 'flyer';
  Object.assign(flyer.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  document.body.appendChild(flyer);

  const texReady = loader.loadAsync(it.file).then(t => { t.colorSpace = THREE.SRGBColorSpace; return t; });

  await tween(D(350), t => { browseEl.style.opacity = String(1 - t); });
  browseEl.hidden = true; browseEl.style.opacity = '';
  $('browseControls').hidden = true;

  requestAnimationFrame(() => flyer.classList.add('full'));
  await (reduceMotion ? Promise.resolve() : new Promise(res => flyer.addEventListener('transitionend', res, { once: true })));

  const tex = await texReady;
  sphere.material.map = tex; sphere.material.needsUpdate = true;
  sphere.visible = true;
  lon = 0; lat = 0; vLon = vLat = 0;
  fovTarget = FOV_HOME; camera.fov = FOV_HOME; camera.updateProjectionMatrix();
  viewerEl.hidden = false;
  compassWrap.hidden = false; $('viewerControls').hidden = false;
  await tween(D(400), t => { sphere.material.opacity = t; flyer.style.opacity = String(1 - t); document.body.classList.toggle('inside', t > 0.5); });
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
  await tween(D(400), t => { sphere.material.opacity = 1 - t; document.body.classList.toggle('inside', t < 0.5); });
  sphere.visible = false;
  viewerEl.hidden = true;
  compassWrap.hidden = true; $('viewerControls').hidden = true; $('browseControls').hidden = false;
  browseEl.hidden = false; browseEl.style.opacity = '0';
  await tween(D(350), t => { browseEl.style.opacity = String(t); });
  browseEl.style.opacity = '';
  mode = 'browse';
}

// ---------- loop (only while a pano is on screen) ----------
function frame() {
  if (mode === 'pano' && !dragging) { lon += vLon; lat += vLat; vLon *= 0.92; vLat *= 0.92; }
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
