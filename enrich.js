// Run: node enrich.js            (looks in ~/Documents/Drone/DCIM, then a plugged-in SD card)
//  or: node enrich.js /path/to/DCIM
// Fills gallery.json with weather, sun, place, and flight/camera info for every 360.
// Safe to re-run any time. Never writes GPS coordinates from the drone into the site.
const fs = require('fs'), path = require('path'), os = require('os');
if (typeof fetch !== 'function') { console.error('Needs Node 18 or newer (run: node -v).'); process.exit(1); }

const GALLERY = 'gallery.json';
const data = JSON.parse(fs.readFileSync(GALLERY, 'utf8'));
// 360s taken off the site on purpose. Their raw sets get listed as removed, never as "new sets to stitch".
const SKIP = fs.existsSync('skip.json') ? JSON.parse(fs.readFileSync('skip.json', 'utf8')) : [];
const towns = data.towns || {};
const llOf = t => Array.isArray(t) ? t : t && t.ll;

// ---------- dates ----------
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
function wallClock(p) { // "Sep 19, 2026" + "4:10 pm" -> {y, mo, d, h, mi}, local time at the town
  const d = /([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/i.exec(p.date || '');
  const t = /(\d{1,2}):(\d{2})\s*([ap])/i.exec(p.time || '');
  if (!d || !t) return null;
  return { y: +d[3], mo: MONTHS[d[1].toLowerCase()], d: +d[2], h: (+t[1] % 12) + (t[3].toLowerCase() === 'p' ? 12 : 0), mi: +t[2] };
}
const iso = w => `${w.y}-${String(w.mo + 1).padStart(2, '0')}-${String(w.d).padStart(2, '0')}`;
const fmtClock = (h, m) => `${(h % 12) || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;

// ---------- sun position (SunCalc's algorithm) ----------
const rad = Math.PI / 180;
function sunPosition(dateUtc, lat, lng) {
  const d = dateUtc / 864e5 - 0.5 + 2440588 - 2451545;
  const M = rad * (357.5291 + 0.98560028 * d);
  const L = M + rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) + rad * 102.9372 + Math.PI;
  const e = rad * 23.4397;
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const ra = Math.atan2(Math.sin(L) * Math.cos(e), Math.cos(L));
  const H = rad * (280.16 + 360.9856235 * d) - rad * -lng - ra;
  const phi = rad * lat;
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  return { alt: alt / rad, az: (az / rad + 180 + 360) % 360 }; // az: 0 = north, 90 = east
}

// ---------- weather + sunrise/sunset + elevation (Open-Meteo, free, no key) ----------
const HOURLY = 'temperature_2m,relative_humidity_2m,weather_code,cloud_cover,wind_speed_10m,wind_gusts_10m,wind_direction_10m,visibility';
async function weatherDay(ll, day) {
  const q = `latitude=${ll[0]}&longitude=${ll[1]}&start_date=${day}&end_date=${day}&hourly=${HOURLY}&daily=sunrise,sunset&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto`;
  for (const host of ['https://api.open-meteo.com/v1/forecast', 'https://archive-api.open-meteo.com/v1/archive']) {
    try {
      const r = await fetch(`${host}?${q}`);
      if (!r.ok) continue;
      const j = await r.json();
      if (j.hourly && j.hourly.temperature_2m && j.hourly.temperature_2m.some(v => v != null)) return j;
    } catch {}
  }
  return null;
}
const toMin = s => { const m = /T(\d\d):(\d\d)/.exec(s || ''); return m ? +m[1] * 60 + +m[2] : null; };

// ---------- county for new towns (OpenStreetMap Nominatim, 1 request/sec, needs a user agent) ----------
async function county(ll) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${ll[0]}&lon=${ll[1]}&format=json&zoom=10`, { headers: { 'User-Agent': 'mulvey.world drone gallery (enrich.js)' } });
    const j = await r.json();
    await new Promise(res => setTimeout(res, 1100));
    return (j.address && (j.address.county || j.address.city)) || null;
  } catch { return null; }
}

// ---------- reading DJI photos: EXIF (shutter, ISO...) + DJI XMP (altitude, gimbal) ----------
function readExif(buf) {
  let p = 2;
  while (p < buf.length - 4 && buf[p] === 0xff) {
    const marker = buf[p + 1], len = buf.readUInt16BE(p + 2);
    if (marker === 0xe1 && buf.toString('latin1', p + 4, p + 10) === 'Exif\0\0') return parseTiff(buf, p + 10);
    p += 2 + len;
  }
  return {};
}
function parseTiff(buf, t) {
  const le = buf.toString('latin1', t, t + 2) === 'II';
  const u16 = o => le ? buf.readUInt16LE(o) : buf.readUInt16BE(o);
  const u32 = o => le ? buf.readUInt32LE(o) : buf.readUInt32BE(o);
  const tags = {};
  const readIfd = off => {
    const n = u16(t + off);
    for (let k = 0; k < n; k++) {
      const e = t + off + 2 + k * 12, tag = u16(e), type = u16(e + 2), count = u32(e + 4), vo = e + 8;
      if (type === 3 && count === 2) tags[tag] = [u16(vo), u16(vo + 2)]; // some writers store fractions as two shorts
      else if (type === 3) tags[tag] = u16(vo);
      else if (type === 4) tags[tag] = u32(vo);
      else if (type === 5 || type === 10) { const o = t + u32(vo); tags[tag] = [u32(o), u32(o + 4)]; }
      else if (type === 2) { const o = count > 4 ? t + u32(vo) : vo; tags[tag] = buf.toString('latin1', o, o + count - 1); }
    }
  };
  readIfd(u32(t + 4));
  if (tags[0x8769]) readIfd(tags[0x8769]); // Exif sub-IFD
  return {
    when: tags[0x9003],                                   // "2026:09:19 16:10:03"
    exposure: tags[0x829a] && tags[0x829a][0] / tags[0x829a][1],
    f: tags[0x829d] && tags[0x829d][0] / tags[0x829d][1],
    iso: tags[0x8827],
    focal35: tags[0xa405],
  };
}
function readXmp(buf) {
  const s = buf.toString('latin1'), out = {};
  for (const m of s.matchAll(/drone-dji:(\w+)="([^"]*)"/g)) out[m[1]] = m[2];
  for (const m of s.matchAll(/<drone-dji:(\w+)>([^<]*)</g)) out[m[1]] = m[2];
  return out;
}
function readPhoto(file) {
  const fd = fs.openSync(file, 'r'), buf = Buffer.alloc(256 * 1024);
  const n = fs.readSync(fd, buf, 0, buf.length, 0); fs.closeSync(fd);
  const b = buf.subarray(0, n);
  return { ...readExif(b), xmp: readXmp(b) };
}

function findSets(root) { // every folder of drone JPGs, keyed by folder
  const sets = [];
  const walk = dir => {
    let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    const jpgs = entries.filter(e => e.isFile() && /\.jpe?g$/i.test(e.name)).map(e => path.join(dir, e.name)).sort();
    if (jpgs.length) sets.push({ dir, jpgs });
    for (const e of entries) if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'drone-site' && e.name !== 'node_modules') walk(path.join(dir, e.name));
  };
  walk(root);
  return sets;
}
function summarizeSet(set) {
  const shots = set.jpgs.map(readPhoto).filter(s => s.when);
  if (!shots.length) return null;
  const secs = s => { const m = /(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/.exec(s.when); return m ? Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000 : null; };
  const times = shots.map(secs).filter(Boolean).sort((a, b) => a - b);
  const nums = k => shots.map(s => parseFloat(s.xmp[k])).filter(Number.isFinite);
  const exp = shots.map(s => s.exposure).filter(Boolean), isos = shots.map(s => s.iso).filter(Boolean), pitch = nums('GimbalPitchDegree');
  const shutter = x => x >= 1 ? `${+x.toFixed(1)}` : `1/${Math.round(1 / x)}`;
  const msl = nums('AbsoluteAltitude');
  return {
    dir: set.dir,
    start: times[0], // wall-clock seconds, as the drone recorded it
    flight: {
      frames: shots.length,
      duration_s: times.length > 1 ? times[times.length - 1] - times[0] : null,
      shutter: exp.length ? [shutter(Math.min(...exp)), shutter(Math.max(...exp))] : null,
      iso: isos.length ? [Math.min(...isos), Math.max(...isos)] : null,
      f: shots[0].f ? +shots[0].f.toFixed(1) : null,
      focal35: shots[0].focal35 || null,
      msl_m: msl.length ? Math.round(msl.reduce((a, b) => a + b) / msl.length) : null,
      gimbal: pitch.length ? [Math.round(Math.min(...pitch)), Math.round(Math.max(...pitch))] : null,
    },
  };
}

// ---------- main ----------
(async () => {
  const arg = process.argv[2];
  const home = os.homedir();
  const candidates = arg ? [arg] : [
    path.join(home, 'Documents', 'Drone', 'DCIM'), path.join(home, 'Drone', 'DCIM'),               // where it lives now
    ...(fs.existsSync('/Volumes') ? fs.readdirSync('/Volumes').map(v => path.join('/Volumes', v, 'DCIM')) : []), // SD card plugged in
    path.join(home, 'Downloads', 'DCIM 2'), path.join(home, 'Downloads', 'DCIM'),                // old spots
  ];
  const sdRoot = candidates.find(c => fs.existsSync(c));
  let sets = [];
  if (sdRoot) {
    console.log(`Reading drone photos in ${sdRoot} ...`);
    sets = findSets(sdRoot).map(summarizeSet).filter(Boolean);
    console.log(`  found ${sets.length} photo sets`);
  } else console.log('No drone photo folder found, so flight info already in gallery.json is left as is. To read new photos: node enrich.js /path/to/DCIM');

  // place: county + town elevation
  for (const [loc, t] of Object.entries(towns)) {
    const place = Array.isArray(t) ? { ll: t } : t;
    if (!place.county) place.county = await county(place.ll);
    towns[loc] = place;
  }

  const cache = new Map(), used = new Set();
  const rows = [];
  for (const p of data.panoramas) {
    const w = wallClock(p), place = towns[p.location], ll = llOf(place);
    const row = { name: path.basename(p.file), weather: '-', sun: '-', flight: p.flight ? 'saved earlier' : '-' };
    rows.push(row);
    if (!w || !ll) { row.weather = 'no date or map pin'; continue; }

    const key = `${p.location}|${iso(w)}`;
    if (!cache.has(key)) cache.set(key, await weatherDay(ll, iso(w)));
    const j = cache.get(key);
    if (j) {
      if (place.elev_ft == null && j.elevation != null) place.elev_ft = Math.round(j.elevation * 3.28084);
      const hr = Math.min(23, w.h + (w.mi >= 30 ? 1 : 0)), H = j.hourly, v = k => H[k] ? H[k][hr] : null;
      p.weather = {
        temp_f: v('temperature_2m') != null ? Math.round(v('temperature_2m')) : null,
        code: v('weather_code'), cloud: v('cloud_cover'), humidity: v('relative_humidity_2m'),
        wind_mph: v('wind_speed_10m') != null ? Math.round(v('wind_speed_10m')) : null,
        gust_mph: v('wind_gusts_10m') != null ? Math.round(v('wind_gusts_10m')) : null,
        wind_dir: v('wind_direction_10m'),
        visibility_mi: v('visibility') != null ? Math.round(v('visibility') / 1609.34) : null,
      };
      row.weather = 'ok';

      // sun: position from the math, sunrise/sunset from Open-Meteo
      const utc = Date.UTC(w.y, w.mo, w.d, w.h, w.mi) - j.utc_offset_seconds * 1000;
      const pos = sunPosition(utc, ll[0], ll[1]);
      const now = w.h * 60 + w.mi, rise = toMin(j.daily && j.daily.sunrise[0]), set = toMin(j.daily && j.daily.sunset[0]);
      p.sun = {
        alt: +pos.alt.toFixed(1), az: Math.round(pos.az),
        sunrise: rise != null ? fmtClock(Math.floor(rise / 60), rise % 60) : null,
        sunset: set != null ? fmtClock(Math.floor(set / 60), set % 60) : null,
        mins_to_sunset: set != null ? set - now : null,
        mins_since_sunrise: rise != null ? now - rise : null,
      };
      row.sun = 'ok';
    } else row.weather = 'lookup failed';

    // flight: the photo set that started within 10 min of this pano's time
    if (sets.length) {
      const target = Date.UTC(w.y, w.mo, w.d, w.h, w.mi) / 1000;
      const near = sets.map(s => ({ s, gap: Math.abs(s.start - target) })).filter(x => x.gap <= 600 && x.s.flight.frames >= 5);
      const full = near.filter(x => x.s.flight.frames >= 20); // a full sphere is 26 shots; prefer it over a wide or 180 set shot nearby
      const best = (full.length ? full : near).sort((a, b) => a.gap - b.gap)[0];
      if (best) { p.flight = best.s.flight; used.add(best.s.dir); row.flight = `ok (${best.s.flight.frames} frames)`; }
      else row.flight = p.flight ? 'kept existing' : 'no matching photo set';
    }
  }

  fs.writeFileSync(GALLERY, JSON.stringify(data, null, 2).replace(/\[\s+(-?[\d.]+),\s+(-?[\d.]+)\s+\]/g, '[$1, $2]') + '\n');
  console.table(rows);
  console.log('Saved gallery.json. Run node validate.js, then commit and push.');

  // which raw photo folders the site no longer needs
  if (sets.length) {
    const rel = d => path.relative(sdRoot, d) || '.';
    const skipped = new Set();
    for (const k of SKIP) { // the unclaimed full sphere that started closest to the skipped 360's time
      const w = wallClock(k); if (!w) continue;
      const target = Date.UTC(w.y, w.mo, w.d, w.h, w.mi) / 1000;
      const best = sets.filter(s => !used.has(s.dir) && s.flight.frames >= 20 && Math.abs(s.start - target) <= 600)
        .sort((a, b) => Math.abs(a.start - target) - Math.abs(b.start - target))[0];
      if (best) skipped.add(best.dir);
    }
    const done = sets.filter(s => used.has(s.dir) || skipped.has(s.dir)), rest = sets.filter(s => !used.has(s.dir) && !skipped.has(s.dir));
    const size = ds => ds.reduce((t, s) => t + fs.readdirSync(s.dir).reduce((a, f) => { try { return a + fs.statSync(path.join(s.dir, f)).size; } catch { return a; } }, 0), 0);
    const gb = b => b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.round(b / 1e6)} MB`;
    console.log(`\nAlready on the site, info saved (${gb(size(done))}). Safe to archive or delete:`);
    done.forEach(s => console.log(`  ${rel(s.dir)}${skipped.has(s.dir) ? '  (removed on purpose, see skip.json)' : ''}`));
    if (rest.length) {
      console.log(`\nNot on the site (${gb(size(rest))}). New sets to stitch, or extras like wide/180 shots:`);
      rest.forEach(s => console.log(`  ${rel(s.dir)}  (${s.flight.frames} frames)`));
    }
    console.log('\nThe flight info stays in gallery.json after the raw photos are gone; re-running this script keeps it.');
  }
})();
