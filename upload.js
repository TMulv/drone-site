// mulvey.world/upload: push drone photos to the private drone-inbox repo, where a GitHub Action stitches them,
// then review each result here and publish it to drone-site (optionally locked) or throw it away.
// Talks to GitHub straight from the browser with a fine-grained token kept in this browser's localStorage.
import { newLock, deriveKey, encryptBytes } from './lock.js';

const OWNER = 'TMulv', INBOX = `${OWNER}/drone-inbox`, SITE = `${OWNER}/drone-site`;
const API = 'https://api.github.com';
const RAW = 'application/vnd.github.raw';
const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};
let token = store.get('gh_token');

// ---------- GitHub API ----------
class GhError extends Error { constructor(msg, status) { super(msg); this.status = status; } }
async function gh(path, { method = 'GET', body, accept, raw = false } = {}) {
  for (let attempt = 0; ; attempt++) {
    let r;
    try {
      r = await fetch(API + path, {
        method, cache: 'no-store',
        headers: { Authorization: `Bearer ${token}`, Accept: accept || 'application/vnd.github+json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body && JSON.stringify(body),
      });
    } catch (e) { // offline, or the connection dropped mid-upload
      if (attempt < 4) { await sleep(2000 * 2 ** attempt); continue; }
      throw new GhError("Couldn't reach GitHub. Check the connection and try again.", 0);
    }
    if (r.ok) return raw ? r : r.status === 204 ? null : r.json();
    const text = await r.text().catch(() => '');
    const limited = r.status === 429 || (r.status === 403 && /rate limit|abuse|secondary/i.test(text));
    if ((limited || r.status >= 500) && attempt < 4) { await sleep((+r.headers.get('retry-after') || 5 * 2 ** attempt) * 1000); continue; }
    let msg = text; try { msg = JSON.parse(text).message || text; } catch {}
    throw new GhError(msg || `GitHub said ${r.status}`, r.status);
  }
}
const ghBytes = async path => new Uint8Array(await (await gh(path, { accept: RAW, raw: true })).arrayBuffer());
const ghText = async path => (await gh(path, { accept: RAW, raw: true })).text();
const enc = s => encodeURIComponent(s);
const contentsPath = (repo, file, ref) => `/repos/${repo}/contents/${file}?ref=${enc(ref)}`;

function toB64(bytes) { // chunked, so big photos don't blow the call stack
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const fileB64 = file => new Promise((res, rej) => {
  const fr = new FileReader();
  fr.onload = () => res(String(fr.result).split(',')[1]);
  fr.onerror = () => rej(fr.error);
  fr.readAsDataURL(file);
});
const blob = async (repo, b64) => (await gh(`/repos/${repo}/git/blobs`, { method: 'POST', body: { content: b64, encoding: 'base64' } })).sha;

async function headOf(repo, branch = 'main') {
  const ref = await gh(`/repos/${repo}/git/ref/heads/${branch.split('/').map(enc).join('/')}`);
  const commit = await gh(`/repos/${repo}/git/commits/${ref.object.sha}`);
  return { sha: ref.object.sha, tree: commit.tree.sha };
}
async function commitTree(repo, head, entries, message) {
  const tree = await gh(`/repos/${repo}/git/trees`, { method: 'POST', body: { base_tree: head.tree, tree: entries } });
  return (await gh(`/repos/${repo}/git/commits`, { method: 'POST', body: { message, tree: tree.sha, parents: [head.sha] } })).sha;
}

// ---------- reading DJI photos in the browser (date + height, for the set list) ----------
function readExifTime(buf) {
  const b = new DataView(buf), u8 = new Uint8Array(buf);
  let p = 2;
  while (p < b.byteLength - 4 && b.getUint8(p) === 0xff) {
    const marker = b.getUint8(p + 1), len = b.getUint16(p + 2);
    if (marker === 0xe1 && String.fromCharCode(...u8.subarray(p + 4, p + 10)) === 'Exif\0\0') {
      const t = p + 10, le = String.fromCharCode(u8[t], u8[t + 1]) === 'II';
      const u16 = o => b.getUint16(o, le), u32 = o => b.getUint32(o, le);
      const tags = {};
      const ifd = off => {
        const n = u16(t + off);
        for (let k = 0; k < n; k++) {
          const e = t + off + 2 + k * 12, tag = u16(e), type = u16(e + 2), count = u32(e + 4);
          if (type === 2) { const o = count > 4 ? t + u32(e + 8) : e + 8; tags[tag] = String.fromCharCode(...u8.subarray(o, o + count - 1)); }
          else if (type === 4) tags[tag] = u32(e + 8);
        }
      };
      ifd(u32(t + 4));
      if (tags[0x8769]) ifd(tags[0x8769]);
      return tags[0x9003] || tags[0x0132] || null; // DateTimeOriginal, else DateTime
    }
    p += 2 + len;
  }
  return null;
}
async function photoInfo(file) {
  const buf = await file.slice(0, 256 * 1024).arrayBuffer();
  const when = readExifTime(buf);
  const xmp = new TextDecoder('latin1').decode(buf);
  const rel = /drone-dji:RelativeAltitude="([^"]+)"/.exec(xmp);
  const m = when && /(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d)/.exec(when);
  return { when: m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5]) : null, up: rel ? parseFloat(rel[1]) : null, dji: /drone-dji:GimbalYawDegree/.test(xmp) };
}

// ---------- gallery helpers (same date/time strings the site uses) ----------
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function parseWhen(date, time) {
  const d = /([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/i.exec(date || '');
  const t = /(\d{1,2}):(\d{2})\s*([ap])/i.exec(time || '');
  if (!d || MONTHS.indexOf(d[1].toLowerCase()) < 0) return null;
  const h = t ? (+t[1] % 12) + (t[3].toLowerCase() === 'p' ? 12 : 0) : 0;
  return new Date(+d[3], MONTHS.indexOf(d[1].toLowerCase()), +d[2], h, t ? +t[2] : 0);
}
const fmtDate = d => `${d.toLocaleString('en-US', { month: 'short' })} ${d.getDate()}, ${d.getFullYear()}`;
const fmtTime = d => `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'am' : 'pm'}`;
const serialize = g => JSON.stringify(g, null, 2).replace(/\[\s+(-?[\d.]+),\s+(-?[\d.]+)\s+\]/g, '[$1, $2]') + '\n'; // same layout as enrich.js
const slugify = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const nearTime = (a, b) => a && b && Math.abs(a - b) <= 10 * 60 * 1000;

let site = { panoramas: [], towns: {} }, skip = [];
async function loadSite() { // the live gallery, to mark sets that are already up
  try { site = await (await fetch('gallery.json', { cache: 'no-store' })).json(); } catch {}
  try { skip = await (await fetch('skip.json', { cache: 'no-store' })).json(); } catch {}
  $('townList').replaceChildren(...Object.keys(site.towns || {}).sort().map(t => Object.assign(document.createElement('option'), { value: t })));
}

// ---------- connect ----------
async function connect(t) {
  token = t;
  const [inbox] = await Promise.all([gh(`/repos/${INBOX}`), gh(`/repos/${SITE}`)]);
  if (!inbox.private) throw new GhError('drone-inbox is public. Make it private first (Settings → General → Danger zone), since raw photos have GPS in them.', 0);
  return inbox;
}
$('connectForm').addEventListener('submit', async e => {
  e.preventDefault();
  const t = $('tokenIn').value.trim(), msg = $('connectMsg');
  if (!t) return;
  msg.hidden = false; msg.className = 'msg ok'; msg.textContent = 'checking…';
  try {
    await connect(t);
    store.set('gh_token', t);
    start();
  } catch (err) {
    token = null;
    msg.className = 'msg';
    msg.textContent = err.status === 401 ? "GitHub didn't accept that key. Copy it again (it starts with github_pat_)."
      : err.status === 404 ? "That key can't see drone-site and drone-inbox. Check it has both repos picked, and that drone-inbox exists."
      : err.message;
  }
});
$('forget').addEventListener('click', () => { store.set('gh_token', null); location.reload(); });
// pre-fill GitHub's token form where it supports it (ignored otherwise)
$('tokenLink').href = 'https://github.com/settings/personal-access-tokens/new?' + new URLSearchParams({
  name: 'mulvey.world upload', description: 'Upload page for mulvey.world (drone-site + drone-inbox, contents read/write)', target_name: OWNER, expires_in: '366', contents: 'write',
});

// ---------- picking photos ----------
let sets = [];
let wakeLock = null;
const stayAwake = async on => { try { if (on && 'wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; } } catch {} };

function groupFiles(files, fromFolder) {
  const jpgs = [...files].filter(f => /\.jpe?g$/i.test(f.name) && !f.name.startsWith('.'));
  if (!fromFolder) return jpgs.length ? [{ name: jpgs.length === 1 ? jpgs[0].name.replace(/\.[^.]+$/, '') : 'phone photos', files: jpgs }] : [];
  const by = new Map();
  for (const f of jpgs) {
    const dir = (f.webkitRelativePath || f.name).split('/').slice(0, -1).join('/');
    if (!by.has(dir)) by.set(dir, []);
    by.get(dir).push(f);
  }
  let dirs = [...by.keys()];
  if (dirs.some(d => /(^|\/)PANORAMA\//i.test(d + '/'))) dirs = dirs.filter(d => /(^|\/)PANORAMA\//i.test(d + '/')); // SD card: only the sphere folders
  return dirs.sort().map(d => ({ name: d.split('/').pop() || d, files: by.get(d).sort((a, b) => a.name.localeCompare(b.name)) }));
}

async function showSets(files, fromFolder) {
  sets = groupFiles(files, fromFolder);
  const list = $('setList');
  list.replaceChildren();
  $('sets').hidden = false;
  if (!sets.length) { list.append(Object.assign(document.createElement('li'), { textContent: 'No JPG photos in there.' })); updateSummary(); return; }
  const pending = await inboxSources().catch(() => new Set());
  for (const s of sets) {
    const info = await photoInfo(s.files[0]);
    Object.assign(s, info);
    const n = s.files.length;
    s.kind = n >= 20 ? 'raw' : n === 1 && !fromFolder ? 'single' : 'partial'; // on the SD card, a lone photo is an aborted sphere
    const onSite = s.when && site.panoramas.find(p => nearTime(parseWhen(p.date, p.time), s.when));
    const skipped = s.when && skip.find(p => nearTime(parseWhen(p.date, p.time), s.when));
    const inInbox = pending.has(`${s.name}|${s.when ? s.when.getTime() : ''}`);
    s.status = s.kind === 'partial' ? `only ${n} photo${n === 1 ? '' : 's'}` : onSite ? 'on the site' : skipped ? 'removed on purpose' : inInbox ? 'in the inbox' : 'new';
    s.checked = s.status === 'new' && (s.kind === 'raw' || !fromFolder);

    const li = document.createElement('li');
    li.classList.toggle('off', s.kind === 'partial');
    const box = Object.assign(document.createElement('input'), { type: 'checkbox', checked: s.checked, disabled: s.kind === 'partial' });
    box.setAttribute('aria-label', `upload ${s.name}`);
    box.addEventListener('change', () => { s.checked = box.checked; updateSummary(); });
    const text = document.createElement('span');
    const what = s.kind === 'single' ? 'one photo (a finished 360?)' : `${n} photos`;
    text.append(Object.assign(document.createElement('span'), { className: 'name', textContent: s.name }),
      Object.assign(document.createElement('span'), { className: 'when', textContent: [s.when && `${fmtDate(s.when)}, ${fmtTime(s.when)}`, s.up != null && `${Math.round(s.up)} m up`, what].filter(Boolean).join(' · ') }));
    const chip = Object.assign(document.createElement('span'), { className: 'chip' + (s.status === 'new' ? ' new' : s.status === 'removed on purpose' ? ' warn' : ''), textContent: s.status });
    li.append(box, text, chip);
    list.append(li);
  }
  updateSummary();
}
function updateSummary() {
  const n = sets.filter(s => s.checked).length;
  $('uploadBtn').disabled = !n;
  $('uploadBtn').textContent = n > 1 ? `upload ${n} sets` : 'upload';
  const mb = sets.filter(s => s.checked).reduce((t, s) => t + s.files.reduce((a, f) => a + f.size, 0), 0) / 1e6;
  $('setSummary').textContent = n ? `${Math.round(mb)} MB` : sets.length ? 'nothing new picked' : '';
}
$('folderIn').addEventListener('change', e => { showSets(e.target.files, true); e.target.value = ''; });
$('filesIn').addEventListener('change', e => { showSets(e.target.files, false); e.target.value = ''; });

// phones: picking photos is the main way in (and folder picking may not exist)
if (matchMedia('(pointer: coarse)').matches) {
  const [folder, photos] = [$('folderLabel'), $('filesIn').parentElement];
  folder.classList.remove('go'); photos.classList.add('go');
  folder.parentElement.prepend(photos);
}

// drag a folder onto the page (desktop)
if (matchMedia('(pointer: fine)').matches) {
  const drop = $('drop');
  drop.hidden = false;
  const walk = async entry => entry.isFile ? [await new Promise((res, rej) => entry.file(f => {
    Object.defineProperty(f, 'webkitRelativePath', { value: entry.fullPath.replace(/^\//, '') }); res(f);
  }, rej))] : entry.isDirectory ? (await new Promise((res, rej) => { const r = entry.createReader(), all = []; const next = () => r.readEntries(es => es.length ? (all.push(...es), next()) : res(all), rej); next(); }))
    .reduce(async (acc, e) => [...await acc, ...await walk(e)], Promise.resolve([])) : [];
  addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  addEventListener('dragleave', e => { if (!e.relatedTarget) drop.classList.remove('over'); });
  addEventListener('drop', async e => {
    e.preventDefault(); drop.classList.remove('over');
    const entries = [...e.dataTransfer.items].map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
    const files = (await Promise.all(entries.map(walk))).flat();
    showSets(files, entries.some(en => en.isDirectory));
  });
}

// ---------- uploading one set to drone-inbox ----------
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15); // 20261011-001512
async function uploadSet(s, card) {
  const branch = `upload/${stamp()}-${slugify(s.name) || 'photos'}`;
  const total = s.files.reduce((t, f) => t + f.size, 0);
  let done = 0;
  card.setProgress(0, `uploading ${s.files.length} photo${s.files.length > 1 ? 's' : ''}…`);
  const head = await headOf(INBOX);
  const entries = new Array(s.files.length);
  let next = 0;
  const used = new Set();
  const worker = async () => {
    while (next < s.files.length) {
      const k = next++, f = s.files[k];
      let name = f.name.replace(/[^\w.-]+/g, '_');
      while (used.has(name.toLowerCase())) name = name.replace(/(\.[^.]+)$/, '_1$1');
      used.add(name.toLowerCase());
      entries[k] = { path: `upload/${name}`, mode: '100644', type: 'blob', sha: await blob(INBOX, await fileB64(f)) };
      done += f.size;
      card.setProgress(done / total, `uploading… ${Math.round(done / 1e6)} of ${Math.round(total / 1e6)} MB`);
    }
  };
  await Promise.all([worker(), worker(), worker()]); // three at a time
  entries.push({ path: 'upload/request.json', mode: '100644', type: 'blob', content: JSON.stringify({
    source: s.name, photos: s.files.length, taken: s.when ? s.when.getTime() : null, uploaded: new Date().toISOString(),
  }, null, 2) });
  const sha = await commitTree(INBOX, head, entries, `upload ${s.name}`);
  await gh(`/repos/${INBOX}/git/refs`, { method: 'POST', body: { ref: `refs/heads/${branch}`, sha } });
  return branch;
}

$('uploadBtn').addEventListener('click', async () => {
  const todo = sets.filter(s => s.checked);
  if (!todo.length) return;
  $('uploadBtn').disabled = true;
  await stayAwake(true);
  for (const s of todo) {
    const card = makeCard({ title: s.name, sub: s.when ? `${fmtDate(s.when)}, ${fmtTime(s.when)}` : '', state: 'uploading' });
    $('cards').prepend(card.el); syncEmpty();
    try {
      const branch = await uploadSet(s, card);
      card.el.remove();
      s.checked = false; s.status = 'in the inbox';
      await refreshInbox(branch);
    } catch (err) {
      card.fail(`Upload stopped: ${err.message}. Nothing was half-saved; pick the set again to retry.`);
    }
  }
  await stayAwake(false);
  sets = []; $('setList').replaceChildren(); $('sets').hidden = true; updateSummary();
});

// ---------- the inbox: everything waiting in drone-inbox ----------
const cards = new Map(); // branch -> card
const branchTime = b => { const m = /upload\/(\d{4})(\d\d)(\d\d)-(\d\d)(\d\d)(\d\d)/.exec(b); return m ? Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null; };
async function inboxBranches() {
  return (await gh(`/repos/${INBOX}/branches?per_page=100`)).map(b => b.name).filter(n => n.startsWith('upload/')).sort().reverse();
}
async function inboxSources() { // "folder|taken" for everything already uploaded, so the set list can say "in the inbox"
  const out = new Set();
  for (const b of await inboxBranches()) {
    try { const r = JSON.parse(await ghText(contentsPath(INBOX, 'upload/request.json', b))); out.add(`${r.source}|${r.taken ?? ''}`); }
    catch { try { const r = JSON.parse(await ghText(contentsPath(INBOX, 'result/entry.json', b))).request || {}; out.add(`${r.source}|${r.taken ?? ''}`); } catch {} }
  }
  return out;
}

let pollTimer = null;
async function refreshInbox(focus) {
  clearTimeout(pollTimer);
  let names;
  try { names = await inboxBranches(); }
  catch (err) { $('inboxEmpty').hidden = false; $('inboxEmpty').textContent = `Couldn't read the inbox: ${err.message}`; return; }
  for (const [b, c] of cards) if (!names.includes(b) && !c.busy) { c.el.remove(); cards.delete(b); }
  let working = false;
  for (const b of names) {
    let c = cards.get(b);
    if (c && (c.state === 'ready' || c.busy)) continue;
    if (!c) { c = makeCard({ title: b.replace(/^upload\/\d{8}-\d{6}-?/, '') || b, state: 'working', branch: b }); cards.set(b, c); $('cards').append(c.el); }
    try {
      const data = JSON.parse(await ghText(contentsPath(INBOX, 'result/entry.json', b)));
      await c.ready(data);
    } catch (err) {
      if (err.status !== 404) { c.note(err.message); continue; }
      try { const e = JSON.parse(await ghText(contentsPath(INBOX, 'result/error.json', b))); c.failedStitch(e.error); }
      catch { working = true; c.working(branchTime(b)); }
    }
  }
  syncEmpty();
  if (focus && cards.get(focus)) cards.get(focus).el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (working) pollTimer = setTimeout(refreshInbox, 20000);
}
function syncEmpty() { $('inboxEmpty').hidden = $('cards').children.length > 0; }
$('refresh').addEventListener('click', () => refreshInbox());
document.addEventListener('visibilitychange', () => { if (!document.hidden && token) refreshInbox(); });

// ---------- one card ----------
function makeCard({ title, sub = '', state, branch }) {
  const el = $('cardTpl').content.firstElementChild.cloneNode(true);
  const q = s => el.querySelector(s);
  const badge = q('.badge'), msg = q('.msg'), bar = q('.progress');
  const F = Object.fromEntries(['location', 'date', 'time', 'slug', 'lock', 'password'].map(n => [n, q(`input[name=${n}]`)]));
  q('.itemTitle').textContent = title;
  q('.itemSub').textContent = sub;
  const c = { el, state, branch, busy: false, data: null };
  const setBadge = (text, cls) => { badge.textContent = text; badge.className = `badge ${cls}`; };
  const show = (sel, on) => { q(sel).hidden = !on; };
  c.note = (text, ok = false) => { msg.hidden = !text; msg.textContent = text || ''; msg.className = ok ? 'msg ok' : 'msg'; };
  c.setProgress = (f, text) => { setBadge('uploading', 'working'); bar.hidden = false; bar.firstChild.style.width = `${Math.round(f * 100)}%`; q('.itemSub').textContent = text; show('.discard', false); };
  c.fail = text => { bar.hidden = true; setBadge('failed', 'failed'); c.note(text); show('.discard', false); };
  c.working = since => {
    c.state = 'working'; setBadge('stitching', 'working');
    const mins = since ? Math.max(0, Math.round((Date.now() - since) / 60000)) : null;
    q('.itemSub').textContent = mins == null ? 'stitching on GitHub, usually 3 to 5 minutes'
      : mins < 12 ? `stitching on GitHub · started ${mins ? `${mins} min` : 'just now'} ago (usually 3 to 5 min)`
      : `still going after ${mins} min. If it stays stuck, open drone-inbox → Actions on GitHub.`;
  };
  c.failedStitch = text => {
    c.state = 'failed'; setBadge("didn't stitch", 'failed');
    q('.itemSub').textContent = 'the photos are still in the inbox';
    const pre = q('.error'); pre.hidden = false; pre.textContent = text;
    show('.retry', true);
  };
  c.ready = async data => {
    c.state = 'ready'; c.data = data;
    const e = data.entry || {};
    setBadge('ready', 'ready');
    q('.itemTitle').textContent = e.location || title;
    q('.itemSub').textContent = [e.date, e.time, e.alt && `${e.alt} up`, data.source].filter(Boolean).join(' · ');
    show('.review', true); show('.publish', true); show('.retry', false); q('.error').hidden = true;
    F.location.value = e.location || ''; F.date.value = e.date || ''; F.time.value = e.time || '';
    F.slug.value = data.suggest || '';
    q('.warnings').replaceChildren(...(data.warnings || []).map(w => Object.assign(document.createElement('li'), { textContent: w })));
    // previews come from the private repo, so fetch them with the key and show them as local blobs
    const [thumb, pano] = await Promise.all([ghBytes(contentsPath(INBOX, 'result/thumb.jpg', branch)), ghBytes(contentsPath(INBOX, 'result/pano.jpg', branch))]);
    c.thumbBytes = thumb; c.panoBytes = pano;
    const url = b => URL.createObjectURL(new Blob([b], { type: 'image/jpeg' }));
    q('.thumb').src = url(thumb);
    const pu = url(pano); q('.pano').src = pu; q('.panoLink').href = pu;
  };
  // fields
  F.lock.addEventListener('change', () => { show('.lockRow', F.lock.checked); if (F.lock.checked) F.password.focus(); });

  q('.discard').addEventListener('click', async () => {
    if (!c.branch || c.busy) return;
    if (!confirmTwice(q('.discard'))) return;
    c.busy = true; c.note('');
    try { await gh(`/repos/${INBOX}/git/refs/heads/${c.branch.split('/').map(enc).join('/')}`, { method: 'DELETE' }); el.remove(); cards.delete(c.branch); syncEmpty(); }
    catch (err) { c.note(`Couldn't discard: ${err.message}`); }
    c.busy = false;
  });
  q('.retry').addEventListener('click', async () => {
    if (c.busy) return;
    c.busy = true; c.note('');
    try {
      const head = await headOf(INBOX, c.branch);
      const sha = await commitTree(INBOX, head, [{ path: 'result/error.json', mode: '100644', type: 'blob', sha: null }], 'try again');
      await gh(`/repos/${INBOX}/git/refs/heads/${c.branch.split('/').map(enc).join('/')}`, { method: 'PATCH', body: { sha } });
      q('.error').hidden = true; show('.retry', false); c.working(Date.now());
      setTimeout(refreshInbox, 20000);
    } catch (err) { c.note(`Couldn't restart it: ${err.message}`); }
    c.busy = false;
  });
  q('.publish').addEventListener('click', async () => {
    if (c.busy) return;
    c.busy = true; q('.publish').disabled = true; q('.discard').disabled = true;
    try { await publish(c, q, F); }
    catch (err) { c.note(err.message); }
    c.busy = false; q('.publish').disabled = false; q('.discard').disabled = false;
  });
  if (state === 'working') c.working(branchTime(branch));
  if (state === 'uploading') c.setProgress(0, 'starting…');
  return c;
}
function confirmTwice(btn) { // first tap arms it, second tap within 4 s does it
  if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = 'discard'; return true; }
  btn.dataset.armed = '1'; btn.textContent = 'tap again to discard';
  setTimeout(() => { if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = 'discard'; } }, 4000);
  return false;
}

// ---------- publishing to drone-site ----------
async function publish(c, q, F) {
  const data = c.data;
  const location = F.location.value.trim(), date = F.date.value.trim(), time = F.time.value.trim().toLowerCase();
  const when = parseWhen(date, time);
  const lock = F.lock.checked, password = F.password.value;
  if (!/^.+,\s*[A-Za-z]{2}$/.test(location)) throw new Error('Town should look like "Wyckoff, NJ".');
  if (!when) throw new Error('Date and time should look like "Oct 10, 2026" and "5:25 pm".');
  if (lock && password.length < 12) throw new Error('Use a longer password (12+ characters). Four random words works well.');
  if (skip.find(p => p.location === location && nearTime(parseWhen(p.date, p.time), when))) throw new Error("This one is on skip.json (taken off the site on purpose). Remove it from skip.json first if you've changed your mind.");
  const geo = data.town;
  if (!(site.towns || {})[location] && !geo) throw new Error(`${location} isn't on the map yet and these photos had no GPS to place it. Pick a town from the list.`);

  c.note('preparing…', true);
  let pano = c.panoBytes, thumb = c.thumbBytes, extra = {}, id = null;
  if (lock) {
    c.note('locking…', true);
    const l = newLock(), key = await deriveKey(password, l);
    [pano, thumb] = [await encryptBytes(key, pano), await encryptBytes(key, thumb)];
    extra = { lock: l };
    id = [...crypto.getRandomValues(new Uint8Array(6))].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  c.note('sending to the site…', true);
  const [panoSha, thumbSha] = [await blob(SITE, toB64(pano)), await blob(SITE, toB64(thumb))];

  for (let attempt = 0; attempt < 4; attempt++) { // someone else (enrich.js, another publish) may move main in the meantime: rebuild on the new tip
    const head = await headOf(SITE);
    const g = JSON.parse(await ghText(contentsPath(SITE, 'gallery.json', head.sha)));
    g.panoramas = g.panoramas || []; g.towns = g.towns || {};
    let file, thumbFile;
    if (lock) { file = `media/360/locked/${id}.bin`; thumbFile = `media/360/locked/${id}-thumb.bin`; }
    else {
      let slug = slugify(F.slug.value) || data.suggest || 'drone-360', n = 1;
      const taken = s => g.panoramas.some(p => p.file === `media/360/${s}.jpg`);
      while (taken(n > 1 ? `${slug}-${n}` : slug)) n++;
      if (n > 1) slug = `${slug}-${n}`;
      file = `media/360/${slug}.jpg`; thumbFile = `media/360/thumbs/${slug}.jpg`;
    }
    const e = data.entry || {};
    const same = location === e.location && fmtDate(when) === e.date && fmtTime(when) === e.time; // edited? then the looked-up weather/sun no longer apply
    const entry = { file, thumb: thumbFile, ...extra, location, date: fmtDate(when), time: fmtTime(when), ...(e.alt ? { alt: e.alt } : {}),
      ...(same && e.weather ? { weather: e.weather } : {}), ...(same && e.sun ? { sun: e.sun } : {}), ...(e.flight ? { flight: e.flight } : {}) };
    if (!g.towns[location]) { // new pin: town center from the geocoder, never the drone's GPS
      g.towns[location] = { ll: geo.ll, ...(geo.county ? { county: geo.county } : {}), ...(geo.elev_ft != null ? { elev_ft: geo.elev_ft } : {}) };
    } else if (geo && geo.name === location && g.towns[location].elev_ft == null && geo.elev_ft != null) g.towns[location].elev_ft = geo.elev_ft;
    const at = g.panoramas.findIndex(p => (parseWhen(p.date, p.time) || 0) < when); // newest first
    g.panoramas.splice(at < 0 ? g.panoramas.length : at, 0, entry);
    const sha = await commitTree(SITE, head, [
      { path: file, mode: '100644', type: 'blob', sha: panoSha },
      { path: thumbFile, mode: '100644', type: 'blob', sha: thumbSha },
      { path: 'gallery.json', mode: '100644', type: 'blob', content: serialize(g) },
    ], `Add ${location} 360 from ${entry.date}${lock ? ' (locked)' : ''} via the upload page`);
    try { await gh(`/repos/${SITE}/git/refs/heads/main`, { method: 'PATCH', body: { sha } }); }
    catch (err) { if (err.status === 422 && attempt < 3) continue; throw err; }
    // done: clear it out of the inbox
    await gh(`/repos/${INBOX}/git/refs/heads/${c.branch.split('/').map(enc).join('/')}`, { method: 'DELETE' }).catch(() => {});
    site = g;
    cards.delete(c.branch);
    c.state = 'published';
    q('.review').hidden = true; q('.actions').hidden = true;
    q('.badge').textContent = 'published'; q('.badge').className = 'badge ready';
    c.note(`Live on mulvey.world in a minute or two${lock ? ', with a lock' : ''}.`, true);
    return;
  }
  throw new Error('The site kept changing underneath. Try publishing again.');
}

// ---------- start ----------
async function start() {
  $('connect').hidden = true;
  $('app').hidden = false;
  $('who').textContent = `connected to ${OWNER}/drone-site + drone-inbox`;
  await loadSite();
  refreshInbox();
}
if (token) {
  connect(token).then(start).catch(err => {
    $('connect').hidden = false;
    const msg = $('connectMsg'); msg.hidden = false;
    msg.textContent = err.status === 401 ? 'The saved key stopped working (expired or deleted). Make a new one below.' : err.message;
    if (err.status === 401) store.set('gh_token', null);
  });
} else $('connect').hidden = false;
