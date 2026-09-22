/* The landing diorama: a synthetic Kuala Krai river-valley block where connectivity breaks
   and gets repaired. Ported from the standalone concept piece so the app and
   the shareable artefact tell the same story from the same code.

   Two rules hold this together. Everything visible is a pure function of loop
   time, so the piece is deterministic and seekable. And the scene never
   touches the page: it reports overlay state through callbacks, and React
   owns every pixel of chrome. */

import * as THREE from "three";

import {
  ACT_STARTS,
  LOOP_SECONDS,
  actIndexAt,
  beatIndexAt,
  chipAt,
  clamp,
  lerp,
  pop,
  ss,
  stageMetresAt,
  tipAt,
  type ChipState,
} from "./landingModel";

export interface ConceptFrame {
  t: number;
  chip: ChipState;
  stageM: number;
  /** Pointer position in CSS pixels while the placement beat runs. */
  cursor: { x: number; y: number; opacity: number } | null;
  tip: { title: string; detail: string };
  ring: { x: number; y: number; size: number; opacity: number };
}

export interface ConceptHandle {
  seek(t: number): void;
  setPlaying(playing: boolean): void;
  isPlaying(): boolean;
  actStart(index: number): void;
  dispose(): void;
}

export interface ConceptOptions {
  onFrame(frame: ConceptFrame): void;
  onBeat(index: number): void;
  onAct(index: number): void;
  onPlayingChange(playing: boolean): void;
  reducedMotion: boolean;
}

// ---------- deterministic helpers ----------
function mulberry32(a: number): () => number {
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lattice = (ix: number, iz: number): number =>
  mulberry32(((ix * 73856093) ^ (iz * 19349663) ^ 0x2718) >>> 0)() * 2 - 1;

function noise(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = lattice(ix, iz);
  const b = lattice(ix + 1, iz);
  const c = lattice(ix, iz + 1);
  const d = lattice(ix + 1, iz + 1);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

const dist2 = (x1: number, z1: number, x2: number, z2: number): number =>
  Math.hypot(x1 - x2, z1 - z2);

// ---------- palette (the product's design law, in scene form) ----------
const TEAL = new THREE.Color("#0e7c86");
const RED = new THREE.Color("#a32a2a");
const C_GRASS = new THREE.Color("#a4ba80");
const C_UP = new THREE.Color("#7e9a68");
const C_ROCK = new THREE.Color("#8e8878");
const C_SAND = new THREE.Color("#cfc39d");
const C_EARTH = new THREE.Color("#6d5c49");
const C_BUILD = new THREE.Color("#f0ece1");
const DEAD_GREY = new THREE.Color("#7d868c");
const C_WATER = "#3f6db3";
const PAGE_BG = "#eef1f2";

// ---------- terrain ----------
const HALF = 7;

function hf(x: number, z: number): number {
  let h = 0.3 + 0.07 * noise(x * 0.35, z * 0.35) + 0.035 * noise(x * 0.9 + 11, z * 0.9 + 5);
  // back mountain range, taller toward +x
  const r = ss(z, -1.2, -5.8);
  h += r * (3.3 + 0.9 * noise(x * 0.45, 3.7)) * (0.65 + 0.35 * ss(x, -6, 4));
  // shoulder foothill between range and plain: it blocks the far-ridge signal
  h += 2.5 * Math.exp(-(((x - 0.9) ** 2) + ((z + 1.2) ** 2)) / 2.0);
  // the engine's knoll
  h += 0.72 * Math.exp(-(((x - 2.6) ** 2) + ((z - 1.6) ** 2)) / 0.85);
  // rise toward the east edge: the dry corridor the access road follows
  h += 0.75 * ss(x, 2.9, 5.6) * (1 - ss(z, -1.2, -5.8));
  // patchy micro-relief, so the flood takes low ground and leaves islands
  h += 0.22 * Math.max(0, noise(x * 0.85 + 4, z * 0.85 - 7)) * (1 - ss(z, -1.2, -5.8));
  // shallow basin keeps the town low
  h -= 0.07 * Math.exp(-(((x + 1.6) ** 2) + ((z - 4.0) ** 2)) / 1.4);
  // raised ground under the grid-fed tower: it stays dry, and still goes dark
  h += 0.55 * Math.exp(-(((x + 3.6) ** 2) + ((z - 4.2) ** 2)) / 0.22);
  // A winding river and tributary replace the coastal shoreline. This is a
  // diagram of Kuala Krai's river-valley setting, not surveyed geography.
  const riverX = -4.8 + Math.sin(z * 0.65) * 0.5;
  const river = 1 - ss(Math.abs(x - riverX), 0.18, 0.7);
  const tributaryX = -4.8 + Math.max(0, z + 1.5) * 0.48;
  const tributary = (1 - ss(Math.abs(x - tributaryX), 0.12, 0.48)) * ss(z, -1.5, 0);
  h = lerp(h, -0.16, Math.max(river, tributary));
  return h;
}

type Spot = readonly [number, number];

const VILLAGES: Spot[] = [
  [-4.8, 2.2],
  [-1.6, 4.0],
  [-3.2, 0.6],
  [0.6, 3.2],
  [2.2, 4.6],
  [-0.8, 1.2],
  [3.8, 2.8],
];
const TOWN = 1;
const HAMLET: Spot = [2.7, 1.7];
const VALLEY_TOWER: Spot = [-3.6, 4.2];
const GHOST_RIDGE: Spot = [2.6, -4.6];
const KNOLL: Spot = [2.6, 1.6];
const RIVER_LEVEL = 0.06;
const FLOOD_LEVEL = 0.54;
const DOME_VALLEY_R = 9.5;
const DOME_KNOLL_R = 6.2;

interface Tower {
  group: THREE.Group;
  accents: THREE.MeshStandardMaterial[];
}

interface Dome {
  group: THREE.Group;
  shell: THREE.MeshBasicMaterial;
  ring: THREE.MeshBasicMaterial;
}

export function createConceptScene(
  canvas: HTMLCanvasElement,
  opts: ConceptOptions,
): ConceptHandle {
  const rnd = mulberry32(20260729);
  const { reducedMotion } = opts;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PAGE_BG);
  const camera = new THREE.PerspectiveCamera(38, 2, 0.1, 100);
  const TARGET = new THREE.Vector3(0, 0.6, 0);

  scene.add(new THREE.HemisphereLight(0xf4f6f6, 0x9a917c, 1.05));
  const sun = new THREE.DirectionalLight(0xffffff, 1.7);
  sun.position.set(6, 9, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const shadowCam = sun.shadow.camera;
  shadowCam.left = -9.5;
  shadowCam.right = 9.5;
  shadowCam.top = 9.5;
  shadowCam.bottom = -9.5;
  shadowCam.near = 1;
  shadowCam.far = 40;
  shadowCam.updateProjectionMatrix();
  sun.shadow.bias = -0.0004;
  scene.add(sun);

  const block = new THREE.Group();
  scene.add(block);

  // ---------- terrain mesh, vertex-coloured, with a cut-specimen skirt ----------
  {
    const N = 120;
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= N; i++) {
      for (let j = 0; j <= N; j++) {
        const x = -HALF + (2 * HALF * i) / N;
        const z = -HALF + (2 * HALF * j) / N;
        const h = hf(x, z);
        pos.push(x, h, z);
        const up = ss(h, 0.55, 1.6);
        const rock = ss(h, 1.35, 2.3);
        const sand = 1 - ss(h, 0.1, 0.3);
        const c = C_GRASS.clone().lerp(C_UP, up).lerp(C_ROCK, rock).lerp(C_SAND, sand);
        c.offsetHSL(noise(x * 3.1, z * 3.1) * 0.012, 0, noise(x * 2.2 + 9, z * 2.2) * 0.02);
        col.push(c.r, c.g, c.b);
      }
    }
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const a = i * (N + 1) + j;
        const b = a + N + 1;
        idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
    const y0 = -1.35;
    let sIdx = pos.length / 3;
    const quads: number[] = [];
    const push = (x: number, y: number, z: number): number => {
      pos.push(x, y, z);
      col.push(C_EARTH.r, C_EARTH.g, C_EARTH.b);
      return sIdx++;
    };
    const rim = (i: number, j: number): [number, number] => [
      -HALF + (2 * HALF * i) / N,
      -HALF + (2 * HALF * j) / N,
    ];
    const wall = (i1: number, j1: number, i2: number, j2: number): void => {
      const [x1, z1] = rim(i1, j1);
      const [x2, z2] = rim(i2, j2);
      const a = push(x1, hf(x1, z1), z1);
      const b = push(x2, hf(x2, z2), z2);
      const c = push(x2, y0, z2);
      const d = push(x1, y0, z1);
      quads.push(a, b, c, a, c, d);
    };
    for (let k = 0; k < N; k++) {
      wall(k, 0, k + 1, 0);
      wall(k + 1, N, k, N);
      wall(0, k + 1, 0, k);
      wall(N, k, N, k + 1);
    }
    const b1 = push(-HALF, y0, -HALF);
    const b2 = push(HALF, y0, -HALF);
    const b3 = push(HALF, y0, HALF);
    const b4 = push(-HALF, y0, HALF);
    quads.push(b1, b3, b2, b1, b4, b3);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx.concat(quads));
    geo.computeVertexNormals();
    const terrain = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        flatShading: true,
        roughness: 0.95,
        metalness: 0,
      }),
    );
    terrain.receiveShadow = true;
    block.add(terrain);
  }

  // ---------- water ----------
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(2 * HALF - 0.02, 2 * HALF - 0.02),
    new THREE.MeshStandardMaterial({
      color: C_WATER,
      transparent: true,
      opacity: 0.55,
      roughness: 0.3,
      metalness: 0,
    }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = RIVER_LEVEL;
  water.renderOrder = 2;
  block.add(water);

  // ---------- sprites ----------
  function markSprite(color: string): THREE.Sprite {
    const cv = document.createElement("canvas");
    cv.width = 128;
    cv.height = 128;
    const c = cv.getContext("2d");
    if (c) {
      c.beginPath();
      c.arc(64, 64, 56, 0, Math.PI * 2);
      c.fillStyle = "rgba(255,255,255,0.94)";
      c.fill();
      c.lineWidth = 7;
      c.strokeStyle = color;
      c.stroke();
      c.lineWidth = 11;
      c.lineCap = "round";
      c.beginPath();
      c.moveTo(42, 42);
      c.lineTo(86, 86);
      c.moveTo(86, 42);
      c.lineTo(42, 86);
      c.stroke();
    }
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthTest: false }),
    );
    sprite.renderOrder = 10;
    return sprite;
  }

  // ---------- roads: half-sunk tubes that follow the ground ----------
  function roadCurve(way: Spot[], lift: number): THREE.CatmullRomCurve3 {
    const rough = way.map(([x, z]) => new THREE.Vector3(x, hf(x, z), z));
    const pts = new THREE.CatmullRomCurve3(rough)
      .getPoints(180)
      .map((q) => new THREE.Vector3(q.x, hf(q.x, q.z) + lift, q.z));
    return new THREE.CatmullRomCurve3(pts);
  }

  function buildRoad(way: Spot[]): void {
    const road = new THREE.Mesh(
      new THREE.TubeGeometry(roadCurve(way, 0.012), 220, 0.055, 6, false),
      new THREE.MeshStandardMaterial({ color: "#cfc9ba", roughness: 1 }),
    );
    block.add(road);
  }

  const ROAD_EAST: Spot[] = [KNOLL, [4.4, 0.9], [6.95, 0.2]];
  buildRoad([VALLEY_TOWER, [-1.6, 4.0], [0.6, 3.2], [2.2, 4.6], [3.8, 2.8]]);
  buildRoad([[-1.6, 4.0], [-0.8, 1.2], [-3.2, 0.6], [-4.8, 2.2]]);
  buildRoad([[0.6, 3.2], [1.8, 2.3], KNOLL]); // western approach, which drowns
  buildRoad(ROAD_EAST);

  const accessMat = new THREE.MeshBasicMaterial({
    color: TEAL,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const accessGlow = new THREE.Mesh(
    new THREE.TubeGeometry(roadCurve(ROAD_EAST, 0.03), 220, 0.075, 6, false),
    accessMat,
  );
  accessGlow.renderOrder = 6;
  block.add(accessGlow);

  // generator truck route, from the dry east edge toward the dark site
  const routeCurve = roadCurve(
    [[6.95, 0.2], [4.4, 0.9], KNOLL, [1.8, 2.3], [0.6, 3.2], [-1.6, 4.0], VALLEY_TOWER],
    0.035,
  );
  const routePts = routeCurve.getPoints(220);
  let wetIdx = routePts.length - 1;
  for (let i = 0; i < routePts.length; i++) {
    const p = routePts[i]!;
    if (hf(p.x, p.z) < FLOOD_LEVEL - 0.03) {
      wetIdx = i;
      break;
    }
  }
  const ROUTE_FRAC = wetIdx / (routePts.length - 1);
  const routeMat = new THREE.MeshBasicMaterial({
    color: "#7d868c",
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const routeGlow = new THREE.Mesh(new THREE.TubeGeometry(routeCurve, 220, 0.08, 6, false), routeMat);
  routeGlow.renderOrder = 6;
  block.add(routeGlow);
  const routeCross = markSprite("#7d868c");
  routeCross.position.copy(routePts[wetIdx]!).add(new THREE.Vector3(0, 0.35, 0));
  block.add(routeCross);

  // ---------- buildings ----------
  interface Building {
    x: number;
    z: number;
    h: number;
    s: number;
    rot: number;
  }
  const buildings: Building[] = [];
  {
    const clusters = VILLAGES.map((v, i) => ({
      c: v,
      n: i === TOWN ? 46 : 20,
      r: i === TOWN ? 0.85 : 0.58,
    })).concat([{ c: HAMLET, n: 10, r: 0.45 }]);

    for (const cluster of clusters) {
      for (let i = 0; i < cluster.n; i++) {
        const a = rnd() * Math.PI * 2;
        const r = 0.12 + Math.sqrt(rnd()) * cluster.r;
        const x = cluster.c[0] + Math.cos(a) * r;
        const z = cluster.c[1] + Math.sin(a) * r * 0.85;
        const h = hf(x, z);
        if (h < 0.14 || Math.abs(h - hf(cluster.c[0], cluster.c[1])) > 0.3) continue;
        buildings.push({ x, z, h, s: 0.75 + rnd() * 0.7, rot: rnd() * Math.PI });
      }
    }
    for (let i = 0; i < 42; i++) {
      // scattered farms across the plain
      const x = -HALF + 1 + rnd() * (2 * HALF - 2);
      const z = -0.4 + rnd() * 6.2;
      const h = hf(x, z);
      if (h < 0.16 || h > 0.52) continue;
      buildings.push({ x, z, h, s: 0.6 + rnd() * 0.5, rot: rnd() * Math.PI });
    }

    const im = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.135, 0.26, 0.105),
      new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }),
      buildings.length,
    );
    const dummy = new THREE.Object3D();
    const colour = new THREE.Color();
    buildings.forEach((b, i) => {
      dummy.position.set(b.x, b.h + 0.12 * b.s, b.z);
      dummy.rotation.y = b.rot;
      dummy.scale.setScalar(b.s);
      dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
      colour.copy(C_BUILD).offsetHSL(0, 0, (rnd() - 0.5) * 0.06);
      im.setColorAt(i, colour);
    });
    im.castShadow = true;
    im.receiveShadow = true;
    block.add(im);
  }

  // ---------- people ----------
  interface Person {
    x: number;
    z: number;
    y: number;
    dValley: number;
    dKnoll: number;
  }
  const people: Person[] = [];
  for (const b of buildings) {
    const n = 2 + Math.floor(rnd() * 2.2);
    for (let i = 0; i < n; i++) {
      const x = b.x + (rnd() - 0.5) * 0.34;
      const z = b.z + (rnd() - 0.5) * 0.34;
      const h = hf(x, z);
      if (h < 0.14) continue;
      people.push({
        x,
        z,
        y: h + 0.05,
        dValley: dist2(x, z, VALLEY_TOWER[0], VALLEY_TOWER[1]),
        dKnoll: dist2(x, z, KNOLL[0], KNOLL[1]),
      });
    }
  }
  const peopleMesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.037, 10, 8),
    new THREE.MeshStandardMaterial({ roughness: 0.6 }),
    people.length,
  );
  {
    const dummy = new THREE.Object3D();
    people.forEach((p, i) => {
      dummy.position.set(p.x, p.y, p.z);
      dummy.updateMatrix();
      peopleMesh.setMatrixAt(i, dummy.matrix);
      peopleMesh.setColorAt(i, TEAL);
    });
    peopleMesh.castShadow = true;
    block.add(peopleMesh);
  }

  // ---------- towers ----------
  function makeTower(accent: string, ghost: boolean): Tower {
    const group = new THREE.Group();
    const mat = (c: string): THREE.MeshStandardMaterial =>
      new THREE.MeshStandardMaterial({
        color: c,
        roughness: 0.55,
        flatShading: true,
        transparent: ghost,
        opacity: ghost ? 0.55 : 1,
      });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.05, 10), mat("#8f8a80"));
    base.position.y = 0.025;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.027, 0.7, 7), mat("#5c6166"));
    mast.position.y = 0.39;
    const headMat = mat(accent);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.042, 0.042), headMat);
    head.position.y = 0.765;
    const tipMat = mat(accent);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.024, 8, 8), tipMat);
    tip.position.y = 0.815;
    group.add(base, mast, head, tip);
    if (!ghost) {
      group.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = true;
      });
    }
    return { group, accents: [headMat, tipMat] };
  }

  const seat = <T extends THREE.Object3D>([x, z]: Spot, obj: T, lift = 0): T => {
    obj.position.set(x, hf(x, z) + lift, z);
    return obj;
  };

  const valleyTower = makeTower("#0e7c86", false);
  seat(VALLEY_TOWER, valleyTower.group);
  const ghostTower = makeTower("#5c6166", true);
  seat(GHOST_RIDGE, ghostTower.group);
  const engineTower = makeTower("#0e7c86", false);
  seat(KNOLL, engineTower.group);
  engineTower.group.scale.setScalar(1.05);
  block.add(valleyTower.group, ghostTower.group, engineTower.group);

  // ---------- coverage domes ----------
  function makeDome(): Dome {
    const group = new THREE.Group();
    const shell = new THREE.MeshBasicMaterial({
      color: TEAL,
      transparent: true,
      opacity: 0.04,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const ringMat = new THREE.MeshBasicMaterial({
      color: TEAL,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(1, 48, 20, 0, Math.PI * 2, 0, Math.PI / 2),
      shell,
    );
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.985, 1, 96), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    group.add(dome, ring);
    group.renderOrder = 5;
    return { group, shell, ring: ringMat };
  }

  const domeValley = makeDome();
  seat(VALLEY_TOWER, domeValley.group, 0.02);
  const domeKnoll = makeDome();
  seat(KNOLL, domeKnoll.group, 0.02);
  block.add(domeValley.group, domeKnoll.group);

  // ---------- blocked signal beam from the ridge toward the town ----------
  const impact = new THREE.Vector3();
  let beamLen = 1;
  const beam = (() => {
    const from = new THREE.Vector3(
      GHOST_RIDGE[0],
      hf(GHOST_RIDGE[0], GHOST_RIDGE[1]) + 0.82,
      GHOST_RIDGE[1],
    );
    const town = VILLAGES[TOWN]!;
    const to = new THREE.Vector3(town[0], hf(town[0], town[1]) + 0.25, town[1]);
    for (let f = 0.02; f <= 1; f += 0.005) {
      const p = from.clone().lerp(to, f);
      if (p.y < hf(p.x, p.z) + 0.04) {
        impact.copy(p);
        break;
      }
      impact.copy(p);
    }
    beamLen = from.distanceTo(impact);
    const dir = impact.clone().sub(from).normalize();
    const geo = new THREE.CylinderGeometry(0.014, 0.014, 1, 6);
    geo.translate(0, 0.5, 0);
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ color: "#7d868c", transparent: true, opacity: 0.85 }),
    );
    mesh.position.copy(from);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    block.add(mesh);
    return mesh;
  })();
  const beamMat = beam.material as THREE.MeshBasicMaterial;

  const beamCross = markSprite("#7d868c");
  beamCross.position.copy(impact).add(new THREE.Vector3(0, 0.35, 0));
  block.add(beamCross);

  // ---------- candidate sweep ----------
  interface Candidate {
    x: number;
    z: number;
    h: number;
    start: number;
  }
  const candidates: Candidate[] = [];
  for (let x = -6.6; x <= 6.6; x += 0.62) {
    for (let z = -6.6; z <= 6.6; z += 0.62) {
      const h = hf(x, z);
      if (
        h > 0.66 &&
        h < 3.6 &&
        Math.abs(hf(x + 0.26, z) - h) < 0.3 &&
        Math.abs(hf(x, z + 0.26) - h) < 0.3
      ) {
        candidates.push({ x, z, h, start: 21.2 + (x + 7 + (z + 7)) * 0.085 });
      }
    }
  }
  const candMat = new THREE.MeshBasicMaterial({
    color: TEAL,
    transparent: true,
    opacity: 0.8,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const candMesh = new THREE.InstancedMesh(
    new THREE.CircleGeometry(0.095, 12),
    candMat,
    candidates.length,
  );
  candMesh.renderOrder = 6;
  block.add(candMesh);

  const pulseMat = new THREE.MeshBasicMaterial({
    color: TEAL,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const pulse = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 64), pulseMat);
  seat(KNOLL, pulse, 0.03);
  pulse.rotation.x = -Math.PI / 2;
  pulse.renderOrder = 6;
  block.add(pulse);

  // ---------- contact shadow ----------
  {
    const cv = document.createElement("canvas");
    cv.width = 256;
    cv.height = 256;
    const c = cv.getContext("2d");
    if (c) {
      const g = c.createRadialGradient(128, 128, 10, 128, 128, 126);
      g.addColorStop(0, "rgba(30,35,38,0.55)");
      g.addColorStop(1, "rgba(30,35,38,0)");
      c.fillStyle = g;
      c.fillRect(0, 0, 256, 256);
    }
    const blob = new THREE.Mesh(
      new THREE.PlaneGeometry(21, 21),
      new THREE.MeshBasicMaterial({
        map: new THREE.CanvasTexture(cv),
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
      }),
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = -2.1;
    scene.add(blob);
  }

  // ---------- per-frame state ----------
  const candDummy = new THREE.Object3D();
  const personColour = new THREE.Color();
  const holdPoint = new THREE.Vector3();
  let lastBeat = -1;
  let lastAct = -1;

  function applyState(t: number): void {
    const flood = ss(t, 6.4, 9.6);
    water.position.y = lerp(RIVER_LEVEL, FLOOD_LEVEL, flood) + Math.sin(t * 1.7) * 0.008;

    // the serving tower goes grey: dry, and dark
    const dead = ss(t, 8.2, 8.9);
    for (const m of valleyTower.accents) m.color.copy(TEAL).lerp(DEAD_GREY, dead);

    const flicker =
      t < 7.2 ? 1 : t < 8.2 ? (Math.sin(t * 41) * Math.sin(t * 13.7) > -0.25 ? 0.85 : 0.15) : 0;
    const aliveScale = DOME_VALLEY_R * (t < 8.2 ? 1 : Math.max(0.0001, 1 - ss(t, 8.2, 9.0)));
    domeValley.group.scale.setScalar(Math.max(0.0001, aliveScale));
    domeValley.shell.opacity = 0.04 * flicker;
    domeValley.ring.opacity = 0.5 * flicker;

    // the generator route draws in from the east and dies at the water line
    const routeProg = ss(t, 13.5, 15.2);
    routeGlow.geometry.setDrawRange(
      0,
      Math.max(0, Math.floor(220 * ROUTE_FRAC * routeProg)) * 36,
    );
    routeMat.opacity = t > 13.4 && t < 21.1 ? 0.9 * (1 - ss(t, 20.5, 21.1)) : 0;
    routeCross.scale.setScalar(
      Math.max(0.0001, 0.4 * pop(t, 15.35, 0.5) * (1 - ss(t, 20.5, 21.1))),
    );

    const ghostScale = pop(t, 17.3, 0.5) * (1 - ss(t, 20.6, 21.2));
    ghostTower.group.scale.setScalar(Math.max(0.0001, ghostScale));
    beam.scale.y = beamLen * ss(t, 17.7, 18.5) * (1 - ss(t, 20.6, 21.2));
    beamMat.opacity = t > 17.7 && t < 21.2 ? 0.85 : 0;
    beamCross.scale.setScalar(
      Math.max(0.0001, 0.4 * pop(t, 18.6, 0.5) * (1 - ss(t, 20.6, 21.2))),
    );

    const fadeAll = 1 - ss(t, 24.0, 24.8);
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i]!;
      candDummy.position.set(c.x, c.h + 0.045, c.z);
      candDummy.rotation.x = -Math.PI / 2;
      candDummy.scale.setScalar(Math.max(0.0001, pop(t, c.start, 0.5) * fadeAll));
      candDummy.updateMatrix();
      candMesh.setMatrixAt(i, candDummy.matrix);
    }
    candMesh.instanceMatrix.needsUpdate = true;
    candMat.opacity = t > 21 && t < 25 ? 0.8 : 0;

    // the winning knoll pulses, then a hand carries the tower in and drops it
    const pr = (t - 23.9) % 1.1;
    const pulseOn = t > 23.9 && t < 26.45;
    pulse.scale.setScalar(pulseOn ? 0.6 + pr * 2.2 : 0.0001);
    pulseMat.opacity = pulseOn ? 0.55 * (1 - pr / 1.1) : 0;

    const hK = hf(KNOLL[0], KNOLL[1]);
    const carry = ss(t, 24.25, 25.45);
    const drop = ss(t, 26.4, 26.9);
    engineTower.group.scale.setScalar(Math.max(0.0001, 1.05 * pop(t, 24.25, 0.45)));
    engineTower.group.position.set(
      lerp(5.9, KNOLL[0], carry),
      lerp(hK + 2.3, hK + 0.55, carry) + Math.sin(carry * Math.PI) * 0.4 - drop * 0.55,
      lerp(4.6, KNOLL[1], carry),
    );
    accessMat.opacity = 0.9 * ss(t, 26.75, 27.55);

    const grow = ss(t, 26.85, 28.25);
    domeKnoll.group.scale.setScalar(Math.max(0.0001, DOME_KNOLL_R * grow));
    domeKnoll.shell.opacity = 0.04 * grow;
    domeKnoll.ring.opacity = 0.5 * grow;

    for (let i = 0; i < people.length; i++) {
      const p = people[i]!;
      const fRed = ss(t, 8.6 + (p.dValley / 11) * 2.2, 9.2 + (p.dValley / 11) * 2.2);
      const inDome = p.dKnoll <= DOME_KNOLL_R;
      const fBack = inDome
        ? ss(t, 27.05 + (p.dKnoll / 6.5) * 1.7, 27.65 + (p.dKnoll / 6.5) * 1.7)
        : 0;
      personColour.copy(TEAL).lerp(RED, fRed).lerp(TEAL, fBack);
      peopleMesh.setColorAt(i, personColour);
    }
    if (peopleMesh.instanceColor) peopleMesh.instanceColor.needsUpdate = true;

    block.position.y = reducedMotion ? 0 : Math.sin(t * 0.45) * 0.05;

    // overlay state, reported rather than written
    const beatIndex = beatIndexAt(t);
    if (beatIndex !== lastBeat) {
      lastBeat = beatIndex;
      opts.onBeat(beatIndex);
    }
    const act = actIndexAt(t);
    if (act !== lastAct) {
      lastAct = act;
      opts.onAct(act);
    }

    const cursorOpacity = ss(t, 24.1, 24.4) * (1 - ss(t, 27.15, 27.65));
    let cursor: ConceptFrame["cursor"] = null;
    let ring = { x: 0, y: 0, size: 0, opacity: 0 };
    if (cursorOpacity > 0.001) {
      holdPoint
        .set(
          engineTower.group.position.x + 0.05,
          engineTower.group.position.y + 0.5,
          engineTower.group.position.z,
        )
        .project(camera);
      const sx = (holdPoint.x * 0.5 + 0.5) * canvas.clientWidth;
      const sy = (-holdPoint.y * 0.5 + 0.5) * canvas.clientHeight;
      cursor = { x: sx, y: sy, opacity: cursorOpacity };
      const rp = ss(t, 26.4, 26.85);
      ring = { x: sx, y: sy, size: 14 + rp * 48, opacity: rp > 0 && rp < 1 ? 0.9 * (1 - rp) : 0 };
    }

    opts.onFrame({
      t,
      chip: chipAt(t),
      stageM: stageMetresAt(t),
      cursor,
      tip: tipAt(t),
      ring,
    });
  }

  // ---------- camera ----------
  let theta = 0.62;
  let phi = 1.03;
  let radius = 19.2;
  let userHold = -10;

  function placeCamera(t: number): void {
    const drift = reducedMotion ? 0 : Math.sin(t * 0.055) * 0.07;
    const th = theta + (t - userHold > 4 ? drift : 0);
    // The framing is tuned on a 16:9 stage. Vertical field of view is fixed,
    // so a narrower window would crop the block sideways; pull back instead.
    const fit = clamp(1.78 / camera.aspect, 1, 3.2);
    const r = radius * fit;
    camera.position.set(
      TARGET.x + r * Math.sin(phi) * Math.sin(th),
      TARGET.y + r * Math.cos(phi),
      TARGET.z + r * Math.sin(phi) * Math.cos(th),
    );
    camera.lookAt(TARGET);
  }

  let dragging = false;
  let px = 0;
  let py = 0;

  const onPointerDown = (e: PointerEvent): void => {
    dragging = true;
    px = e.clientX;
    py = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent): void => {
    if (!dragging) return;
    theta -= (e.clientX - px) * 0.005;
    phi = clamp(phi - (e.clientY - py) * 0.004, 0.5, 1.35);
    px = e.clientX;
    py = e.clientY;
    userHold = tNow;
  };
  const onPointerUp = (): void => {
    dragging = false;
  };
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    radius = clamp(radius + e.deltaY * 0.012, 9, 23);
  };
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });

  // ---------- clock ----------
  let playing = !reducedMotion;
  let t0 = performance.now();
  let tOffset = reducedMotion ? 32 : 0;
  let tNow = tOffset;
  let raf = 0;
  let disposed = false;

  function resize(): void {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    const ratio = renderer.getPixelRatio();
    if (canvas.width !== Math.floor(w * ratio) || canvas.height !== Math.floor(h * ratio)) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
  }

  function frame(): void {
    if (disposed) return;
    resize();
    tNow = playing ? (tOffset + (performance.now() - t0) / 1000) % LOOP_SECONDS : tOffset;
    placeCamera(tNow);
    camera.updateMatrixWorld();
    applyState(tNow);
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  function setPlaying(next: boolean): void {
    if (next === playing) return;
    if (next) t0 = performance.now();
    else tOffset = tNow;
    playing = next;
    opts.onPlayingChange(playing);
  }

  function disposeMaterial(m: THREE.Material): void {
    const record = m as unknown as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      const value = record[key];
      if (value && typeof value === "object" && (value as THREE.Texture).isTexture) {
        (value as THREE.Texture).dispose();
      }
    }
    m.dispose();
  }

  return {
    seek(t: number): void {
      tOffset = ((t % LOOP_SECONDS) + LOOP_SECONDS) % LOOP_SECONDS;
      t0 = performance.now();
      lastBeat = -1;
      lastAct = -1;
    },
    setPlaying,
    isPlaying: () => playing,
    actStart(index: number): void {
      const start = ACT_STARTS[index] ?? 0;
      tOffset = start;
      t0 = performance.now();
      lastBeat = -1;
      lastAct = -1;
      if (!playing && !reducedMotion) setPlaying(true);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      scene.traverse((o) => {
        const mesh = o as Partial<THREE.Mesh> & { material?: THREE.Material | THREE.Material[] };
        mesh.geometry?.dispose();
        const mat = mesh.material;
        if (Array.isArray(mat)) mat.forEach(disposeMaterial);
        else if (mat) disposeMaterial(mat);
      });
      renderer.dispose();
    },
  };
}
