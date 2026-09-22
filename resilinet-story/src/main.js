import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import './style.css';

const chapters = [
  [
    'Connected',
    'An ordinary day. A vital connection.',
    'Homes connect through a local tower to the wider network. Families can call, message and ask for help.',
  ],
  [
    'The flood',
    'The village is dry. Its signal is gone.',
    'Floodwater blocks the road to the tower. Crews cannot reach it, backup power runs out, and nearby homes lose their connection.',
  ],
  [
    'The decision',
    'ResiliNet finds a place help can reach.',
    'It checks three things together: a safe road, homes within signal range, and a link to a working tower. The reachable hill wins.',
  ],
  [
    'Reconnected',
    'One portable tower. A way back online.',
    'A response team takes the safe route and raises a portable tower. It links to the working network and reconnects the village.',
  ],
];
const duration = 10;
let elapsed = 0;
let paused = matchMedia('(prefers-reduced-motion: reduce)').matches;
let lastChapter = -1;
document.querySelector('#app').innerHTML = `<main class="page">
<header class="masthead"><div class="brand">ResiliNet<span> / little world</span></div><div class="edition">An interactive explanation</div></header>
<section class="intro"><h1>Floods cut connections.<br><span>Better decisions bring them back.</span></h1><p class="purpose">See how ResiliNet helps response teams put a portable mobile tower where it can reconnect a community.</p></section>
<section class="world" aria-label="Animated 3D model of a village, flooded road and portable tower"><div class="canvas"></div><div class="labels"></div><div class="legend"><span style="--dot:#31ad7b">Connected</span><span style="--dot:#e87559">Disconnected</span><span style="--dot:#8970dd">Response route</span></div><div class="hint">Drag to turn the little world</div></section>
<section class="story"><div class="step-number">01</div><div aria-live="polite"><h2 id="title"></h2><p id="description"></p></div><div class="controls"><button class="control primary" id="pause"></button><button class="control" id="restart" aria-label="Restart the story">↺ Replay</button></div></section>
<nav class="steps" aria-label="Simulation chapters">${chapters.map((c, i) => `<button class="step" data-step="${i}"><small>Chapter 0${i + 1}</small><b>${c[0]}</b><span class="progress"></span></button>`).join('')}</nav>
<footer class="foot"><span>A simplified story · Illustrative landscape and timing, not a live forecast.</span><span>40-second loop · Real problem, miniature world.</span></footer></main>`;
const pauseButton = document.querySelector('#pause');
function syncPause() {
  pauseButton.textContent = paused ? '▶ Play' : 'Ⅱ Pause';
  pauseButton.setAttribute('aria-pressed', String(paused));
  pauseButton.setAttribute(
    'aria-label',
    paused ? 'Play simulation' : 'Pause simulation',
  );
}
pauseButton.onclick = () => {
  paused = !paused;
  syncPause();
};
document.querySelector('#restart').onclick = () => {
  elapsed = 0;
};
document.querySelectorAll('[data-step]').forEach(
  (b) =>
    (b.onclick = () => {
      elapsed = Number(b.dataset.step) * duration;
    }),
);
syncPause();

const holder = document.querySelector('.canvas');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
} catch {
  holder.innerHTML =
    '<div class="error">This 3D story needs WebGL. Try a browser with hardware acceleration enabled. You can still select the chapters below to read the story.</div>';
}
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 150);
camera.position.set(23, 22, 28);
const controls = renderer
  ? new OrbitControls(camera, renderer.domElement)
  : null;
if (renderer) {
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0xedf3ff, 0);
  holder.append(renderer.domElement);
}
if (controls) {
  controls.target.set(0, 0, 0);
  controls.enablePan = false;
  controls.enableZoom = false;
  controls.minPolarAngle = 0.35;
  controls.maxPolarAngle = 1.15;
  controls.enableDamping = true;
  controls.update();
}
scene.add(new THREE.HemisphereLight(0xffffff, 0x738091, 2));
const sun = new THREE.DirectionalLight(0xfff8e9, 3);
sun.position.set(-10, 22, 12);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, {
  left: -19,
  right: 19,
  top: 19,
  bottom: -19,
  near: 1,
  far: 70,
});
sun.shadow.normalBias = 0.05;
scene.add(sun);
const mat = (color, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 1, ...extra });
const C = {
  grass: mat('#a6cc83'),
  soil: mat('#aab3db'),
  hill: mat('#83b979', { flatShading: true }),
  road: mat('#fff1cc'),
  water: mat('#54c7ea', { transparent: true, opacity: 0.86 }),
  white: mat('#fff9ee'),
  roof: mat('#f3a475'),
  mint: mat('#37ae88'),
  red: mat('#ed775e'),
  purple: mat('#8b70dd'),
  dark: mat('#405775'),
};
function mesh(geo, material, x, y, z, parent = scene) {
  const o = new THREE.Mesh(geo, material);
  o.position.set(x, y, z);
  o.castShadow = true;
  o.receiveShadow = true;
  parent.add(o);
  return o;
}
function box(w, h, d, material, x, y, z, parent) {
  return mesh(new THREE.BoxGeometry(w, h, d), material, x, y, z, parent);
}
function cylinder(r, h, material, x, y, z, parent) {
  return mesh(
    new THREE.CylinderGeometry(r, r, h, 48),
    material,
    x,
    y,
    z,
    parent,
  );
}
// A purpose-built island; no real-world geography or operational data is used.
box(23, 1.3, 15, C.soil, 0, -0.85, 0);
box(23, 0.3, 15, C.grass, 0, -0.05, 0);
const ground = mesh(
  new THREE.PlaneGeometry(200, 200),
  new THREE.ShadowMaterial({ opacity: 0.12 }),
  0,
  -1.55,
  0,
);
ground.rotation.x = -Math.PI / 2;
ground.castShadow = false;
for (const [x, z, r, h] of [
  [-8, -4, 3, 3.4],
  [7, -4, 3.6, 3],
  [9, 3, 2.1, 2],
]) {
  mesh(new THREE.ConeGeometry(r, h, 5), C.hill, x, h / 2 - 0.05, z);
}
// River runs across the access road. Its wider floodplain appears in chapter 2.
box(2.2, 0.12, 15, C.water, -3, 0.2, 0);
const flood = box(6.3, 0.13, 15, C.water, -3, 0.25, 0);
flood.scale.x = 0.01;
function path(points, material, r = 0.13) {
  const curve = new THREE.CatmullRomCurve3(
    points.map((p) => new THREE.Vector3(...p)),
    false,
    'centripetal',
  );
  const line = mesh(
    new THREE.TubeGeometry(curve, 50, r, 6, false),
    material,
    0,
    0,
    0,
  );
  return { line, curve };
}
path(
  [
    [-10, 0.2, 4],
    [-5, 0.2, 4],
    [0, 0.2, 4],
    [5, 0.2, 4],
    [8, 0.2, 1],
  ],
  C.road,
  0.23,
);
box(3.8, 0.25, 1.1, C.white, -3, 0.39, 4);
path(
  [
    [0, 0.2, 4],
    [0, 0.2, 0],
    [0, 0.2, -3],
  ],
  C.road,
  0.2,
);
const safePath = path(
  [
    [-9, 0.55, 5],
    [-8, 0.55, 6],
    [-3, 0.55, 6.3],
    [2, 0.55, 6.2],
    [6, 0.55, 4.2],
    [6.7, 0.55, 1],
  ],
  C.purple,
  0.16,
);
// The safe southern route lies on an elevated causeway above floodwater.
path(
  [
    [-9, 0.14, 5],
    [-8, 0.14, 6],
    [-3, 0.14, 6.3],
    [2, 0.14, 6.2],
    [6, 0.14, 4.2],
    [6.7, 0.14, 1],
  ],
  C.white,
  0.33,
);
safePath.line.visible = false;
function house(x, z, index) {
  const g = new THREE.Group();
  g.position.set(x, 0.15, z);
  scene.add(g);
  box(0.9, 0.75, 0.85, C.white, 0, 0.375, 0, g);
  const roof = mesh(
    new THREE.ConeGeometry(0.85, 0.6, 4),
    index % 2 ? C.roof : C.purple,
    0,
    1.03,
    0,
    g,
  );
  roof.rotation.y = Math.PI / 4;
  box(0.22, 0.37, 0.03, C.dark, 0, 0.2, 0.44, g);
  box(0.2, 0.2, 0.04, C.water, 0.27, 0.48, 0.44, g);
  return g;
}
for (const [i, p] of [
  [2.2, -1],
  [3.7, -1],
  [5.2, -1],
  [2.2, 0.7],
  [3.7, 0.7],
  [5.2, 0.7],
  [2.2, 2.4],
  [3.7, 2.4],
].entries())
  house(...p, i);
for (let i = 0; i < 25; i++) {
  const x = -10 + ((i * 7) % 21),
    z = -6 + ((i * 11) % 12);
  if (Math.abs(x + 3) < 3.5 || (x > 1 && z > -2 && z < 4)) continue;
  const h = 0.7 + (i % 3) * 0.25;
  cylinder(0.11, 0.55, C.roof, x, 0.4, z);
  mesh(new THREE.ConeGeometry(0.47, h, 6), C.mint, x, h / 2 + 0.55, z);
}
function tower(x, z, portable = false) {
  const g = new THREE.Group();
  g.position.set(x, 0.2, z);
  scene.add(g);
  const steel = portable ? C.purple : C.white;
  box(1.3, 0.2, 1.1, C.dark, 0, 0.1, 0, g);
  for (const side of [-1, 1]) {
    const leg = box(0.13, 3.2, 0.13, steel, side * 0.3, 1.7, 0, g);
    leg.rotation.z = side * 0.12;
  }
  for (let i = 0; i < 4; i++) {
    box(0.8 - i * 0.1, 0.1, 0.12, steel, 0, 0.55 + i * 0.7, 0, g);
  }
  box(0.55, 0.6, 0.4, steel, 0, 3.4, 0, g);
  const beacon = mesh(
    new THREE.SphereGeometry(0.22, 12, 8),
    C.mint,
    0,
    3.95,
    0,
    g,
  );
  return { g, beacon };
}
tower(-8, -1);
const local = tower(0, -3),
  portable = tower(6.7, 1, true);
mesh(new THREE.CylinderGeometry(1, 1.4, 0.45, 7), C.hill, 6.7, 0.35, 1);
portable.g.position.y = 0.6;
portable.g.visible = false;
const truck = new THREE.Group();
scene.add(truck);
box(1.25, 0.5, 0.7, C.purple, 0, 0.55, 0, truck);
box(0.45, 0.65, 0.7, C.white, 0.65, 0.62, 0, truck);
for (const x of [-0.4, 0.55])
  for (const z of [-0.39, 0.39]) {
    const w = cylinder(0.19, 0.13, C.dark, x, 0.28, z, truck);
    w.rotation.x = Math.PI / 2;
  }
truck.visible = false;
function radio(a, b, color) {
  const pts = [
    a,
    [(a[0] + b[0]) / 2, Math.max(a[1], b[1]) + 3, (a[2] + b[2]) / 2],
    b,
  ];
  return path(
    pts,
    mat(color, { emissive: color, emissiveIntensity: 0.15 }),
    0.055,
  ).line;
}
const originalLink = radio([-8, 4, -1], [0, 4, -3], '#43ad83');
const rescueLink = radio([-8, 4, -1], [6.7, 4, 1], '#9b7bdd');
rescueLink.visible = false;
const localSignal = cylinder(
  3.2,
  0.035,
  mat('#4cd5a0', { transparent: true, opacity: 0.22, depthWrite: false }),
  3.7,
  0.32,
  0.8,
);
const rescueSignal = cylinder(
  4,
  0.035,
  mat('#4cd5a0', { transparent: true, opacity: 0.25, depthWrite: false }),
  5,
  0.34,
  1,
);
const ring = mesh(
  new THREE.TorusGeometry(1, 0.055, 8, 48),
  C.purple,
  6.7,
  0.6,
  1,
);
ring.rotation.x = -Math.PI / 2;
const blocked = box(1.2, 0.16, 0.2, C.red, -3, 0.8, 4);
blocked.rotation.z = 0.6;
const cloud = new THREE.Group();
scene.add(cloud);
cloud.position.set(-2, 7, -2);
for (const [x, y, z, r] of [
  [0, 0, 0, 1.3],
  [-1, 0, 0, 0.9],
  [1, 0, 0, 1],
  [0.2, 0.5, 0, 1],
])
  mesh(new THREE.SphereGeometry(r, 10, 8), mat('#c0cce4'), x, y, z, cloud);
const rain = new THREE.Group();
scene.add(rain);
for (let i = 0; i < 30; i++)
  box(
    0.025,
    0.3,
    0.025,
    C.water,
    -4 + ((i * 7) % 6),
    2 + (i % 5),
    -4 + ((i * 11) % 6),
    rain,
  );
const labels = [];
function label(id, pos, title, detail) {
  const el = document.createElement('div');
  el.className = 'map-label';
  el.dataset.label = id;
  el.innerHTML = `${title}<small>${detail}</small>`;
  document.querySelector('.labels').append(el);
  labels.push({ id, pos: new THREE.Vector3(...pos), el });
  return el;
}
label(
  'working',
  [-8, 5, -1],
  'Working network',
  'A connection to the outside world',
);
const towerLabel = label(
  'local',
  [0, 4.9, -3],
  'Village tower',
  'Powered and connected',
);
const villageLabel = label(
  'village',
  [3.5, 1, 5],
  '8 homes connected',
  'An illustrative community',
);
const responseLabel = label(
  'response',
  [6.7, 2.4, 1],
  'A reachable hill',
  'A safe route + a working network',
);
const roadLabel = label(
  'road',
  [-3, 1.2, 4],
  'Access road blocked',
  'Crews cannot reach the village tower',
);
const projection = new THREE.Vector3();
function resize() {
  const w = holder.clientWidth,
    h = holder.clientHeight;
  camera.aspect = w / h;
  camera.position.set(20, 19, 25).multiplyScalar(w < 650 ? 1.65 : 0.83);
  camera.updateProjectionMatrix();
  renderer?.setSize(w, h);
  controls?.update();
}
new ResizeObserver(resize).observe(holder);
resize();
function updateChapter(c) {
  document.querySelector('#title').textContent = chapters[c][1];
  document.querySelector('#description').textContent = chapters[c][2];
  document.querySelector('.step-number').textContent = `0${c + 1}`;
  document.querySelectorAll('[data-step]').forEach((b, i) => {
    b.classList.toggle('active', i === c);
    b.setAttribute('aria-current', i === c ? 'step' : 'false');
  });
  towerLabel.innerHTML =
    c === 0
      ? 'Village tower<small>Powered and connected</small>'
      : 'Village tower · offline<small>Backup power has run out</small>';
  towerLabel.dataset.tone = c === 0 ? 'good' : 'bad';
  responseLabel.innerHTML =
    c === 3
      ? 'Portable tower<small>Linked to the working network</small>'
      : 'The reachable hill<small>Safe road · homes in range · network link</small>';
}
let previous = performance.now();
function tick(now) {
  requestAnimationFrame(tick);
  const dt = Math.max(0, Math.min((now - previous) / 1000, 0.1));
  previous = now;
  if (!paused && !document.hidden) elapsed = (elapsed + dt) % (duration * 4);
  const c = Math.floor(elapsed / duration),
    t = (elapsed % duration) / duration;
  if (c !== lastChapter) {
    updateChapter(c);
    lastChapter = c;
  }
  const deployed = c === 3 && t > 0.48;
  const restored = c === 3 && t > 0.63;
  const connected = c === 0 || restored;
  flood.scale.x = c === 0 ? 0.01 : c === 1 ? Math.min(1, 0.01 + t * 2) : 1;
  cloud.visible = c === 1;
  rain.visible = c === 1;
  rain.children.forEach((o, i) => {
    o.position.y = 2 + ((((i * 0.7 - elapsed * 4) % 4) + 4) % 4);
  });
  local.beacon.material = c === 0 ? C.mint : C.red;
  originalLink.visible = c === 0;
  localSignal.visible = c === 0;
  rescueSignal.visible = restored;
  rescueLink.visible = restored;
  portable.g.visible = deployed;
  portable.g.scale.y = deployed ? Math.min(1, (t - 0.48) * 7) : 0.01;
  ring.visible = c >= 2;
  ring.scale.setScalar(c === 2 ? 1 + Math.sin(t * Math.PI * 4) * 0.1 : 1);
  safePath.line.visible = c >= 2;
  blocked.visible = c >= 1;
  truck.visible = c === 3;
  const pt = safePath.curve.getPointAt(Math.min(t / 0.48, 1));
  truck.position.copy(pt);
  const tangent = safePath.curve.getTangentAt(Math.min(t / 0.48, 0.999));
  truck.rotation.y = -Math.atan2(tangent.z, tangent.x);
  villageLabel.innerHTML = connected
    ? '8 homes connected<small>Families can reach help</small>'
    : '8 homes without signal<small>Dry homes still need a connection</small>';
  villageLabel.dataset.tone = connected ? 'good' : 'bad';
  if (c === 3)
    responseLabel.innerHTML = restored
      ? 'Portable tower<small>Linked to the working network</small>'
      : deployed
        ? 'Raising the tower<small>Preparing a new connection</small>'
        : 'Response on the way<small>Taking the safe road to the hill</small>';
  responseLabel.style.display = c >= 2 ? 'block' : 'none';
  roadLabel.style.display = c >= 1 ? 'block' : 'none';
  controls?.update();
  for (const item of labels) {
    projection.copy(item.pos).project(camera);
    item.el.style.left = `${(projection.x * 0.5 + 0.5) * holder.clientWidth}px`;
    item.el.style.top = `${(-projection.y * 0.5 + 0.5) * holder.clientHeight}px`;
  }
  document
    .querySelectorAll('.progress')
    .forEach(
      (p, i) => (p.style.width = `${i < c ? 100 : i === c ? t * 100 : 0}%`),
    );
  renderer?.render(scene, camera);
}
requestAnimationFrame(tick);
