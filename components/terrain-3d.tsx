'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { MapPin, RadioTower, TriangleAlert } from 'lucide-react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import {
  clamp,
  elevationToWorldY,
  floodLevelForHour,
  HAND_DRY,
  type LayerKey,
  lonLatToWorld,
  mercatorUv,
  SCENE_SCALE,
  sceneGrid,
  type TerrainData,
  terrainResource,
} from '@/lib/terrain-field';

const COVERAGE_RADIUS_METRES = 9000;
const TOWER_MAST_METRES = 32;
const IDLE_DRIFT_DELAY = 4200;
/** Illustrative population figures; the concept computes no census. */
const MOCK_POPULATIONS = ['N=420', 'N=137', 'N=286', 'N=94'];

type Anchor = {
  id: string;
  kind: 'tower' | 'population';
  label: string;
  detail: string;
  lon: number;
  lat: number;
  liftMetres: number;
};

type StatusElements = {
  severed: HTMLElement | null;
  area: HTMLElement | null;
};

type SceneHandle = {
  setLayers: (layers: Record<LayerKey, boolean>) => void;
  setHour: (hour: number) => void;
  resetView: () => void;
  dispose: () => void;
};

/**
 * Picks the settlements with the most flood-exposed ground within about
 * 1.5 km, so the markers sit where the HAND raster says the risk is.
 */
function deriveAnchors(terrain: TerrainData): Anchor[] {
  const { meta, hand, width, height } = terrain;
  const g = sceneGrid(meta);
  const radiusCells = Math.round(1500 / (g.lonStep * 111_320));

  const scored = meta.places.map((place) => {
    const col = Math.round((place.lon - meta.aoi.west) / g.lonStep);
    const row = Math.round((meta.aoi.north - place.lat) / g.latStep);
    let exposed = 0;
    for (let r = row - radiusCells; r <= row + radiusCells; r += 1) {
      if (r < 0 || r >= height) continue;
      for (let c = col - radiusCells; c <= col + radiusCells; c += 1) {
        if (c < 0 || c >= width) continue;
        const value = hand[r * width + c]!;
        if (value !== HAND_DRY && value < 25) exposed += 1;
      }
    }
    return { place, exposed };
  });

  scored.sort((a, b) => b.exposed - a.exposed);

  const anchors: Anchor[] = [
    {
      id: 'tower-candidate',
      kind: 'tower',
      label: meta.towerSite.name,
      detail: `Elevation: ${meta.towerSite.elevation} m`,
      lon: meta.towerSite.lon,
      lat: meta.towerSite.lat,
      liftMetres: TOWER_MAST_METRES + 30,
    },
  ];

  const chosen: typeof scored = [];
  for (const candidate of scored) {
    if (chosen.length >= MOCK_POPULATIONS.length) break;
    const tooClose = chosen.some(
      (other) =>
        Math.hypot(
          other.place.lon - candidate.place.lon,
          other.place.lat - candidate.place.lat,
        ) < 0.022,
    );
    if (!tooClose) chosen.push(candidate);
  }

  chosen.forEach((entry, index) => {
    anchors.push({
      id: `place-${entry.place.name}-${index}`,
      kind: 'population',
      label: entry.place.name,
      detail: MOCK_POPULATIONS[index]!,
      lon: entry.place.lon,
      lat: entry.place.lat,
      liftMetres: 60,
    });
  });

  return anchors;
}

function createScene(
  container: HTMLDivElement,
  terrain: TerrainData,
  anchors: Anchor[],
  markerElements: Map<string, HTMLDivElement>,
  status: StatusElements,
): SceneHandle {
  const { meta, elevation, hand, width, height } = terrain;
  const g = sceneGrid(meta);
  const vertexCount = width * height;

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
  renderer.setSize(container.clientWidth, container.clientHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.touchAction = 'none';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xd3e2ee, 420, 1500);

  const skyCanvas = document.createElement('canvas');
  skyCanvas.width = 8;
  skyCanvas.height = 256;
  const skyContext = skyCanvas.getContext('2d');
  if (skyContext) {
    const gradient = skyContext.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, '#6ea8d8');
    gradient.addColorStop(0.5, '#b6d3e9');
    gradient.addColorStop(1, '#dfe9ef');
    skyContext.fillStyle = gradient;
    skyContext.fillRect(0, 0, 8, 256);
  }
  const sky = new THREE.CanvasTexture(skyCanvas);
  sky.colorSpace = THREE.SRGBColorSpace;
  scene.background = sky;

  const camera = new THREE.PerspectiveCamera(
    45,
    container.clientWidth / Math.max(container.clientHeight, 1),
    1,
    3000,
  );

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.enablePan = false;
  controls.minDistance = 45;
  controls.maxDistance = 700;
  controls.minPolarAngle = 0.2;
  controls.maxPolarAngle = 1.36;
  controls.autoRotateSpeed = 0.22;

  // The Sentinel-2 drape already carries its own illumination, so the scene
  // lights mostly lift it and add just enough directional shaping for relief.
  scene.add(new THREE.AmbientLight(0xffffff, 0.95));
  scene.add(new THREE.HemisphereLight(0xcfe4f3, 0x3b4433, 0.45));
  const sun = new THREE.DirectionalLight(0xfff4e4, 0.85);
  sun.position.set(-400, 520, 260);
  scene.add(sun);

  // --- Terrain surface ---------------------------------------------------
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const originX = ((width - 1) / 2) * g.xStep;
  const originZ = ((height - 1) / 2) * g.zStep;

  for (let row = 0; row < height; row += 1) {
    const lat = meta.aoi.north - row * g.latStep;
    for (let col = 0; col < width; col += 1) {
      const index = row * width + col;
      const lon = meta.aoi.west + col * g.lonStep;
      positions[index * 3] = col * g.xStep - originX;
      positions[index * 3 + 1] = elevationToWorldY(elevation[index]!);
      positions[index * 3 + 2] = row * g.zStep - originZ;
      const { u, v } = mercatorUv(meta, lon, lat);
      uvs[index * 2] = u;
      uvs[index * 2 + 1] = v;
    }
  }

  const indices = new Uint32Array((width - 1) * (height - 1) * 6);
  let cursor = 0;
  for (let row = 0; row < height - 1; row += 1) {
    for (let col = 0; col < width - 1; col += 1) {
      const a = row * width + col;
      const b = a + 1;
      const c = a + width;
      const d = c + 1;
      indices[cursor] = a;
      indices[cursor + 1] = c;
      indices[cursor + 2] = b;
      indices[cursor + 3] = b;
      indices[cursor + 4] = c;
      indices[cursor + 5] = d;
      cursor += 6;
    }
  }

  const terrainGeometry = new THREE.BufferGeometry();
  terrainGeometry.setAttribute(
    'position',
    new THREE.BufferAttribute(positions, 3),
  );
  terrainGeometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  terrainGeometry.setIndex(new THREE.BufferAttribute(indices, 1));
  terrainGeometry.computeVertexNormals();

  const surfaceTexture = new THREE.Texture(terrain.surface);
  // ImageBitmap sources cannot be flipped at upload, so the UVs above already
  // run north to south.
  surfaceTexture.flipY = false;
  surfaceTexture.colorSpace = THREE.SRGBColorSpace;
  surfaceTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  surfaceTexture.wrapS = THREE.ClampToEdgeWrapping;
  surfaceTexture.wrapT = THREE.ClampToEdgeWrapping;
  surfaceTexture.needsUpdate = true;

  const terrainMesh = new THREE.Mesh(
    terrainGeometry,
    new THREE.MeshStandardMaterial({
      map: surfaceTexture,
      roughness: 1,
      metalness: 0,
    }),
  );
  scene.add(terrainMesh);

  const worldToCell = (x: number, z: number) => ({
    col: clamp((x + originX) / g.xStep, 0, width - 1.001),
    row: clamp((z + originZ) / g.zStep, 0, height - 1.001),
  });

  /** Bilinear elevation in metres for any world position. */
  const elevationAt = (x: number, z: number) => {
    const { col, row } = worldToCell(x, z);
    const c0 = Math.floor(col);
    const r0 = Math.floor(row);
    const tc = col - c0;
    const tr = row - r0;
    const e00 = elevation[r0 * width + c0]!;
    const e10 = elevation[r0 * width + c0 + 1]!;
    const e01 = elevation[(r0 + 1) * width + c0]!;
    const e11 = elevation[(r0 + 1) * width + c0 + 1]!;
    return (
      e00 * (1 - tc) * (1 - tr) +
      e10 * tc * (1 - tr) +
      e01 * (1 - tc) * tr +
      e11 * tc * tr
    );
  };

  const handAt = (lon: number, lat: number) => {
    const col = clamp(
      Math.round((lon - meta.aoi.west) / g.lonStep),
      0,
      width - 1,
    );
    const row = clamp(
      Math.round((meta.aoi.north - lat) / g.latStep),
      0,
      height - 1,
    );
    return hand[row * width + col]!;
  };

  const worldOf = (lon: number, lat: number, liftMetres = 0) => {
    const { x, z } = lonLatToWorld(meta, lon, lat);
    return new THREE.Vector3(
      x,
      elevationToWorldY(elevationAt(x, z) + liftMetres),
      z,
    );
  };

  // --- Flood surface from the baked HAND raster --------------------------
  const shallowTint = new THREE.Color('#bfeafc');
  const deepTint = new THREE.Color('#0d5fa8');
  const floodGeometry = new THREE.BufferGeometry();
  const floodMesh = new THREE.Mesh(
    floodGeometry,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      roughness: 0.15,
      metalness: 0.05,
    }),
  );
  floodMesh.renderOrder = 1;
  scene.add(floodMesh);

  const floodIndexMap = new Int32Array(vertexCount);
  const waterColor = new THREE.Color();

  const wetAt = (index: number, level: number) => {
    const value = hand[index]!;
    return value !== HAND_DRY && value / 10 < level;
  };

  const cellAreaKm2 = meta.grid.spacingMetres ** 2 / 1_000_000;
  let floodedKm2 = 0;

  const buildFlood = (hour: number) => {
    const level = floodLevelForHour(hour);
    floodIndexMap.fill(-1);
    let wetCells = 0;
    const waterPositions: number[] = [];
    const waterColors: number[] = [];
    const waterIndices: number[] = [];

    const pushVertex = (index: number) => {
      const existing = floodIndexMap[index]!;
      if (existing >= 0) return existing;
      const value = hand[index]!;
      const ground = elevation[index]!;
      const dry = value === HAND_DRY;
      const handMetres = value / 10;
      const depth = dry ? 0 : level - handMetres;
      // The sheet sits on the drainage datum plus the flood level, so terrain
      // above it simply occludes the water instead of the water climbing.
      const surface = dry ? ground : ground - handMetres + level;
      waterPositions.push(
        positions[index * 3]!,
        elevationToWorldY(surface),
        positions[index * 3 + 2]!,
      );
      waterColor.copy(shallowTint).lerp(deepTint, clamp(depth / 2.4, 0, 1));
      waterColors.push(
        waterColor.r,
        waterColor.g,
        waterColor.b,
        depth > 0 ? clamp(0.34 + depth * 0.26, 0.34, 0.9) : 0,
      );
      const next = waterPositions.length / 3 - 1;
      floodIndexMap[index] = next;
      return next;
    };

    for (let row = 0; row < height - 1; row += 1) {
      for (let col = 0; col < width - 1; col += 1) {
        const a = row * width + col;
        const b = a + 1;
        const c = a + width;
        const d = c + 1;
        if (
          !wetAt(a, level) &&
          !wetAt(b, level) &&
          !wetAt(c, level) &&
          !wetAt(d, level)
        ) {
          continue;
        }
        wetCells += 1;
        const va = pushVertex(a);
        const vb = pushVertex(b);
        const vc = pushVertex(c);
        const vd = pushVertex(d);
        waterIndices.push(va, vc, vb, vb, vc, vd);
      }
    }

    floodGeometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(waterPositions, 3),
    );
    floodGeometry.setAttribute(
      'color',
      new THREE.Float32BufferAttribute(waterColors, 4),
    );
    floodGeometry.setIndex(waterIndices);
    floodGeometry.computeVertexNormals();
    floodGeometry.computeBoundingSphere();
    floodedKm2 = wetCells * cellAreaKm2;
  };

  // --- OpenStreetMap roads, coloured by inundation -----------------------
  const roadGroup = new THREE.Group();
  scene.add(roadGroup);

  const intactColor = new THREE.Color('#eef4f8');
  const severedColor = new THREE.Color('#fb4a45');
  const roadSegments: { hand: number; start: number }[] = [];
  const roadVertices: number[] = [];
  const roadColors: number[] = [];
  const roadIndices: number[] = [];

  for (const way of meta.roads) {
    const major = way.klass === 'motorway' || way.klass === 'trunk';
    const halfWidth = (major ? 34 : 24) * SCENE_SCALE;
    for (let i = 0; i < way.points.length - 1; i += 1) {
      const [lon0, lat0] = way.points[i]!;
      const [lon1, lat1] = way.points[i + 1]!;
      const start = worldOf(lon0, lat0, 6);
      const end = worldOf(lon1, lat1, 6);
      const direction = new THREE.Vector2(end.x - start.x, end.z - start.z);
      if (direction.lengthSq() === 0) continue;
      direction.normalize();
      const normal = new THREE.Vector2(
        -direction.y,
        direction.x,
      ).multiplyScalar(halfWidth);
      const base = roadVertices.length / 3;
      for (const [point, side] of [
        [start, 1],
        [start, -1],
        [end, 1],
        [end, -1],
      ] as const) {
        roadVertices.push(
          point.x + normal.x * side,
          point.y,
          point.z + normal.y * side,
        );
        roadColors.push(intactColor.r, intactColor.g, intactColor.b, 0.42);
      }
      roadIndices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
      roadSegments.push({
        hand: Math.min(handAt(lon0, lat0), handAt(lon1, lat1)),
        start: base,
      });
    }
  }

  const roadGeometry = new THREE.BufferGeometry();
  roadGeometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(roadVertices, 3),
  );
  const roadColorAttribute = new THREE.Float32BufferAttribute(roadColors, 4);
  roadGeometry.setAttribute('color', roadColorAttribute);
  roadGeometry.setIndex(roadIndices);
  const roadMesh = new THREE.Mesh(
    roadGeometry,
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  roadMesh.renderOrder = 2;
  roadGroup.add(roadMesh);

  let severedCount = 0;

  const paintRoads = (hour: number) => {
    const level = floodLevelForHour(hour);
    const array = roadColorAttribute.array as Float32Array;
    severedCount = 0;
    for (const segment of roadSegments) {
      const severed = segment.hand !== HAND_DRY && segment.hand / 10 < level;
      if (severed) severedCount += 1;
      const tint = severed ? severedColor : intactColor;
      const alpha = severed ? 0.95 : 0.42;
      for (let corner = 0; corner < 4; corner += 1) {
        const offset = (segment.start + corner) * 4;
        array[offset] = tint.r;
        array[offset + 1] = tint.g;
        array[offset + 2] = tint.b;
        array[offset + 3] = alpha;
      }
    }
    roadColorAttribute.needsUpdate = true;
  };

  // --- Tower and line-of-sight service area ------------------------------
  const towerGroup = new THREE.Group();
  const towerBase = worldOf(meta.towerSite.lon, meta.towerSite.lat);
  towerGroup.position.copy(towerBase);
  scene.add(towerGroup);

  const mastHeight = elevationToWorldY(TOWER_MAST_METRES);
  const mastMaterial = new THREE.MeshStandardMaterial({
    color: 0xe8eef5,
    roughness: 0.45,
    metalness: 0.4,
  });
  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(
      mastHeight * 0.05,
      mastHeight * 0.16,
      mastHeight,
      8,
      1,
      true,
    ),
    mastMaterial,
  );
  mast.position.y = mastHeight / 2;
  towerGroup.add(mast);
  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(mastHeight * 0.09, 12, 12),
    new THREE.MeshBasicMaterial({ color: 0x34d399 }),
  );
  beacon.position.y = mastHeight * 1.05;
  towerGroup.add(beacon);

  const coverageGroup = new THREE.Group();
  scene.add(coverageGroup);

  const buildCoverage = () => {
    const spokes = 96;
    const rings = 60;
    const radius = COVERAGE_RADIUS_METRES * SCENE_SCALE;
    const eye = towerBase.y + mastHeight;
    const ringStep = radius / rings;
    const vertices: number[] = [];
    const shades: number[] = [];
    const meshIndices: number[] = [];
    const emerald = new THREE.Color('#34d399');

    for (let s = 0; s < spokes; s += 1) {
      const angle = (s / spokes) * Math.PI * 2;
      const dirX = Math.cos(angle);
      const dirZ = Math.sin(angle);
      let horizon = Number.NEGATIVE_INFINITY;
      for (let r = 0; r <= rings; r += 1) {
        const distance = Math.max(r * ringStep, 0.001);
        const x = towerBase.x + dirX * distance;
        const z = towerBase.z + dirZ * distance;
        const groundY = elevationToWorldY(elevationAt(x, z));
        const angleToGround = (groundY - eye) / distance;
        const visible = angleToGround >= horizon - 0.004;
        if (angleToGround > horizon) horizon = angleToGround;
        const falloff = 1 - (distance / radius) ** 2;
        vertices.push(x, groundY + 0.35, z);
        shades.push(
          emerald.r,
          emerald.g,
          emerald.b,
          visible ? 0.08 + 0.26 * falloff : 0,
        );
      }
    }

    for (let s = 0; s < spokes; s += 1) {
      const nextSpoke = (s + 1) % spokes;
      for (let r = 0; r < rings; r += 1) {
        const a = s * (rings + 1) + r;
        const b = a + 1;
        const c = nextSpoke * (rings + 1) + r;
        const d = c + 1;
        meshIndices.push(a, c, b, b, c, d);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(vertices, 3),
    );
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(shades, 4));
    geometry.setIndex(meshIndices);
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    mesh.renderOrder = 3;
    coverageGroup.add(mesh);
  };

  buildCoverage();
  buildFlood(8);
  paintRoads(8);

  // --- Camera framing ----------------------------------------------------
  // Opens on the classic oblique: Gunung Jerai's massif to the north-east,
  // the Yan coastal plain and the Straits falling away to the west.
  const homeTarget = new THREE.Vector3(10, 6, 10);
  const homePosition = new THREE.Vector3(-180, 205, 250);
  camera.position.copy(homePosition);
  controls.target.copy(homeTarget);
  controls.update();

  // --- Marker projection -------------------------------------------------
  const anchorPoints = anchors.map((anchor) => ({
    id: anchor.id,
    point: worldOf(anchor.lon, anchor.lat, anchor.liftMetres),
  }));
  const projected = new THREE.Vector3();

  const updateMarkers = () => {
    const viewWidth = container.clientWidth;
    const viewHeight = container.clientHeight;
    for (const anchor of anchorPoints) {
      const element = markerElements.get(anchor.id);
      if (!element) continue;
      projected.copy(anchor.point).project(camera);
      let hidden = projected.z > 1;
      if (!hidden) {
        const steps = 16;
        for (let i = 1; i < steps; i += 1) {
          const t = i / steps;
          const x =
            camera.position.x + (anchor.point.x - camera.position.x) * t;
          const y =
            camera.position.y + (anchor.point.y - camera.position.y) * t;
          const z =
            camera.position.z + (anchor.point.z - camera.position.z) * t;
          if (elevationToWorldY(elevationAt(x, z)) > y + 1.2) {
            hidden = true;
            break;
          }
        }
      }
      element.style.visibility = hidden ? 'hidden' : 'visible';
      element.style.opacity = hidden ? '0' : '1';
      element.style.transform = `translate3d(${
        (projected.x * 0.5 + 0.5) * viewWidth
      }px, ${(-projected.y * 0.5 + 0.5) * viewHeight}px, 0)`;
    }
  };

  // --- Frame loop --------------------------------------------------------
  const reduceMotion = globalThis.matchMedia?.(
    '(prefers-reduced-motion: reduce)',
  );
  let lastInteraction = performance.now();
  let frame = 0;
  let running = true;

  const markInteraction = () => {
    lastInteraction = performance.now();
    controls.autoRotate = false;
  };
  controls.addEventListener('start', markInteraction);
  controls.addEventListener('change', markInteraction);

  const renderFrame = () => {
    frame = requestAnimationFrame(renderFrame);
    const idle = performance.now() - lastInteraction > IDLE_DRIFT_DELAY;
    controls.autoRotate = idle && !reduceMotion?.matches;
    controls.update();
    updateMarkers();
    renderer.render(scene, camera);
  };
  frame = requestAnimationFrame(renderFrame);

  const resize = () => {
    const viewWidth = container.clientWidth;
    const viewHeight = Math.max(container.clientHeight, 1);
    camera.aspect = viewWidth / viewHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(viewWidth, viewHeight, false);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);

  const onVisibility = () => {
    if (document.hidden && running) {
      cancelAnimationFrame(frame);
      running = false;
    } else if (!document.hidden && !running) {
      running = true;
      lastInteraction = performance.now();
      frame = requestAnimationFrame(renderFrame);
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  return {
    setLayers(layers) {
      floodMesh.visible = layers.flood;
      roadGroup.visible = layers.roads;
      coverageGroup.visible = layers.coverage;
      towerGroup.visible = layers.towers;
    },
    setHour(hour) {
      buildFlood(hour);
      paintRoads(hour);
      if (status.severed) status.severed.textContent = String(severedCount);
      if (status.area) status.area.textContent = floodedKm2.toFixed(1);
    },
    resetView() {
      camera.position.copy(homePosition);
      controls.target.copy(homeTarget);
      controls.update();
      lastInteraction = performance.now();
    },
    dispose() {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      controls.removeEventListener('start', markInteraction);
      controls.removeEventListener('change', markInteraction);
      controls.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const material = object.material as THREE.Material | THREE.Material[];
          if (Array.isArray(material)) {
            for (const entry of material) entry.dispose();
          } else {
            material.dispose();
          }
        }
      });
      surfaceTexture.dispose();
      sky.dispose();
      scene.background = null;
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

export function Terrain3D({
  layers,
  timeline,
  resetSignal,
}: {
  layers: Record<LayerKey, boolean>;
  timeline: number;
  resetSignal: number;
}) {
  // The baked assets are fetched from the client only: this component is
  // prerendered during the static export, where a relative URL has no origin.
  const [terrain, setTerrain] = useState<TerrainData | null>(null);
  const [failed, setFailed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const markerRefs = useRef(new Map<string, HTMLDivElement>());
  const severedRef = useRef<HTMLSpanElement>(null);
  const areaRef = useRef<HTMLSpanElement>(null);
  const sceneRef = useRef<SceneHandle | null>(null);
  const anchors = useMemo(
    () => (terrain ? deriveAnchors(terrain) : []),
    [terrain],
  );

  useEffect(() => {
    let cancelled = false;
    terrainResource().then(
      (data) => {
        if (!cancelled) setTerrain(data);
      },
      (error: unknown) => {
        console.error('Failed to load terrain assets', error);
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !terrain) return;
    const handle = createScene(
      container,
      terrain,
      anchors,
      markerRefs.current,
      {
        severed: severedRef.current,
        area: areaRef.current,
      },
    );
    sceneRef.current = handle;
    return () => {
      sceneRef.current = null;
      handle.dispose();
    };
  }, [terrain, anchors]);

  useEffect(() => {
    sceneRef.current?.setLayers(layers);
  }, [layers]);

  useEffect(() => {
    sceneRef.current?.setHour(timeline);
  }, [timeline]);

  useEffect(() => {
    if (resetSignal > 0) sceneRef.current?.resetView();
  }, [resetSignal]);

  const registerMarker = (id: string) => (element: HTMLDivElement | null) => {
    if (element) {
      markerRefs.current.set(id, element);
    } else {
      markerRefs.current.delete(id);
    }
  };

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="size-full" />
      {!terrain && (
        <p className="absolute inset-x-0 top-1/2 text-center text-xs font-medium tracking-[0.08em] text-white/70 uppercase">
          {failed ? 'Terrain assets unavailable' : 'Loading terrain model…'}
        </p>
      )}
      <div className="pointer-events-none absolute bottom-24 right-4 z-20 hidden items-center gap-1.5 rounded-lg border border-red-300/20 bg-red-950/70 px-2.5 py-2 text-[11px] font-medium text-red-100 backdrop-blur-md lg:flex">
        <TriangleAlert className="size-3.5 text-red-300" aria-hidden />
        <span ref={severedRef} className="tabular-nums">
          0
        </span>
        road segments cut ·
        <span ref={areaRef} className="tabular-nums">
          0
        </span>
        km² inundated
      </div>
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {anchors.map((anchor) => {
          const visible =
            anchor.kind === 'tower' ? layers.towers : layers.population;
          if (!visible) return null;
          return (
            <div
              key={anchor.id}
              ref={registerMarker(anchor.id)}
              className="map-marker absolute left-0 top-0 transition-opacity duration-150 will-change-transform"
            >
              {anchor.kind === 'tower' ? (
                <div className="flex -translate-x-1/2 -translate-y-full flex-col items-center">
                  <div className="mb-2 whitespace-nowrap rounded-lg border border-emerald-300/35 bg-[#07131d]/90 px-3 py-2 shadow-xl backdrop-blur-md">
                    <div className="flex items-center gap-2 text-sm font-semibold text-white">
                      <RadioTower
                        className="size-4 text-emerald-300"
                        aria-hidden
                      />
                      {anchor.label}
                    </div>
                    <div className="mt-0.5 pl-6 text-xs text-slate-300">
                      {anchor.detail}
                    </div>
                  </div>
                  <div className="grid size-9 place-items-center rounded-full border-2 border-white bg-emerald-400 text-emerald-950 shadow-[0_0_0_7px_rgb(52_211_153/18%)]">
                    <RadioTower className="size-4" aria-hidden />
                  </div>
                </div>
              ) : (
                <div className="flex -translate-x-1/2 -translate-y-full flex-col items-center">
                  <span className="mb-1.5 whitespace-nowrap rounded-md border border-sky-200/30 bg-[#07131d]/85 px-2 py-1 text-xs font-semibold text-sky-100 backdrop-blur-sm">
                    {anchor.label} ({anchor.detail})
                  </span>
                  <MapPin
                    className="size-7 fill-sky-400 text-white"
                    aria-hidden
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
