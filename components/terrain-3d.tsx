'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { MapPin, RadioTower, Warehouse } from 'lucide-react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { type Forecast, rainAt } from '@/lib/forecast';
import { cutMask, type RouteEvaluation } from '@/lib/routing';
import { type FailureCause, SITE_COVERAGE_RADIUS_METRES, type SiteStatus } from '@/lib/network';
import { peopleNear } from '@/lib/population';
import { PORTABLE_MAST_METRES } from '@/lib/sites';
import type { SiteAssessment } from '@/lib/sites';
import { viewshedMask, type ViewshedMask } from '@/lib/viewshed';

import {
  clamp,
  elevationToWorldY,
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
const IDLE_DRIFT_DELAY = 4200;
const BASE_DAMPING = 0.07; // per 60 Hz frame; rescaled to the real frame time
const GESTURE_TAIL_MS = 250;
const WHEEL_ZOOM_RATE = 0.0008; // log-distance per wheel pixel (~8 % per 100 px)
const SWIPE_ORBIT_RATE = 0.0035; // radians of azimuth per horizontal wheel pixel
const SWIPE_FLY_RATE = 0.0025; // fraction of camera height per vertical wheel pixel
const GESTURE_EASE_SECONDS = 0.12;
const FRAME_SAMPLE = 40;
const FLIGHT_SECONDS = 1.2;
const SUN_GROUND = 0.85;
const SUN_OVERVIEW = 0.2; // flat, map-like shading when looking straight down
const RAIN_CANVAS_WIDTH = 512;
const RAIN_CANVAS_HEIGHT = 448;
const RAIN_PLANE_LIFT_METRES = 400; // above the highest terrain
const RAIN_STORM_MM = 40; // ≥ this reads as a storm core
const WAVE_DURATION_MS = 9000;
const WAVE_HOT_KM = 2.5; // the leading edge glows white-hot for this far behind the front
const GLOW_WIDTH_FACTOR = 3; // neon halo width relative to the road ribbon
const SPAWN_INTERVAL_MS = 500; // gap between candidate rings appearing
const SPAWN_RING_MS = 450; // ring grow-in
const SPAWN_PULSE_MS = 1100; // coverage fan flash
const WAVE_SOON_HOURS = 2; // lit roads closing within this read red; those closing before the peak amber
const MAX_PLACE_MARKERS = 4;
// Homes are drawn about three times their true footprint so a kampung still
// reads as a cluster from the valley-wide opening view.
const HOME_FOOTPRINT_METRES = 36;
const HOME_HEIGHT_METRES = 9;
const HOME_COUNT_RADIUS_METRES = 1200;

type Anchor = {
  id: string;
  kind: 'tower' | 'population' | 'depot' | 'candidate' | 'site';
  label: string;
  detail: string;
  lon: number;
  lat: number;
  liftMetres: number;
};

/** ground = home oblique; overview = top-down; site = behind the depot looking down the valley. */
export type View = 'ground' | 'overview' | 'site';

type SceneHandle = {
  setLayers: (layers: Record<LayerKey, boolean>) => void;
  /** Tweens the camera to the oblique home view or a top-down overview. */
  flyTo: (view: View) => void;
  /** Supplies the hourly rain grid drawn over the terrain in the overview. */
  setForecast: (forecast: Forecast) => void;
  /** Fractional forecast hour to draw; interpolates between the two nearest hours. */
  setForecastHour: (hour: number) => void;
  /** Sets the HAND flood threshold in metres above the drainage datum. */
  setLevel: (metres: number) => void;
  /** Impact totals for the current flood level, recomputed by setLevel. */
  metrics: () => { severedKm: number; floodedKm2: number; homesFlooded: number };
  /**
   * Animates the reachable network outward from the depot, then spawns the
   * reachable candidate sites one by one.
   */
  playRouteWave: (
    evaluation: RouteEvaluation,
    sites: SiteAssessment[],
    network: RouteNetwork,
    callbacks: {
      onProgress: (state: { reachableKm: number; cuts: number }) => void;
      onDone: () => void;
      onSiteSpawn: (id: string) => void;
      onSitesDone: () => void;
    },
  ) => void;
  /** Jumps a running wave to its final state. */
  finishRouteWave: () => void;
  /** Eases the camera a little toward the depot as the wave sets off. */
  glideToDepot: () => void;
  /** Raises the mast and permanent coverage at the winning site and glides to it. */
  showWinner: (site: SiteAssessment | null) => void;
  /** Pulses an outline on the site the plan sends the convoy to. */
  highlightConvoy: (siteId: string | null) => void;
  /** Previews another candidate's coverage without changing the winner. */
  previewSite: (site: SiteAssessment | null) => void;
  /** Removes the wave and returns the roads to flood colouring. */
  clearRouteWave: () => void;
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
      liftMetres: PORTABLE_MAST_METRES + 30,
    },
    {
      id: 'depot',
      kind: 'depot',
      label: `Depot · ${meta.depot.name}`,
      detail: 'Route origin',
      lon: meta.depot.lon,
      lat: meta.depot.lat,
      liftMetres: 40,
    },
    // Existing network sites: real where the map knows them, seeds elsewhere.
    ...meta.sites.map((site) => ({
      id: site.id,
      kind: 'site' as const,
      label: site.name,
      detail: site.source === 'seed' ? 'placeholder site' : site.source,
      lon: site.lon,
      lat: site.lat,
      liftMetres: site.mastMetres + 10,
    })),
    // Every candidate has an anchor so its marker can appear the moment the
    // site evaluation reaches it; the React side only mounts spawned ones.
    ...meta.candidates.map((candidate, index) => ({
      id: `candidate-${index}`,
      kind: 'candidate' as const,
      label: candidate.name,
      detail: `${candidate.elevation} m`,
      lon: candidate.lon,
      lat: candidate.lat,
      liftMetres: 30,
    })),
  ];

  const chosen: typeof scored = [];
  for (const candidate of scored) {
    if (chosen.length >= MAX_PLACE_MARKERS) break;
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
      detail: `~${Math.round(peopleNear(terrain, entry.place.lon, entry.place.lat, HOME_COUNT_RADIUS_METRES)).toLocaleString()} people`,
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
  initialLevel: number,
): SceneHandle {
  const { meta, elevation, hand, width, height } = terrain;
  const g = sceneGrid(meta);
  const vertexCount = width * height;

  const deviceRatio = globalThis.devicePixelRatio || 1;
  const renderer = new THREE.WebGLRenderer({
    // MSAA buys little at Retina density and costs a lot on integrated GPUs.
    antialias: deviceRatio < 1.5,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(deviceRatio, 1.5));
  // Shows around the tile in the overview, where the sky is switched off.
  renderer.setClearColor(0x07111b, 1);
  renderer.setSize(container.clientWidth, container.clientHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.touchAction = 'none';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const fog = new THREE.Fog(0xd3e2ee, 420, 1500);
  scene.fog = fog;

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
  controls.dampingFactor = BASE_DAMPING;
  // Map conventions: drag pans across the ground, right- or shift-drag orbits.
  controls.enablePan = true;
  controls.screenSpacePanning = false;
  controls.panSpeed = 0.8;
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.PAN,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.ROTATE,
  };
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
  controls.minDistance = 45;
  controls.maxDistance = 700;
  controls.minPolarAngle = 0.2;
  controls.maxPolarAngle = 1.45; // low enough to fly along the valley floor
  controls.autoRotateSpeed = 0.22;

  // The Sentinel-2 drape already carries its own illumination, so the scene
  // lights mostly lift it and add just enough directional shaping for relief.
  scene.add(new THREE.AmbientLight(0xffffff, 1.1));
  scene.add(new THREE.HemisphereLight(0xcfe4f3, 0x3b4433, 0.45));
  const sun = new THREE.DirectionalLight(0xfff4e4, SUN_GROUND);
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
  const shallowTint = new THREE.Color('#8fd8f5');
  const deepTint = new THREE.Color('#0a4f92');
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

  const buildFlood = (level: number) => {
    floodIndexMap.fill(-1);
    let wetCells = 0;
    for (let index = 0; index < vertexCount; index += 1) {
      if (wetAt(index, level)) wetCells += 1;
    }
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
      waterColor.copy(shallowTint).lerp(deepTint, clamp(depth / 8, 0, 1));
      waterColors.push(
        waterColor.r,
        waterColor.g,
        waterColor.b,
        depth > 0 ? clamp(0.55 + depth * 0.04, 0.55, 0.94) : 0,
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
  // The railway reads as steel so it is not mistaken for another road.
  const railColor = new THREE.Color('#b8c2cc');
  const severedColor = new THREE.Color('#fb4a45');
  // Whether a drawn segment is under water comes from the shared cut rule in
  // lib/routing (bridge decks, culverts, minimum run length), so what the
  // map paints red is exactly what the router refuses to drive through.
  type RoadSegment = {
    edge: number;
    sampleStart: number;
    sampleEnd: number;
    start: number;
    km: number;
    /** Kilometres along the edge before this segment, from the a end. */
    alongKm: number;
    intact: THREE.Color;
  };
  const roadSegments: RoadSegment[] = [];
  const roadVertices: number[] = [];
  const roadColors: number[] = [];
  const roadIndices: number[] = [];
  // A wider, additively blended twin of every ribbon: invisible until the
  // route wave lights a road, then a neon halo around it.
  const glowVertices: number[] = [];
  const glowColors: number[] = [];

  for (const [edgeIndex, way] of terrain.graph.edges.entries()) {
    const rail = way.klass === 'rail';
    const major = way.klass === 'motorway' || way.klass === 'trunk';
    const halfWidth = (rail ? 18 : major ? 34 : 24) * SCENE_SCALE;
    const intact = rail ? railColor : intactColor;
    let alongKm = 0;
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
        roadColors.push(intact.r, intact.g, intact.b, 0.42);
        glowVertices.push(
          point.x + normal.x * side * GLOW_WIDTH_FACTOR,
          point.y - 0.02,
          point.z + normal.y * side * GLOW_WIDTH_FACTOR,
        );
        glowColors.push(intact.r, intact.g, intact.b, 0);
      }
      roadIndices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
      const km = start.distanceTo(end) / SCENE_SCALE / 1000;
      roadSegments.push({
        edge: edgeIndex,
        sampleStart: way.offsets[i] ?? 0,
        sampleEnd: way.offsets[i + 1] ?? way.profile.length - 1,
        start: base,
        km,
        alongKm,
        intact,
      });
      alongKm += km;
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
  const glowGeometry = new THREE.BufferGeometry();
  glowGeometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(glowVertices, 3),
  );
  const glowColorAttribute = new THREE.Float32BufferAttribute(glowColors, 4);
  glowGeometry.setAttribute('color', glowColorAttribute);
  glowGeometry.setIndex(roadIndices);
  const glowMesh = new THREE.Mesh(
    glowGeometry,
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    }),
  );
  glowMesh.renderOrder = 1.5;
  roadGroup.add(glowMesh);
  roadGroup.add(roadMesh);

  let severedKm = 0;
  let lastLevel = initialLevel;

  const paintSegment = (
    array: Float32Array,
    segment: RoadSegment,
    tint: THREE.Color,
    alpha: number,
    glowAlpha = 0,
  ) => {
    const glow = glowColorAttribute.array as Float32Array;
    for (let corner = 0; corner < 4; corner += 1) {
      const offset = (segment.start + corner) * 4;
      array[offset] = tint.r;
      array[offset + 1] = tint.g;
      array[offset + 2] = tint.b;
      array[offset + 3] = alpha;
      glow[offset] = tint.r;
      glow[offset + 1] = tint.g;
      glow[offset + 2] = tint.b;
      glow[offset + 3] = glowAlpha;
    }
  };

  const paintRoads = (level: number) => {
    lastLevel = level;
    if (wave) return; // the route wave owns the road colours while it shows
    const array = roadColorAttribute.array as Float32Array;
    severedKm = 0;
    const masks = terrain.graph.edges.map((edge) => cutMask(edge, level));
    for (const segment of roadSegments) {
      const mask = masks[segment.edge]!;
      let severed = false;
      for (let s = segment.sampleStart; s <= segment.sampleEnd; s += 1) {
        if (mask[s]) {
          severed = true;
          break;
        }
      }
      if (severed) severedKm += segment.km;
      const tint = severed ? severedColor : segment.intact;
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
    glowColorAttribute.needsUpdate = true;
  };

  // --- Route wave: how far the truck gets, and for how long -------------
  // Roads light up in order of route distance from the depot; each lit road
  // is tinted by when the forecast closes it. Roads the truck cannot reach
  // now stay dim, and every crossing that stops the wave gets a red mark at
  // the water's edge.
  type Wave = {
    evaluation: RouteEvaluation;
    startedAt: number;
    progressKm: number;
    done: boolean;
    onProgress: (state: { reachableKm: number; cuts: number }) => void;
    onDone: () => void;
    /** Candidate sites to spawn once the wave settles. */
    sites: SiteAssessment[];
    network: RouteNetwork;
    onSiteSpawn: (id: string) => void;
    onSitesDone: () => void;
  };
  let wave: Wave | null = null;

  // --- Candidate spawn: rings beside the lit roads, one every half second --
  type Spawn = {
    sites: SiteAssessment[];
    next: number;
    nextAt: number;
    active: { ring: THREE.Mesh; fan: THREE.Mesh; bornAt: number }[];
    done: boolean;
    onSiteSpawn: (id: string) => void;
    onSitesDone: () => void;
  };
  let spawn: Spawn | null = null;
  const spawnGroup = new THREE.Group();
  scene.add(spawnGroup);
  const ringGeometry = new THREE.RingGeometry(
    90 * SCENE_SCALE,
    140 * SCENE_SCALE,
    40,
  );
  const ringMaterial = new THREE.MeshBasicMaterial({
    color: 0x34d399,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const spawnOne = (now: number) => {
    if (!spawn) return;
    const site = spawn.sites[spawn.next]!;
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.position.copy(worldOf(site.candidate.lon, site.candidate.lat, 4));
    ring.rotation.x = -Math.PI / 2;
    ring.scale.setScalar(0.01);
    ring.renderOrder = 3;
    spawnGroup.add(ring);
    const fan = buildFan(site.candidate, site.mask);
    (fan.material as THREE.MeshBasicMaterial).opacity = 1;
    spawnGroup.add(fan);
    spawn.active.push({ ring, fan, bornAt: now });
    spawn.next += 1;
    spawn.onSiteSpawn(site.id);
  };

  const stepSpawn = (now: number) => {
    if (!spawn || spawn.done) return;
    while (spawn.next < spawn.sites.length && now >= spawn.nextAt) {
      spawnOne(now);
      spawn.nextAt = now + SPAWN_INTERVAL_MS;
    }
    let settling = false;
    for (const entry of spawn.active) {
      const grow = Math.min(1, (now - entry.bornAt) / SPAWN_RING_MS);
      entry.ring.scale.setScalar(1 - Math.pow(1 - grow, 3));
      const pulse = Math.min(1, (now - entry.bornAt) / SPAWN_PULSE_MS);
      const material = entry.fan.material as THREE.MeshBasicMaterial;
      material.opacity = 1 - pulse;
      entry.fan.visible = pulse < 1;
      if (pulse < 1 || grow < 1) settling = true;
    }
    if (spawn.next >= spawn.sites.length && !settling) {
      spawn.done = true;
      spawn.onSitesDone();
    }
  };

  const startSpawn = (
    sites: SiteAssessment[],
    onSiteSpawn: (id: string) => void,
    onSitesDone: () => void,
  ) => {
    spawn = {
      sites,
      next: 0,
      nextAt: performance.now(),
      active: [],
      done: false,
      onSiteSpawn,
      onSitesDone,
    };
    if (reduceMotion?.matches) finishSpawn();
  };

  const finishSpawn = () => {
    if (!spawn || spawn.done) return;
    const now = performance.now();
    while (spawn.next < spawn.sites.length) spawnOne(now - SPAWN_PULSE_MS);
    for (const entry of spawn.active) {
      entry.ring.scale.setScalar(1);
      entry.fan.visible = false;
    }
    spawn.done = true;
    spawn.onSitesDone();
  };

  // --- Winner and preview ------------------------------------------------
  // Convoy: an amber ring pulsing on the site the plan sends the genset trailer to.
  const convoyGroup = new THREE.Group();
  scene.add(convoyGroup);
  let convoyRing: THREE.Mesh | null = null;
  const convoyMaterial = new THREE.MeshBasicMaterial({
    color: 0xfbbf24,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const convoyGeometry = new THREE.RingGeometry(220 * SCENE_SCALE, 300 * SCENE_SCALE, 48);
  const stepConvoyRing = (now: number) => {
    if (!convoyRing) return;
    const pulse = 0.5 + 0.5 * Math.sin(now / 320);
    convoyRing.scale.setScalar(1 + 0.35 * pulse);
    convoyMaterial.opacity = 0.35 + 0.5 * (1 - pulse);
  };

  const winnerGroup = new THREE.Group();
  scene.add(winnerGroup);
  const previewGroup = new THREE.Group();
  scene.add(previewGroup);
  const previewTint = new THREE.Color('#38bdf8');

  const disposeGroup = (group: THREE.Group) => {
    while (group.children.length > 0) {
      const child = group.children[0]!;
      group.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    }
  };

  const clearSpawn = () => {
    if (!spawn) return;
    for (const entry of spawn.active) {
      spawnGroup.remove(entry.ring);
      spawnGroup.remove(entry.fan);
      entry.fan.geometry.dispose();
      (entry.fan.material as THREE.Material).dispose();
    }
    spawn = null;
    disposeGroup(winnerGroup);
    disposeGroup(previewGroup);
  };
  const blockGroup = new THREE.Group();
  scene.add(blockGroup);
  const blockGeometry = new THREE.SphereGeometry(36 * SCENE_SCALE, 12, 10);
  const blockMaterial = new THREE.MeshBasicMaterial({ color: 0xfb4a45 });
  const blockMarkers: { mesh: THREE.Mesh; revealKm: number }[] = [];
  const unreachableColor = new THREE.Color('#94a3b8');
  const openColor = new THREE.Color('#34d399');
  const laterColor = new THREE.Color('#fbbf24');
  const soonColor = new THREE.Color('#fb7185');
  const hotColor = new THREE.Color('#ffffff');
  const waveTint = new THREE.Color();

  const tintFor = (closingHour: number | null, peakHour: number) => {
    if (closingHour === null) return openColor;
    if (closingHour <= WAVE_SOON_HOURS) return soonColor;
    if (closingHour <= peakHour) return laterColor;
    return openColor;
  };

  const paintWave = () => {
    if (!wave) return;
    const { evaluation, progressKm } = wave;
    const array = roadColorAttribute.array as Float32Array;
    let litKm = 0;
    for (const segment of roadSegments) {
      const edge = terrain.graph.edges[segment.edge]!;
      if (edge.klass === 'rail') continue; // not routable; keeps its colour
      const arrival = evaluation.arrivalKm[segment.edge];
      if (arrival === null || arrival === undefined) {
        paintSegment(array, segment, unreachableColor, 0.14);
        continue;
      }
      const along = evaluation.fromA[segment.edge]
        ? segment.alongKm
        : edge.km - segment.alongKm - segment.km;
      const reachedAt = arrival + along;
      if (reachedAt <= progressKm) {
        litKm += segment.km;
        // The front burns white and cools into the road's colour behind it.
        const hot = wave.done
          ? 0
          : clamp(1 - (progressKm - reachedAt) / WAVE_HOT_KM, 0, 1);
        waveTint
          .copy(tintFor(evaluation.closingHour[segment.edge]!, evaluation.peakHour))
          .lerp(hotColor, hot * 0.85);
        paintSegment(array, segment, waveTint, 0.98, 0.26 + hot * 0.55);
      } else {
        paintSegment(array, segment, intactColor, 0.42);
      }
    }
    roadColorAttribute.needsUpdate = true;
    glowColorAttribute.needsUpdate = true;
    let cuts = 0;
    for (const marker of blockMarkers) {
      const revealed = marker.revealKm <= progressKm;
      marker.mesh.visible = revealed;
      if (revealed) {
        cuts += 1;
        // A short scale-in flash as each crossing is reached.
        const age = Math.min(1, (progressKm - marker.revealKm) / 2);
        marker.mesh.scale.setScalar(1 + (1 - age) * 1.6);
      }
    }
    wave.onProgress({ reachableKm: litKm, cuts });
    paintSiteFans(wave.done ? 1 : progressKm / (evaluation.maxKm + 1), wave.network);
  };

  const settleWave = () => {
    if (!wave || wave.done) return;
    wave.progressKm = wave.evaluation.maxKm + 1;
    wave.done = true;
    paintWave();
    wave.onDone();
    startSpawn(wave.sites, wave.onSiteSpawn, wave.onSitesDone);
  };

  const stepWave = (now: number) => {
    if (!wave || wave.done) return;
    const t = Math.min(1, (now - wave.startedAt) / WAVE_DURATION_MS);
    const eased = 1 - Math.pow(1 - t, 2);
    wave.progressKm = eased * (wave.evaluation.maxKm + 1);
    paintWave();
    if (t >= 1) settleWave();
  };

  const clearWave = () => {
    clearSpawn();
    wave = null;
    applyTowerVisibility();
    for (const marker of blockMarkers) blockGroup.remove(marker.mesh);
    blockMarkers.length = 0;
    paintRoads(lastLevel);
  };

  // --- Homes, tinted by inundation ---------------------------------------
  const houseGroup = new THREE.Group();
  scene.add(houseGroup);
  const houseCount = terrain.houses.length / 3;
  const houseHeight = elevationToWorldY(HOME_HEIGHT_METRES);
  const houseGeometry = new THREE.BoxGeometry(
    HOME_FOOTPRINT_METRES * SCENE_SCALE,
    houseHeight,
    HOME_FOOTPRINT_METRES * 0.7 * SCENE_SCALE,
  );
  houseGeometry.translate(0, houseHeight / 2, 0);
  const houseMesh = new THREE.InstancedMesh(
    houseGeometry,
    new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 }),
    houseCount,
  );
  const houseHand = new Uint8Array(houseCount);
  {
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const unit = new THREE.Vector3(1, 1, 1);
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < houseCount; i += 1) {
      const lon = terrain.houses[i * 3]!;
      const lat = terrain.houses[i * 3 + 1]!;
      rotation.setFromAxisAngle(up, terrain.houses[i * 3 + 2]!);
      matrix.compose(worldOf(lon, lat, 1), rotation, unit);
      houseMesh.setMatrixAt(i, matrix);
      houseHand[i] = handAt(lon, lat);
    }
    houseMesh.instanceMatrix.needsUpdate = true;
  }
  houseMesh.renderOrder = 2;
  houseGroup.add(houseMesh);

  const homeColor = new THREE.Color('#f6eddc');
  const floodedHomeColor = new THREE.Color('#fb4a45');
  let homesFlooded = 0;

  const paintHouses = (level: number) => {
    homesFlooded = 0;
    for (let i = 0; i < houseCount; i += 1) {
      const wet = houseHand[i] !== HAND_DRY && houseHand[i]! / 10 < level;
      if (wet) homesFlooded += 1;
      houseMesh.setColorAt(i, wet ? floodedHomeColor : homeColor);
    }
    if (houseMesh.instanceColor) houseMesh.instanceColor.needsUpdate = true;
  };

  // --- Rain forecast layer (overview only) --------------------------------
  // A translucent plane above the terrain carrying a canvas texture redrawn
  // from the forecast grid: one soft radial cell per grid cell, colour and
  // opacity following intensity, interpolated between the two nearest hours.
  const rainCanvas = document.createElement('canvas');
  rainCanvas.width = RAIN_CANVAS_WIDTH;
  rainCanvas.height = RAIN_CANVAS_HEIGHT;
  const rainContext = rainCanvas.getContext('2d');
  const rainTexture = new THREE.CanvasTexture(rainCanvas);
  rainTexture.colorSpace = THREE.SRGBColorSpace;
  const rainPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(g.extentX, g.extentZ),
    new THREE.MeshBasicMaterial({
      map: rainTexture,
      transparent: true,
      depthWrite: false,
    }),
  );
  // Lies flat; the plane's local +Y (canvas top) maps to world -Z, north.
  rainPlane.rotation.x = -Math.PI / 2;
  rainPlane.position.y = elevationToWorldY(
    meta.elevation.max + RAIN_PLANE_LIFT_METRES,
  );
  rainPlane.renderOrder = 4;
  rainPlane.visible = false;
  scene.add(rainPlane);

  let forecast: Forecast | null = null;
  let forecastHour = 0;
  const drizzle = new THREE.Color('#a9dcf7');
  const heavy = new THREE.Color('#2260c4');
  const storm = new THREE.Color('#8b5cf6');
  const cellColor = new THREE.Color();

  const drawRain = () => {
    if (!rainContext) return;
    rainContext.clearRect(0, 0, RAIN_CANVAS_WIDTH, RAIN_CANVAS_HEIGHT);
    if (!forecast) {
      rainTexture.needsUpdate = true;
      return;
    }
    const { grid, rain, hours } = forecast;
    const h0 = clamp(Math.floor(forecastHour), 0, hours - 1);
    const h1 = Math.min(h0 + 1, hours - 1);
    const th = clamp(forecastHour - h0, 0, 1);
    const cellWidth = RAIN_CANVAS_WIDTH / grid.cols;
    const cellHeight = RAIN_CANVAS_HEIGHT / grid.rows;
    const radius = Math.max(cellWidth, cellHeight) * 1.15;
    // Soft edges even where the browser lacks canvas filters.
    rainContext.filter = 'blur(5px)';
    for (let row = 0; row < grid.rows; row += 1) {
      for (let col = 0; col < grid.cols; col += 1) {
        const index = row * grid.cols + col;
        const mm =
          (rain[h0]![index] ?? 0) * (1 - th) + (rain[h1]![index] ?? 0) * th;
        if (mm < 0.3) continue;
        const t = clamp(mm / RAIN_STORM_MM, 0, 1);
        cellColor.copy(drizzle).lerp(heavy, t);
        if (mm >= RAIN_STORM_MM) {
          cellColor.lerp(storm, clamp((mm - RAIN_STORM_MM) / 25, 0, 0.8));
        }
        const alpha = 0.15 + 0.4 * t + (mm >= RAIN_STORM_MM ? 0.1 : 0);
        const cx = (col + 0.5) * cellWidth;
        const cy = (row + 0.5) * cellHeight;
        const gradient = rainContext.createRadialGradient(cx, cy, 0, cx, cy, radius);
        const rgb = `${Math.round(cellColor.r * 255)},${Math.round(cellColor.g * 255)},${Math.round(cellColor.b * 255)}`;
        gradient.addColorStop(0, `rgba(${rgb},${alpha})`);
        gradient.addColorStop(0.55, `rgba(${rgb},${alpha * 0.55})`);
        gradient.addColorStop(1, `rgba(${rgb},0)`);
        rainContext.fillStyle = gradient;
        rainContext.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
      }
    }
    rainContext.filter = 'none';
    rainTexture.needsUpdate = true;
  };

  // --- Tower and line-of-sight service area ------------------------------
  const towerGroup = new THREE.Group();
  const towerBase = worldOf(meta.towerSite.lon, meta.towerSite.lat);
  towerGroup.position.copy(towerBase);
  scene.add(towerGroup);

  const mastHeight = elevationToWorldY(PORTABLE_MAST_METRES);
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

  // The concept tower steps aside while a route run is showing its own
  // candidates and winner.
  let layerState: Record<LayerKey, boolean> | null = null;
  const applyTowerVisibility = () => {
    const showTower = wave === null;
    towerGroup.visible = showTower && (layerState?.towers ?? true);
    coverageGroup.visible = showTower && (layerState?.coverage ?? true);
    // Existing sites' fans only show during a route run: they are the hole.
    siteFanGroup.visible = wave !== null && (layerState?.coverage ?? true);
  };

  const coverageGroup = new THREE.Group();
  scene.add(coverageGroup);
  const siteFanGroup = new THREE.Group();
  siteFanGroup.visible = false;
  scene.add(siteFanGroup);

  // A coverage fan: one vertex per viewshed sample, draped on the terrain,
  // alpha where the mast has line of sight and fading with distance. The
  // material's opacity scales the whole fan, which is how a pulse is done.
  const emerald = new THREE.Color('#34d399');
  const buildFan = (
    site: { lon: number; lat: number },
    mask: ViewshedMask,
    tint: THREE.Color = emerald,
  ) => {
    const base = worldOf(site.lon, site.lat);
    const radius = mask.radiusMetres * SCENE_SCALE;
    const ringStep = radius / mask.rings;
    const vertices: number[] = [];
    const shades: number[] = [];
    const meshIndices: number[] = [];
    for (let s = 0; s < mask.spokes; s += 1) {
      const angle = (s / mask.spokes) * Math.PI * 2;
      const dirX = Math.cos(angle);
      const dirZ = Math.sin(angle);
      for (let r = 0; r <= mask.rings; r += 1) {
        const distance = r * ringStep;
        const x = base.x + dirX * distance;
        const z = base.z + dirZ * distance;
        const falloff = 1 - (distance / radius) ** 2;
        vertices.push(x, elevationToWorldY(elevationAt(x, z)) + 0.35, z);
        shades.push(
          tint.r,
          tint.g,
          tint.b,
          mask.visible[s * (mask.rings + 1) + r] ? 0.14 + 0.36 * falloff : 0,
        );
      }
    }
    for (let s = 0; s < mask.spokes; s += 1) {
      const nextSpoke = (s + 1) % mask.spokes;
      for (let r = 0; r < mask.rings; r += 1) {
        const a = s * (mask.rings + 1) + r;
        const b = a + 1;
        const c = nextSpoke * (mask.rings + 1) + r;
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
    // Per-vertex alpha kept aside so the fan can be re-tinted later.
    const alphas = new Float32Array(shades.length / 4);
    for (let i = 0; i < alphas.length; i += 1) alphas[i] = shades[i * 4 + 3]!;
    mesh.userData.alphas = alphas;
    return mesh;
  };

  /** Rewrites a fan's colour to `tint` with its alpha scaled, keeping the shape. */
  const tintFan = (fan: THREE.Mesh, tint: THREE.Color, alphaScale: number) => {
    const key = `${tint.getHex()}:${alphaScale.toFixed(3)}`;
    if (fan.userData.tintKey === key) return;
    fan.userData.tintKey = key;
    const attribute = fan.geometry.getAttribute('color') as THREE.BufferAttribute;
    const array = attribute.array as Float32Array;
    const alphas = fan.userData.alphas as Float32Array;
    for (let i = 0; i < alphas.length; i += 1) {
      array[i * 4] = tint.r;
      array[i * 4 + 1] = tint.g;
      array[i * 4 + 2] = tint.b;
      array[i * 4 + 3] = alphas[i]! * alphaScale;
    }
    attribute.needsUpdate = true;
  };

  // One fan per existing site, built once; greyed as the forecast takes the
  // site down during the route wave.
  const siteFans = new Map<string, THREE.Mesh>();
  for (const site of meta.sites) {
    const fan = buildFan(
      site,
      viewshedMask(terrain, site, site.mastMetres, SITE_COVERAGE_RADIUS_METRES),
    );
    siteFans.set(site.id, fan);
    siteFanGroup.add(fan);
  }
  const deadFanColor = new THREE.Color('#7c8594');
  const fanTint = new THREE.Color();
  const SURVIVOR_FAN_ALPHA = 0.5;
  const DEAD_FAN_ALPHA = 0.3;

  /** Fades the fans of sites the plan has lost, staggered by failure hour, as the wave runs 0→1. */
  const paintSiteFans = (progress: number, network: RouteNetwork) => {
    const horizon = Math.max(1, network.plannedHour);
    for (const [id, fan] of siteFans) {
      const failure = network.failures[id];
      const dead = failure !== null && failure !== undefined && failure <= network.plannedHour;
      if (!dead) {
        tintFan(fan, emerald, SURVIVOR_FAN_ALPHA);
        continue;
      }
      const start = 0.15 + 0.6 * clamp(failure / horizon, 0, 1);
      const f = clamp((progress - start) / 0.15, 0, 1);
      fanTint.copy(emerald).lerp(deadFanColor, f);
      tintFan(fan, fanTint, SURVIVOR_FAN_ALPHA + (DEAD_FAN_ALPHA - SURVIVOR_FAN_ALPHA) * f);
    }
  };

  const buildCoverage = () => {
    coverageGroup.add(
      buildFan(
        meta.towerSite,
        viewshedMask(terrain, meta.towerSite, PORTABLE_MAST_METRES, COVERAGE_RADIUS_METRES),
      ),
    );
  };

  buildCoverage();
  buildFlood(initialLevel);
  paintRoads(initialLevel);
  paintHouses(initialLevel);

  // --- Camera framing ----------------------------------------------------
  // Opens on the valley oblique: Gunung Stong's massif to the south-west,
  // the Sungai Galas running north-east to its confluence at Kuala Krai.
  // Frame the ground between the tower candidate and the centre of mass of
  // the modelled inundation, with the camera behind the tower looking down
  // the valley, so the scene opens on the decision at hand: mast and
  // coverage in the foreground, the severed artery and flood beyond.
  const openingLevel = initialLevel;
  let wetX = 0;
  let wetZ = 0;
  let wetCount = 0;
  for (let index = 0; index < vertexCount; index += 1) {
    if (!wetAt(index, openingLevel)) continue;
    wetX += positions[index * 3]!;
    wetZ += positions[index * 3 + 2]!;
    wetCount += 1;
  }
  const focusX = wetCount > 0 ? wetX / wetCount : 0;
  const focusZ = wetCount > 0 ? wetZ / wetCount : 0;
  const homeTarget = new THREE.Vector3(
    (focusX + towerBase.x) / 2,
    elevationToWorldY(
      elevationAt((focusX + towerBase.x) / 2, (focusZ + towerBase.z) / 2),
    ),
    (focusZ + towerBase.z) / 2,
  );
  const orbitDistance = Math.max(g.extentX, g.extentZ) * 0.48;
  const behindTower = new THREE.Vector3(
    towerBase.x - focusX,
    0,
    towerBase.z - focusZ,
  );
  if (behindTower.lengthSq() < 1e-6) behindTower.set(-1.15, 0, 0.9);
  behindTower.normalize().setY(0.62);
  const homePosition = homeTarget
    .clone()
    .add(behindTower.normalize().multiplyScalar(orbitDistance));
  camera.position.copy(homePosition);
  controls.target.copy(homeTarget);
  controls.update();

  // --- Views: oblique ground view and top-down overview -------------------
  let view: View = 'ground';
  type Flight = {
    to: View;
    fromPosition: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toPosition: THREE.Vector3;
    toTarget: THREE.Vector3;
    fromSun: number;
    elapsed: number;
  };
  let flight: Flight | null = null;

  // The overview pivots on the AOI centre and sits high enough to fit the
  // whole tile at the camera's field of view and current aspect.
  const overviewTarget = new THREE.Vector3(
    0,
    elevationToWorldY(elevationAt(0, 0)),
    0,
  );
  const overviewDistance = () => {
    const halfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const fitZ = g.extentZ / 2 / halfFov;
    const fitX = g.extentX / 2 / (halfFov * camera.aspect);
    return Math.max(fitX, fitZ) * 1.5;
  };
  // The site view stands behind the Kuala Krai depot, raised, looking down
  // the valley toward the AOI centre: the route wave starts right in front of
  // the camera and runs away into the distance.
  const depotBase = worldOf(meta.depot.lon, meta.depot.lat);
  const siteTarget = new THREE.Vector3().lerpVectors(
    depotBase,
    overviewTarget,
    0.3,
  );
  siteTarget.y = elevationToWorldY(elevationAt(siteTarget.x, siteTarget.z));
  const awayFromCentre = new THREE.Vector3(
    depotBase.x - overviewTarget.x,
    0,
    depotBase.z - overviewTarget.z,
  );
  if (awayFromCentre.lengthSq() < 1e-6) awayFromCentre.set(1, 0, -1);
  awayFromCentre.normalize().setY(0.58).normalize();
  const sitePosition = siteTarget
    .clone()
    .add(awayFromCentre.multiplyScalar(orbitDistance * 0.95));
  // Keep the camera over the tile so its edge never enters the frame.
  const siteMargin = 0.08;
  sitePosition.x = clamp(sitePosition.x, (-g.extentX / 2) * (1 - siteMargin), (g.extentX / 2) * (1 - siteMargin));
  sitePosition.z = clamp(sitePosition.z, (-g.extentZ / 2) * (1 - siteMargin), (g.extentZ / 2) * (1 - siteMargin));

  const overviewPosition = () => {
    const distance = overviewDistance();
    // A hair off vertical on the south side keeps OrbitControls' azimuth
    // well defined and puts north at the top of the screen.
    return new THREE.Vector3(
      overviewTarget.x,
      overviewTarget.y + distance,
      overviewTarget.z + distance * 0.001,
    );
  };

  const applyViewState = (next: View) => {
    view = next;
    const overview = next === 'overview';
    // 'site' is a ground view framed from the depot; only the overview changes the scene's dressing.
    controls.enableRotate = !overview;
    controls.minPolarAngle = overview ? 0.001 : 0.2;
    controls.maxPolarAngle = overview ? 0.001 : 1.45;
    controls.maxDistance = overview ? overviewDistance() * 1.35 : 700;
    scene.fog = overview ? null : fog;
    scene.background = overview ? null : sky;
    sun.intensity = overview ? SUN_OVERVIEW : SUN_GROUND;
    rainPlane.visible = overview && forecast !== null;
  };

  const stepFlight = (dt: number) => {
    if (!flight) return;
    flight.elapsed += dt;
    const t = Math.min(1, flight.elapsed / FLIGHT_SECONDS);
    const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    camera.position.lerpVectors(flight.fromPosition, flight.toPosition, eased);
    controls.target.lerpVectors(flight.fromTarget, flight.toTarget, eased);
    const toSun = flight.to === 'overview' ? SUN_OVERVIEW : SUN_GROUND;
    sun.intensity = flight.fromSun + (toSun - flight.fromSun) * eased;
    camera.lookAt(controls.target);
    if (t >= 1) {
      const destination = flight.to;
      flight = null;
      applyViewState(destination);
      controls.enabled = true;
      controls.update();
    }
  };

  // Keep the orbit pivot inside the tile so the view can never wander off
  // into the void. Its height is only re-grounded once a gesture has ended,
  // and gently: snapping it to the terrain mid-pan made the camera heave
  // over every ridge.
  const halfExtentX = g.extentX / 2;
  const halfExtentZ = g.extentZ / 2;
  const clampPivot = (dt: number, gesturing: boolean) => {
    const target = controls.target;
    const x = clamp(target.x, -halfExtentX, halfExtentX);
    const z = clamp(target.z, -halfExtentZ, halfExtentZ);
    const dx = x - target.x;
    const dz = z - target.z;
    let dy = 0;
    if (!gesturing) {
      const groundY = elevationToWorldY(elevationAt(x, z));
      dy = (groundY - target.y) * (1 - Math.exp(-dt / 0.35));
      if (Math.abs(dy) < 1e-4) dy = 0;
    }
    if (dx === 0 && dy === 0 && dz === 0) return;
    target.set(x, target.y + dy, z);
    camera.position.x += dx;
    camera.position.y += dy;
    camera.position.z += dz;
  };

  // --- Marker projection -------------------------------------------------
  const anchorPoints = anchors.map((anchor) => ({
    id: anchor.id,
    kind: anchor.kind,
    point: worldOf(anchor.lon, anchor.lat, anchor.liftMetres),
  }));
  const projected = new THREE.Vector3();

  const updateMarkers = () => {
    const viewWidth = container.clientWidth;
    const viewHeight = container.clientHeight;
    const placed: { anchor: (typeof anchorPoints)[number]; element: HTMLElement; hidden: boolean; x: number; y: number }[] = [];
    for (const anchor of anchorPoints) {
      const element = markerElements.get(anchor.id);
      if (!element) continue;
      projected.copy(anchor.point).project(camera);
      // Settlements stay labelled in the overview (they carry the rain
      // readouts); the tower only makes sense from the ground.
      let hidden =
        projected.z > 1 ||
        flight !== null ||
        (view === 'overview' && anchor.kind !== 'population') ||
        (anchor.kind === 'tower' && wave !== null);
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
      placed.push({
        anchor,
        element,
        hidden,
        x: (projected.x * 0.5 + 0.5) * viewWidth,
        y: (-projected.y * 0.5 + 0.5) * viewHeight,
      });
    }
    // A settlement label gives way to any site, candidate, depot or tower
    // marker close enough to collide with it: the decision markers win.
    for (const item of placed) {
      if (item.hidden || item.anchor.kind !== 'population') continue;
      for (const other of placed) {
        if (other.hidden || other.anchor.kind === 'population') continue;
        if (Math.abs(other.x - item.x) < 110 && Math.abs(other.y - item.y) < 44) {
          item.hidden = true;
          break;
        }
      }
    }
    for (const { element, hidden, x, y } of placed) {
      element.style.visibility = hidden ? 'hidden' : 'visible';
      element.style.opacity = hidden ? '0' : '1';
      element.style.transform = `translate3d(${x}px, ${y}px, 0)`;
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

  // A gesture is a live drag, or a wheel/pinch within the last quarter second.
  let dragging = false;
  let gestureUntil = 0;
  const onDragStart = () => {
    dragging = true;
  };
  const onDragEnd = () => {
    dragging = false;
    gestureUntil = performance.now() + GESTURE_TAIL_MS;
  };
  controls.addEventListener('start', onDragStart);
  controls.addEventListener('end', onDragEnd);

  // --- Trackpad gestures -------------------------------------------------
  // Pinch (ctrl+wheel on macOS) zooms toward the ground under the pointer;
  // a plain two-finger scroll flies the camera up and down (vertical) and
  // orbits the pivot (horizontal). Each gesture feeds a goal that the frame
  // loop eases toward, so nothing steps the way OrbitControls' instant
  // per-event dolly does.
  let zoomGoalLog = Math.log(camera.position.distanceTo(controls.target));
  let zoomActive = false;
  let orbitPending = 0; // radians of azimuth still to apply
  let flyPending = 0; // fraction of camera height still to apply
  const orbitOffset = new THREE.Vector3();
  const worldUp = new THREE.Vector3(0, 1, 0);
  const zoomAnchor = new THREE.Vector3();
  let zoomAnchorValid = false;
  const wheelRay = new THREE.Vector3();
  const probe = new THREE.Vector3();

  const belowGround = (point: THREE.Vector3) =>
    point.y <= elevationToWorldY(elevationAt(point.x, point.z));

  const groundUnderPointer = (
    clientX: number,
    clientY: number,
    out: THREE.Vector3,
  ) => {
    const rect = renderer.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    wheelRay
      .set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
        0.5,
      )
      .unproject(camera)
      .sub(camera.position)
      .normalize();
    // March until the ray dips under the terrain, then bisect the last step.
    const reach = 2400;
    const steps = 96;
    let previous = 0;
    for (let i = 1; i <= steps; i += 1) {
      const t = (i / steps) * reach;
      probe.copy(camera.position).addScaledVector(wheelRay, t);
      if (
        Math.abs(probe.x) > halfExtentX + 100 ||
        Math.abs(probe.z) > halfExtentZ + 100
      ) {
        return false;
      }
      if (belowGround(probe)) {
        let low = previous;
        let high = t;
        for (let k = 0; k < 8; k += 1) {
          const mid = (low + high) / 2;
          probe.copy(camera.position).addScaledVector(wheelRay, mid);
          if (belowGround(probe)) high = mid;
          else low = mid;
        }
        out.copy(camera.position).addScaledVector(wheelRay, high);
        return true;
      }
      previous = t;
    }
    return false;
  };

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1;
    const deltaX = event.deltaX * unit;
    const deltaY = event.deltaY * unit;
    if (event.ctrlKey) {
      // macOS pinch arrives as ctrl+wheel with tiny deltas.
      zoomGoalLog = clamp(
        zoomGoalLog + deltaY * 8 * WHEEL_ZOOM_RATE,
        Math.log(controls.minDistance),
        Math.log(controls.maxDistance),
      );
      zoomActive = true;
      zoomAnchorValid = groundUnderPointer(
        event.clientX,
        event.clientY,
        zoomAnchor,
      );
    } else {
      // Two-finger scroll: sideways orbits, up and down flies. Signs follow
      // natural scrolling so the world moves with the fingers.
      if (view !== 'overview') orbitPending += deltaX * SWIPE_ORBIT_RATE;
      flyPending -= deltaY * SWIPE_FLY_RATE;
    }
    gestureUntil = performance.now() + GESTURE_TAIL_MS;
    markInteraction();
  };
  // Capture on the container so this runs before OrbitControls' own wheel
  // handler on the canvas; touch pinch still goes through OrbitControls.
  container.addEventListener('wheel', onWheel, {
    passive: false,
    capture: true,
  });

  const applyGestures = (dt: number) => {
    const ease = 1 - Math.exp(-dt / GESTURE_EASE_SECONDS);

    // Zoom toward the anchor.
    const current = camera.position.distanceTo(controls.target);
    if (!zoomActive) {
      // Follow touch pinch and programmatic moves so the next wheel starts here.
      zoomGoalLog = Math.log(current);
    } else {
      const goal = Math.exp(zoomGoalLog);
      if (Math.abs(goal - current) < 0.02) {
        zoomActive = false;
      } else {
        const next = current + (goal - current) * ease;
        const scale = next / current;
        const pivot = zoomAnchorValid ? zoomAnchor : controls.target;
        controls.target.sub(pivot).multiplyScalar(scale).add(pivot);
        camera.position.sub(pivot).multiplyScalar(scale).add(pivot);
      }
    }

    // Orbit around the pivot.
    if (Math.abs(orbitPending) > 1e-5) {
      const step = orbitPending * ease;
      orbitPending -= step;
      orbitOffset.copy(camera.position).sub(controls.target);
      orbitOffset.applyAxisAngle(worldUp, step);
      camera.position.copy(controls.target).add(orbitOffset);
    } else {
      orbitPending = 0;
    }

    // Fly up or down: move the camera vertically over the same pivot. The
    // polar and distance limits in OrbitControls keep it above the ground
    // and inside the zoom range.
    if (Math.abs(flyPending) > 1e-5) {
      const step = flyPending * ease;
      flyPending -= step;
      const height = Math.max(camera.position.y - controls.target.y, 4);
      camera.position.y += height * step;
    } else {
      flyPending = 0;
    }
  };

  // --- Adaptive resolution -----------------------------------------------
  // Start below full Retina density and let measured frame times decide:
  // step down when frames run long, creep back up when they stay short,
  // and shave a little more during a gesture so dragging always feels light.
  const maxRatio = Math.min(deviceRatio, 2);
  let baseRatio = Math.min(deviceRatio, 1.5);
  let appliedRatio = 0;
  const frameTimes: number[] = [];
  let calmMs = 0;

  const applyRatio = (ratio: number) => {
    if (Math.abs(ratio - appliedRatio) < 0.01) return;
    appliedRatio = ratio;
    renderer.setPixelRatio(ratio);
    renderer.setSize(
      container.clientWidth,
      Math.max(container.clientHeight, 1),
      false,
    );
  };

  const adaptResolution = (dtMs: number, gesturing: boolean) => {
    frameTimes.push(dtMs);
    if (frameTimes.length > FRAME_SAMPLE) frameTimes.shift();
    let sum = 0;
    for (const value of frameTimes) sum += value;
    const average = sum / frameTimes.length;
    if (frameTimes.length === FRAME_SAMPLE && average > 18 && baseRatio > 1) {
      baseRatio = Math.max(1, baseRatio - 0.25);
      frameTimes.length = 0;
      calmMs = 0;
    } else if (average < 9) {
      calmMs += dtMs;
      if (calmMs > 2000 && baseRatio < maxRatio) {
        baseRatio = Math.min(maxRatio, baseRatio + 0.25);
        frameTimes.length = 0;
        calmMs = 0;
      }
    } else {
      calmMs = 0;
    }
    applyRatio(gesturing ? Math.max(1, baseRatio * 0.8) : baseRatio);
  };

  let lastFrameTime = performance.now();

  const renderFrame = () => {
    frame = requestAnimationFrame(renderFrame);
    const now = performance.now();
    const dtMs = Math.min(now - lastFrameTime, 50);
    lastFrameTime = now;
    const dt = dtMs / 1000;
    const gesturing = dragging || now < gestureUntil;
    const idle = now - lastInteraction > IDLE_DRIFT_DELAY;
    controls.autoRotate =
      idle && !reduceMotion?.matches && view !== 'overview' && !flight;
    // OrbitControls damps per update() call; scale the factor by the frame
    // interval so the feel is the same at 60 Hz and on a 120 Hz display.
    controls.dampingFactor = 1 - Math.pow(1 - BASE_DAMPING, dtMs / (1000 / 60));
    if (flight) {
      // The tween owns the camera; OrbitControls would clamp it mid-flight.
      stepFlight(dt);
    } else {
      applyGestures(dt);
      controls.update(dt);
      clampPivot(dt, gesturing);
    }
    stepWave(now);
    stepSpawn(now);
    stepConvoyRing(now);
    adaptResolution(dtMs, gesturing);
    updateMarkers();
    renderer.render(scene, camera);
  };
  frame = requestAnimationFrame(renderFrame);

  const resize = () => {
    const viewWidth = container.clientWidth;
    const viewHeight = Math.max(container.clientHeight, 1);
    camera.aspect = viewWidth / viewHeight;
    // A portrait phone puts the overview camera far higher than a landscape
    // screen does; keep the far plane beyond it or the tile goes black.
    camera.far = Math.max(3000, overviewDistance() * 2.2);
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
      lastFrameTime = performance.now();
      frameTimes.length = 0;
      frame = requestAnimationFrame(renderFrame);
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  return {
    setLayers(layers) {
      layerState = layers;
      floodMesh.visible = layers.flood;
      roadGroup.visible = layers.roads;
      houseGroup.visible = layers.population;
      applyTowerVisibility();
    },
    setLevel(metres) {
      buildFlood(metres);
      paintRoads(metres);
      paintHouses(metres);
    },
    setForecast(next) {
      forecast = next;
      rainPlane.visible = view === 'overview';
      drawRain();
    },
    setForecastHour(hour) {
      forecastHour = hour;
      drawRain();
    },
    metrics() {
      return { severedKm, floodedKm2, homesFlooded };
    },
    playRouteWave(evaluation, sites, network, callbacks) {
      clearWave();
      for (const fan of siteFans.values()) tintFan(fan, emerald, SURVIVOR_FAN_ALPHA);
      for (const crossing of evaluation.blocked) {
        const mesh = new THREE.Mesh(blockGeometry, blockMaterial);
        mesh.position.copy(worldOf(crossing.lon, crossing.lat, 8));
        mesh.visible = false;
        blockGroup.add(mesh);
        blockMarkers.push({ mesh, revealKm: crossing.revealKm });
      }
      wave = {
        evaluation,
        startedAt: performance.now(),
        progressKm: 0,
        done: false,
        onProgress: callbacks.onProgress,
        onDone: callbacks.onDone,
        sites,
        network,
        onSiteSpawn: callbacks.onSiteSpawn,
        onSitesDone: callbacks.onSitesDone,
      };
      applyTowerVisibility();
      if (reduceMotion?.matches) settleWave();
      else paintWave();
    },
    finishRouteWave() {
      settleWave();
      finishSpawn();
    },
    showWinner(site) {
      disposeGroup(winnerGroup);
      if (!site) return;
      const base = worldOf(site.candidate.lon, site.candidate.lat);
      const winnerMast = new THREE.Mesh(mast.geometry.clone(), mastMaterial.clone());
      winnerMast.position.set(base.x, base.y + mastHeight / 2, base.z);
      winnerGroup.add(winnerMast);
      const winnerBeacon = new THREE.Mesh(
        beacon.geometry.clone(),
        new THREE.MeshBasicMaterial({ color: 0x34d399 }),
      );
      winnerBeacon.position.set(base.x, base.y + mastHeight * 1.05, base.z);
      winnerGroup.add(winnerBeacon);
      winnerGroup.add(buildFan(site.candidate, site.mask));

      // Backhaul: a dashed line from this mast to the surviving site it links to.
      const parent = site.backhaulTo ? meta.sites.find((s) => s.id === site.backhaulTo) : undefined;
      if (parent) {
        const from = base.clone();
        from.y += mastHeight;
        const to = worldOf(parent.lon, parent.lat, parent.mastMetres);
        const geometry = new THREE.BufferGeometry().setFromPoints([from, to]);
        const line = new THREE.Line(
          geometry,
          new THREE.LineDashedMaterial({
            color: 0x7dd3fc,
            dashSize: 60 * SCENE_SCALE,
            gapSize: 40 * SCENE_SCALE,
            transparent: true,
            opacity: 0.9,
          }),
        );
        line.computeLineDistances();
        line.renderOrder = 4;
        winnerGroup.add(line);
      }

      // Glide in from the current bearing, close enough to read the fan.
      const target = base.clone();
      const bearing = new THREE.Vector3()
        .subVectors(camera.position, controls.target)
        .setY(0);
      if (bearing.lengthSq() < 1e-6) bearing.set(1, 0, 1);
      bearing.normalize().setY(0.55).normalize();
      const toPosition = target
        .clone()
        .add(bearing.multiplyScalar(orbitDistance * 0.34));
      zoomActive = false;
      zoomAnchorValid = false;
      orbitPending = 0;
      flyPending = 0;
      lastInteraction = performance.now();
      if (reduceMotion?.matches) {
        flight = null;
        camera.position.copy(toPosition);
        controls.target.copy(target);
        controls.update();
        return;
      }
      controls.enabled = false;
      flight = {
        to: 'site',
        fromPosition: camera.position.clone(),
        fromTarget: controls.target.clone(),
        toPosition,
        toTarget: target,
        fromSun: sun.intensity,
        elapsed: 0,
      };
    },
    glideToDepot() {
      if (view !== 'site' || flight || reduceMotion?.matches) return;
      const ground = depotBase.clone();
      ground.y = elevationToWorldY(elevationAt(ground.x, ground.z));
      const toTarget = controls.target.clone().lerp(ground, 0.35);
      const toPosition = camera.position.clone().lerp(ground, 0.16);
      toPosition.y = Math.max(toPosition.y, camera.position.y * 0.92);
      zoomActive = false;
      zoomAnchorValid = false;
      orbitPending = 0;
      flyPending = 0;
      lastInteraction = performance.now();
      controls.enabled = false;
      flight = {
        to: 'site',
        fromPosition: camera.position.clone(),
        fromTarget: controls.target.clone(),
        toPosition,
        toTarget,
        fromSun: sun.intensity,
        elapsed: 0,
      };
    },
    highlightConvoy(siteId) {
      if (convoyRing) {
        convoyGroup.remove(convoyRing);
        convoyRing = null;
      }
      const site = siteId ? meta.sites.find((s) => s.id === siteId) : undefined;
      if (!site) return;
      convoyRing = new THREE.Mesh(convoyGeometry, convoyMaterial);
      convoyRing.position.copy(worldOf(site.lon, site.lat, 4));
      convoyRing.rotation.x = -Math.PI / 2;
      convoyRing.renderOrder = 3;
      convoyGroup.add(convoyRing);
    },
    previewSite(site) {
      disposeGroup(previewGroup);
      if (!site) return;
      previewGroup.add(buildFan(site.candidate, site.mask, previewTint));
    },
    clearRouteWave() {
      clearWave();
    },
    flyTo(next) {
      if (next === view && !flight) return;
      zoomActive = false;
      zoomAnchorValid = false;
      orbitPending = 0;
      flyPending = 0;
      lastInteraction = performance.now();
      const toPosition =
        next === 'overview'
          ? overviewPosition()
          : next === 'site'
            ? sitePosition.clone()
            : homePosition.clone();
      const toTarget =
        next === 'overview'
          ? overviewTarget.clone()
          : next === 'site'
            ? siteTarget.clone()
            : homeTarget.clone();
      if (reduceMotion?.matches) {
        flight = null;
        camera.position.copy(toPosition);
        controls.target.copy(toTarget);
        applyViewState(next);
        controls.enabled = true;
        controls.update();
        return;
      }
      // Sky, fog and the rain layer switch at take-off so nothing pops at
      // the end.
      scene.fog = next === 'overview' ? null : fog;
      scene.background = next === 'overview' ? null : sky;
      rainPlane.visible = next === 'overview' && forecast !== null;
      controls.enabled = false;
      flight = {
        to: next,
        fromPosition: camera.position.clone(),
        fromTarget: controls.target.clone(),
        toPosition,
        toTarget,
        fromSun: sun.intensity,
        elapsed: 0,
      };
    },
    resetView() {
      flight = null;
      controls.enabled = true;
      applyViewState('ground');
      camera.position.copy(homePosition);
      controls.target.copy(homeTarget);
      zoomActive = false;
      zoomAnchorValid = false;
      orbitPending = 0;
      flyPending = 0;
      controls.update();
      lastInteraction = performance.now();
    },
    dispose() {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      container.removeEventListener('wheel', onWheel, { capture: true });
      controls.removeEventListener('start', markInteraction);
      controls.removeEventListener('change', markInteraction);
      controls.removeEventListener('start', onDragStart);
      controls.removeEventListener('end', onDragEnd);
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
      rainTexture.dispose();
      blockGeometry.dispose();
      blockMaterial.dispose();
      ringGeometry.dispose();
      ringMaterial.dispose();
      convoyGeometry.dispose();
      convoyMaterial.dispose();
      sky.dispose();
      scene.background = null;
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

/** What the marker shows for an existing site: status now, and when/why it fails. */
export type SiteMarkerState = {
  status: SiteStatus;
  cause: FailureCause | null;
  failureHour: number | null;
  manual: boolean;
};

export type RouteRun = {
  /** Changes for every new Start press. */
  id: number;
  evaluation: RouteEvaluation;
  /** Reachable candidates in spawn order, with their viewsheds. */
  sites: SiteAssessment[];
  /** Which existing sites go dark, and by when the plan is judged. */
  network: RouteNetwork;
  /** True once the officer asked to skip the animation. */
  skip: boolean;
  /** A re-plan after the officer's report: drawn in its final state at once. */
  instant: boolean;
};

export type RouteNetwork = {
  /** Forecast hour each existing site fails, or null if it survives. */
  failures: Record<string, number | null>;
  plannedHour: number;
};

export function Terrain3D({
  layers,
  level,
  view,
  forecast,
  forecastHour,
  routeRun,
  onRouteProgress,
  onRouteDone,
  spawnedIds,
  onSiteSpawn,
  onSitesDone,
  winnerId,
  previewId,
  onPreview,
  siteStates,
  onSiteTap,
  convoyId,
  topUpIds,
  resetSignal,
}: {
  layers: Record<LayerKey, boolean>;
  /** HAND flood threshold in metres above the drainage datum. */
  level: number;
  view: View;
  forecast: Forecast | null;
  forecastHour: number;
  /** A route evaluation to animate, or null to clear the wave. */
  routeRun: RouteRun | null;
  onRouteProgress: (state: { reachableKm: number; cuts: number }) => void;
  onRouteDone: () => void;
  /** Candidate ids whose markers should be on screen. */
  spawnedIds: string[];
  onSiteSpawn: (id: string) => void;
  onSitesDone: () => void;
  /** The chosen site once the evaluation has finished; null before that. */
  winnerId: string | null;
  /** A runner-up whose coverage is being previewed. */
  previewId: string | null;
  onPreview: (id: string) => void;
  /** Existing-site status by site id; tapping a marker cycles its override. */
  siteStates: Record<string, SiteMarkerState>;
  onSiteTap: (id: string) => void;
  /** Site the plan sends the convoy to, once the evaluation is done. */
  convoyId: string | null;
  /** Sites the plan assumes local crews top up before their access closes. */
  topUpIds: string[];
  resetSignal: number;
}) {
  // The baked assets are fetched from the client only: this component is
  // prerendered during the static export, where a relative URL has no origin.
  const [terrain, setTerrain] = useState<TerrainData | null>(null);
  const [failed, setFailed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const markerRefs = useRef(new Map<string, HTMLDivElement>());
  const sceneRef = useRef<SceneHandle | null>(null);
  const levelRef = useRef(level);
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
      levelRef.current,
    );
    sceneRef.current = handle;
    return () => {
      sceneRef.current = null;
      handle.dispose();
    };
  }, [terrain, anchors]);

  // The scene only exists once the terrain assets arrive, so these must
  // re-run at that point as well as when the control changes.
  useEffect(() => {
    sceneRef.current?.setLayers(layers);
  }, [layers, terrain]);

  useEffect(() => {
    levelRef.current = level;
    sceneRef.current?.setLevel(level);
  }, [level, terrain]);

  useEffect(() => {
    sceneRef.current?.flyTo(view);
  }, [view, terrain]);

  useEffect(() => {
    if (forecast) sceneRef.current?.setForecast(forecast);
  }, [forecast, terrain]);

  useEffect(() => {
    sceneRef.current?.setForecastHour(forecastHour);
  }, [forecastHour, terrain]);

  // A new evaluation object arrives with every Start press; the callbacks
  // are stable, so the wave only restarts when the evaluation changes.
  const routeEvaluation = routeRun?.evaluation ?? null;
  const routeSites = routeRun?.sites ?? null;
  const routeNetwork = routeRun?.network ?? null;
  const routeInstant = routeRun?.instant ?? false;
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (routeEvaluation === null || routeSites === null || routeNetwork === null) {
      scene.clearRouteWave();
      return;
    }
    // A re-plan after a report keeps the camera where the officer left it
    // and shows the new plan at once; a fresh Start plays the wave.
    if (!routeInstant) scene.glideToDepot();
    scene.playRouteWave(routeEvaluation, routeSites, routeNetwork, {
      onProgress: onRouteProgress,
      onDone: onRouteDone,
      onSiteSpawn,
      onSitesDone,
    });
    if (routeInstant) scene.finishRouteWave();
  }, [
    routeEvaluation,
    routeSites,
    routeNetwork,
    routeInstant,
    onRouteProgress,
    onRouteDone,
    onSiteSpawn,
    onSitesDone,
    terrain,
  ]);

  useEffect(() => {
    if (routeRun?.skip) sceneRef.current?.finishRouteWave();
  }, [routeRun?.skip]);

  useEffect(() => {
    sceneRef.current?.highlightConvoy(convoyId);
  }, [convoyId, terrain]);

  const winnerSite = routeSites?.find((site) => site.id === winnerId) ?? null;
  useEffect(() => {
    sceneRef.current?.showWinner(winnerSite);
  }, [winnerSite, terrain]);

  const previewSite = routeSites?.find((site) => site.id === previewId) ?? null;
  useEffect(() => {
    sceneRef.current?.previewSite(previewSite);
  }, [previewSite, terrain]);

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
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {anchors.map((anchor) => {
          const site =
            anchor.kind === 'candidate'
              ? routeSites?.find((entry) => entry.id === anchor.id)
              : undefined;
          const visible =
            anchor.kind === 'tower'
              ? layers.towers
              : anchor.kind === 'site'
                ? layers.sites
                : anchor.kind === 'depot'
                  ? true
                  : anchor.kind === 'candidate'
                    ? site !== undefined && spawnedIds.includes(anchor.id)
                    : layers.population;
          if (!visible) return null;
          // In the overview a settlement shows the rain falling on it right
          // now, sampled from the forecast grid at the selected hour.
          const overview = view === 'overview' && anchor.kind === 'population';
          const rain =
            overview && forecast
              ? rainAt(forecast, forecastHour, anchor.lon, anchor.lat)
              : 0;
          const rainTone =
            rain >= 40
              ? 'border-violet-300/40 bg-violet-500/25 text-violet-100'
              : rain >= 2
                ? 'border-sky-300/40 bg-sky-500/20 text-sky-100'
                : 'border-slate-500/40 bg-slate-800/70 text-slate-300';
          return (
            <div
              key={anchor.id}
              ref={registerMarker(anchor.id)}
              className="map-marker absolute left-0 top-0 transition-opacity duration-150 will-change-transform"
            >
              {overview ? (
                <div
                  className={`flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-1 text-[11px] font-semibold backdrop-blur-sm ${rainTone}`}
                >
                  <span className="size-1.5 rounded-full bg-current" />
                  {anchor.label}
                  <span className="font-normal opacity-80 tabular-nums">
                    {rain.toFixed(0)} mm/h
                  </span>
                </div>
              ) : anchor.kind === 'candidate' && anchor.id === winnerId ? (
                <div className="flex -translate-x-1/2 -translate-y-full flex-col items-center">
                  <div className="mb-2 whitespace-nowrap rounded-lg border border-emerald-300/45 bg-[#07131d]/92 px-3 py-2 shadow-xl backdrop-blur-md">
                    <div className="text-[10px] font-semibold tracking-[0.12em] text-emerald-300 uppercase">
                      Best site
                    </div>
                    <div className="flex items-center gap-2 text-sm font-semibold text-white">
                      <RadioTower className="size-4 text-emerald-300" aria-hidden />
                      {anchor.label}
                    </div>
                    <div className="mt-0.5 pl-6 text-xs text-emerald-100/85 tabular-nums">
                      reconnects {(site?.peopleReconnected ?? 0).toLocaleString()} people without signal
                    </div>
                  </div>
                  <div className="grid size-9 place-items-center rounded-full border-2 border-white bg-emerald-400 text-emerald-950 shadow-[0_0_0_7px_rgb(52_211_153/22%)]">
                    <RadioTower className="size-4" aria-hidden />
                  </div>
                </div>
              ) : anchor.kind === 'candidate' && winnerId !== null ? (
                // Runner-up: a muted badge with its count; tap to preview coverage.
                <button
                  type="button"
                  onClick={() => onPreview(anchor.id)}
                  aria-pressed={previewId === anchor.id}
                  title={`${anchor.label}: reconnects ${(site?.peopleReconnected ?? 0).toLocaleString()} people without signal`}
                  className={`pointer-events-auto flex min-h-7 -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 whitespace-nowrap rounded-full border px-2 text-[11px] font-semibold tabular-nums backdrop-blur-sm transition-colors ${
                    previewId === anchor.id
                      ? 'border-sky-300/60 bg-sky-500/30 text-white'
                      : 'border-slate-500/40 bg-slate-900/70 text-slate-300 hover:border-sky-300/40 hover:text-white'
                  }`}
                >
                  <span className="size-1.5 rounded-full bg-current opacity-70" />
                  {(site?.peopleReconnected ?? 0).toLocaleString()}
                </button>
              ) : anchor.kind === 'candidate' ? (
                <div className="flex -translate-x-1/2 -translate-y-full flex-col items-center">
                  <div className="mb-1 whitespace-nowrap rounded-md border border-emerald-300/30 bg-[#07131d]/85 px-2 py-1 text-[11px] leading-4 backdrop-blur-sm">
                    <span className="font-semibold text-white">{anchor.label}</span>
                    <span className="block text-emerald-200/90 tabular-nums">
                      reconnects {(site?.peopleReconnected ?? 0).toLocaleString()} people without signal
                    </span>
                  </div>
                  <span className="size-2.5 rounded-full border-2 border-white bg-emerald-400 shadow-[0_0_0_4px_rgb(52_211_153/25%)]" />
                </div>
              ) : anchor.kind === 'site' ? (
                (() => {
                  const state = siteStates[anchor.id];
                  const status = state?.status ?? 'up';
                  const dot =
                    status === 'down'
                      ? 'bg-red-500'
                      : status === 'battery'
                        ? 'bg-amber-400'
                        : 'bg-emerald-400';
                  const why =
                    state?.failureHour === null || state === undefined
                      ? 'survives the forecast'
                      : `${state.cause} at +${state.failureHour} h`;
                  return (
                    // Tapping cycles the officer's override: auto → up → battery → down.
                    <button
                      type="button"
                      onClick={() => onSiteTap(anchor.id)}
                      title={`${anchor.label} · ${status}${state?.manual ? ' (reported)' : ''} · ${why}${topUpIds.includes(anchor.id) ? ' · topped up by a local crew in the plan' : ''}${anchor.detail === 'placeholder site' ? ' · placeholder site' : ''}`}
                      aria-label={`${anchor.label}, ${status}${state?.manual ? ', reported by the officer' : ''}; tap to report a change`}
                      className="pointer-events-auto flex -translate-x-1/2 -translate-y-full cursor-pointer flex-col items-center"
                    >
                      <span
                        className={`mb-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[10px] font-semibold backdrop-blur-sm ${
                          status === 'down'
                            ? 'border-red-400/40 bg-[#1a0b0b]/85 text-red-100'
                            : status === 'battery'
                              ? 'border-amber-300/40 bg-[#1a1408]/85 text-amber-100'
                              : 'border-slate-500/40 bg-[#07131d]/85 text-slate-200'
                        }`}
                      >
                        {anchor.label}
                        {state?.manual && (
                          <span className="ml-1 rounded bg-sky-400/20 px-1 font-normal text-sky-200">reported</span>
                        )}
                        {topUpIds.includes(anchor.id) && (
                          <span className="ml-1 rounded bg-emerald-400/20 px-1 font-normal text-emerald-200">top-up</span>
                        )}
                        {anchor.detail === 'placeholder site' && (
                          <span className="ml-1 font-normal text-slate-500">seed</span>
                        )}
                      </span>
                      <span className="relative grid size-6 place-items-center rounded-full border border-slate-400/50 bg-slate-900/85 text-slate-200">
                        <RadioTower className="size-3.5" aria-hidden />
                        <span
                          className={`absolute -right-0.5 -top-0.5 size-2.5 rounded-full border border-slate-950 ${dot}`}
                          aria-label={`status: ${status}`}
                        />
                      </span>
                    </button>
                  );
                })()
              ) : anchor.kind === 'depot' ? (
                <div className="flex -translate-x-1/2 -translate-y-full flex-col items-center">
                  <span className="mb-1.5 whitespace-nowrap rounded-md border border-amber-200/30 bg-[#07131d]/85 px-2 py-1 text-xs font-semibold text-amber-100 backdrop-blur-sm">
                    {anchor.label}
                  </span>
                  <div className="grid size-8 place-items-center rounded-full border-2 border-white bg-amber-400 text-amber-950 shadow-[0_0_0_6px_rgb(251_191_36/18%)]">
                    <Warehouse className="size-4" aria-hidden />
                  </div>
                </div>
              ) : anchor.kind === 'tower' ? (
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
