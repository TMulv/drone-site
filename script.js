import * as THREE from 'three';

// ---------- setup ----------
const R = 8;                      // ring radius: you stand at the center
const CARD_W = 2.1, CARD_H = 2.8; // portrait cards, 3:4
const $ = id => document.getElementById(id);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 1, 0.05, 200);
camera.rotation.order = 'YXZ';
const ring = new THREE.Group();
scene.add(ring);
const loader = new THREE.TextureLoader();

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.fov = camera.aspect < 1 ? 62 : 55; // phones: widen a bit so neighbors peek in
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

// Plane bent onto the ring's curve, so each card wraps around you.
function curvedCard() {
  const g = new THREE.PlaneGeometry(CARD_W, CARD_H, 24, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const a = p.getX(i) / R;
    p.setX(i, R * Math.sin(a));
    p.setZ(i, R - R * Math.cos(a));
  }
  return g;
}

// Compass halo above the cards: a tick every 5°, longer every 45°, hanging down.
function compassRing(y) {
  const pts = [];
  for (let d = 0; d < 360; d += 5) {
    const a = THREE.MathUtils.degToRad(d), h = d % 45 === 0 ? 0.32 : 0.1;
    const x = Math.sin(a) * R, z = -Math.cos(a) * R;
    pts.push(x, y, z, x, y - h, z);
  }
  for (let d = 0; d < 360; d += 1) { // the circle itself
    const a = THREE.MathUtils.degToRad(d), b = THREE.MathUtils.degToRad(d + 1);
    pts.push(Math.sin(a) * R, y, -Math.cos(a) * R, Math.sin(b) * R, y, -Math.cos(b) * R);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x1b1a17, transparent: true, opacity: 0.35 }));
}
const floor = compassRing(2.75);
ring.add(floor);

// The 360 you step into. Inverted sphere that follows the camera.
const sphere = new THREE.Mesh(
  new THREE.SphereGeometry(50, 96, 48).scale(-1, 1, 1),
  new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
);
sphere.rotation.y = -Math.PI / 2; // turn the equirect's center to face -z, where the card was
sphere.renderOrder = -1;
sphere.visible = false;
scene.add(sphere);

// ---------- state ----------
let items = [], cards = [], step = 1;
let rot = 0, target = 0;          // ring rotation (radians)
let mode = 'ring';                // ring | entering | pano | leaving
let lon = 0, lat = 0, vLon = 0, vLat = 0; // look direction inside a pano (degrees)
let intro = 0, hovered = -1, front = -1;
const pointer = new THREE.Vector2(), look = new THREE.Vector2(); // parallax
const ray = new THREE.Raycaster();

const ease = t => 1 - Math.pow(1 - t, 3);
const easeInOut = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
function tween(ms, fn, e = ease) {
  return new Promise(done => {
    const t0 = performance.now();
    (function tick(now) {
      const t = Math.min(1, (now - t0) / ms);
      fn(e(t));
      t < 1 ? requestAnimationFrame(tick) : done();
    })(t0);
  });
}
const pad = n => String(n).padStart(2, '0');
const wrap = (a, m) => ((a % m) + m) % m;

// ---------- build the ring ----------
const data = await fetch('gallery.json').then(r => r.json());
items = data.panoramas || [];
step = (Math.PI * 2) / items.length;
$('total').textContent = pad(items.length);

const geo = curvedCard();
await Promise.all(items.map(async (it, i) => {
  const tex = await loader.loadAsync(it.thumb || it.file);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const card = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0 }));
  // scattered like prints pinned around a wall: staggered height, slight tilt
  const r1 = Math.sin(i * 12.9898) * 43758.5453 % 1, r2 = Math.sin(i * 78.233) * 12543.113 % 1;
  card.position.set(0, (i % 2 ? -1 : 1) * (0.25 + Math.abs(r1) * 0.55), -R);
  card.rotation.z = r2 * 0.09;
  card.userData = { i, baseY: card.position.y };
  const pivot = new THREE.Object3D();
  pivot.rotation.y = -i * step;
  pivot.add(card);
  ring.add(pivot);
  cards[i] = card;
}));
$('loader').classList.add('done');

// ---------- caption + compass ----------
function showCaption(i) {
  if (i === front) return;
  front = i;
  const it = items[i], cap = $('caption');
  cap.classList.add('swap');
  setTimeout(() => {
    $('idx').textContent = pad(i + 1);
    $('title').textContent = it.location;
    $('meta').replaceChildren(...[it.date, it.time, it.alt && 'alt ' + it.alt].filter(Boolean)
      .map(t => Object.assign(document.createElement('span'), { textContent: t })));
    cap.classList.remove('swap');
  }, 180);
}
function frontIndex() { return wrap(Math.round(rot / step), items.length); }

// ---------- input ----------
let dragging = false, moved = 0, last = null;
canvas.addEventListener('pointerdown', e => { dragging = true; moved = 0; last = [e.clientX, e.clientY]; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', e => {
  pointer.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  if (!dragging) return;
  const dx = e.clientX - last[0], dy = e.clientY - last[1];
  moved += Math.abs(dx) + Math.abs(dy); last = [e.clientX, e.clientY];
  if (mode === 'ring') target += dx * 0.004;
  if (mode === 'pano') { vLon = -dx * 0.12; vLat = dy * 0.12; lon += vLon; lat += vLat; }
});
canvas.addEventListener('pointerup', () => {
  dragging = false;
  if (moved < 6 && mode === 'ring' && hovered >= 0) enter(hovered);
});
addEventListener('wheel', e => {
  e.preventDefault();
  const d = e.deltaY + e.deltaX;
  if (mode === 'ring') target += d * 0.0012;
  if (mode === 'pano') vLon += d * 0.02; // scroll to look around
}, { passive: false });
addEventListener('keydown', e => {
  if (mode === 'ring') {
    if (e.key === 'ArrowRight') target = (Math.round(target / step) + 1) * step;
    if (e.key === 'ArrowLeft') target = (Math.round(target / step) - 1) * step;
    if (e.key === 'Enter') enter(frontIndex());
  }
  if (mode === 'pano') {
    if (e.key === 'Escape') leave();
    if (e.key === 'ArrowRight') vLon += 3;
    if (e.key === 'ArrowLeft') vLon -= 3;
  }
});
$('back').addEventListener('click', () => leave());

// ---------- hide text while turning ----------
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
function turning() { // called on every scroll/drag/arrow; text comes back ~1s after you stop
  if (!quietOn) return;
  document.body.classList.add('quiet');
  clearTimeout(quietTimer);
  quietTimer = setTimeout(() => document.body.classList.remove('quiet'), 1000);
}
addEventListener('wheel', turning, { passive: true });
canvas.addEventListener('pointermove', () => { if (dragging) turning(); });
addEventListener('keydown', e => { if (e.key.startsWith('Arrow')) turning(); });

// ---------- full screen ----------
const fsBtn = $('fs');
if (document.fullscreenEnabled) { // not on iPhone Safari, which only allows full screen for video
  fsBtn.hidden = false;
  const toggleFs = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
  fsBtn.addEventListener('click', toggleFs);
  addEventListener('keydown', e => { if (e.key === 'f' && !e.metaKey && !e.ctrlKey) toggleFs(); });
  document.addEventListener('fullscreenchange', () => { fsBtn.textContent = document.fullscreenElement ? 'exit full screen' : 'full screen'; });
}

// ---------- step inside ----------
let active = -1;
const DOLLY = R - 2.4; // how far the camera travels toward the card

async function enter(i) {
  if (mode !== 'ring') return;
  mode = 'entering'; active = i; hovered = -1; document.body.classList.remove('hovering');
  const texReady = loader.loadAsync(items[i].file).then(t => { t.colorSpace = THREE.SRGBColorSpace; return t; });
  showCaption(i);
  $('hint').textContent = 'stepping inside';

  // 1. spin the chosen card to dead center
  const from = rot, delta = Math.atan2(Math.sin(i * step - from), Math.cos(i * step - from)); // shortest way round
  const rx = camera.rotation.x, ry = camera.rotation.y; // settle the pointer parallax too
  await tween(650, t => { rot = target = from + delta * t; camera.rotation.set(rx * (1 - t), ry * (1 - t), 0); }, easeInOut);

  // 2. fly toward it while everything else falls away
  const card = cards[i], cy = card.userData.baseY, tilt = card.rotation.z;
  await tween(1100, t => {
    camera.position.set(0, cy * t, -DOLLY * t);
    camera.rotation.z = tilt * t; // match the card's lean so it lands square
    cards.forEach((c, j) => { if (j !== i) c.material.opacity = 1 - t; });
    floor.material.opacity = 0.35 * (1 - t);
    document.body.classList.toggle('inside', t > 0.55); // card fills the screen by now: switch UI to white
  }, easeInOut);

  // 3. dissolve the card into the full sphere (same framing: both face -z, horizon centered)
  const tex = await texReady;
  sphere.material.map = tex; sphere.material.needsUpdate = true;
  sphere.visible = true;
  lon = 0; lat = 0; vLon = vLat = 0;
  document.body.classList.add('inside');
  await tween(900, t => {
    sphere.material.opacity = t;
    card.material.opacity = 1 - t;
    camera.rotation.z = tilt * (1 - t);
  });
  ring.visible = false;
  mode = 'pano';
  $('back').hidden = false;
  $('hint').textContent = 'drag or scroll to look around · esc to leave';
}

async function leave() {
  if (mode !== 'pano') return;
  mode = 'leaving';
  $('back').hidden = true;
  const card = cards[active], cy = card.userData.baseY;
  // turn back to face the spot we came in through
  const l0 = ((lon + 180) % 360 + 360) % 360 - 180, la0 = lat;
  await tween(600, t => { lon = l0 * (1 - t); lat = la0 * (1 - t); }, easeInOut);
  ring.visible = true;
  document.body.classList.remove('inside');
  await tween(700, t => { sphere.material.opacity = 1 - t; card.material.opacity = t; });
  sphere.visible = false;
  await tween(1000, t => {
    camera.position.set(0, cy * (1 - t), -DOLLY * (1 - t));
    cards.forEach((c, j) => { if (j !== active) c.material.opacity = t; });
    floor.material.opacity = 0.35 * t;
  }, easeInOut);
  mode = 'ring';
  $('hint').textContent = 'scroll to turn · click to step inside';
}

// ---------- loop ----------
function frame(now) {
  if (mode === 'ring') {
    if (!dragging && !reduceMotion) target += 0.00035; // slow drift, like hovering in place
    rot += (target - rot) * 0.075;

    // intro: cards bloom in one after another
    intro = Math.min(1, intro + 0.012);
    cards.forEach((c, i) => {
      const t = ease(THREE.MathUtils.clamp(intro * 1.6 - i * 0.03, 0, 1));
      c.material.opacity = t;
      const s = (0.85 + 0.15 * t) * (i === hovered ? 1.05 : 1);
      c.scale.lerp(new THREE.Vector3(s, s, 1), 0.15);
    });

    // hover
    ray.setFromCamera(pointer, camera);
    const hit = ray.intersectObjects(cards)[0];
    hovered = hit ? hit.object.userData.i : -1;
    document.body.classList.toggle('hovering', hovered >= 0);

    // gentle parallax toward the pointer
    look.lerp(pointer, 0.05);
    camera.rotation.set(look.y * 0.06, -look.x * 0.08, 0);
    showCaption(frontIndex());
  }
  ring.rotation.y = rot;

  if (mode === 'pano' || mode === 'leaving' || (mode === 'entering' && sphere.visible)) {
    if (mode === 'pano' && !dragging) { lon += vLon; lat += vLat; vLon *= 0.92; vLat *= 0.92; }
    lat = THREE.MathUtils.clamp(lat, -85, 85);
    if (mode !== 'entering') {
      const phi = THREE.MathUtils.degToRad(lat), th = THREE.MathUtils.degToRad(lon);
      const dir = new THREE.Vector3(Math.sin(th) * Math.cos(phi), Math.sin(phi), -Math.cos(th) * Math.cos(phi));
      camera.lookAt(camera.position.clone().add(dir));
    }
    sphere.position.copy(camera.position);
  }

  // compass: heading follows the ring (or your look direction inside)
  const hdg = Math.round(wrap(mode === 'pano' || mode === 'leaving' ? lon : THREE.MathUtils.radToDeg(rot), 360));
  $('hdg').textContent = String(hdg).padStart(3, '0');
  $('tape').style.backgroundPositionX = `${-hdg * 1.6}px, ${-hdg * 1.6}px`;

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
