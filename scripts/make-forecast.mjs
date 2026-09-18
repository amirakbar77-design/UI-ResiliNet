/**
 * Writes public/forecast.json: an illustrative 24-hour rain forecast on a
 * coarse grid over the terrain AOI, plus the catchment-mean rain per hour.
 *
 *   node scripts/make-forecast.mjs
 *
 * This is the demo's "Scenario · design storm": synthetic, labelled as such
 * on the chip and in the README, the way flood planners use a design storm.
 * The three real feeds (scripts/fetch-weathernext.py, scripts/fetch-replay.py)
 * sit behind the same chip. Its "catchment mean" is a tile mean of the drawn
 * band, not a basin mean.
 *
 * The pattern is a convective band that forms over the Gunung Stong massif
 * in the south-west, drifts north-east along the Galas valley over about ten
 * hours, peaks around hour 6 at ~60 mm/h in its core, and is followed by a
 * lighter trailing shower. Deterministic, so the demo always opens on the
 * same forecast. Replace with MET Malaysia nowcasts or GPM IMERG for a real
 * deployment; the file shape stays the same.
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const COLS = 16;
const ROWS = 14;
const HOURS = 24;
const ISSUED_AT = '2014-12-23T14:00:00+08:00';

const terrain = JSON.parse(
  await readFile(path.resolve('public/terrain/terrain.json'), 'utf8'),
);
const { aoi } = terrain;

// Small deterministic PRNG for texture inside the band.
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(20141223);

// Band track in AOI-normalised coordinates (0..1 west→east, 0..1 south→north):
// from over Gunung Stong to beyond the Galas–Lebir confluence at Kuala Krai.
const TRACK_START = { x: 0.12, y: 0.18 };
const TRACK_END = { x: 0.92, y: 0.88 };
const TRACK_HOURS = 10;

// Time envelopes (mm/h at the band core).
const mainCore = (h) => {
  if (h < 0 || h > 11) return 0;
  // Already raining at "now" (hour 0); builds to the peak at hour 6.
  const rise = Math.min(1, (h + 2) / 8);
  const fall = h <= 6 ? 1 : Math.max(0, 1 - (h - 6) / 5); // gone by hour 11
  return 60 * rise * fall;
};
const trailCore = (h) => {
  // Lighter shower following the same track two hours behind, hours 5–17.
  if (h < 5 || h > 17) return 0;
  const t = (h - 5) / 12;
  return 14 * Math.sin(Math.PI * t);
};
const drizzle = (h) => (h >= 14 ? 2.5 * Math.max(0, 1 - (h - 14) / 10) : 0);

// Elliptical Gaussian band: long axis across the valley (NW–SE), moving NE.
const bandAt = (x, y, centre, along, across) => {
  const dx = x - centre.x;
  const dy = y - centre.y;
  const ux = (TRACK_END.x - TRACK_START.x);
  const uy = (TRACK_END.y - TRACK_START.y);
  const norm = Math.hypot(ux, uy);
  const ax = ux / norm;
  const ay = uy / norm;
  const a = dx * ax + dy * ay; // distance along the track
  const b = -dx * ay + dy * ax; // distance across the track
  return Math.exp(-(a * a) / (2 * along * along) - (b * b) / (2 * across * across));
};

const rain = [];
const catchmentMeanMmPerHour = [];
// Per-cell texture so the band is not a perfect ellipse.
const texture = Array.from({ length: COLS * ROWS }, () => 0.8 + random() * 0.4);

for (let h = 0; h < HOURS; h += 1) {
  const cells = Array.from({ length: COLS * ROWS }, () => 0);
  const progress = Math.min(1, h / TRACK_HOURS);
  const centre = {
    x: TRACK_START.x + (TRACK_END.x - TRACK_START.x) * progress,
    y: TRACK_START.y + (TRACK_END.y - TRACK_START.y) * progress,
  };
  const trailProgress = Math.min(1, Math.max(0, (h - 2) / TRACK_HOURS));
  const trailCentre = {
    x: TRACK_START.x + (TRACK_END.x - TRACK_START.x) * trailProgress,
    y: TRACK_START.y + (TRACK_END.y - TRACK_START.y) * trailProgress,
  };
  let sum = 0;
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const x = (col + 0.5) / COLS;
      const y = 1 - (row + 0.5) / ROWS; // row 0 is the north edge
      const value =
        mainCore(h) * bandAt(x, y, centre, 0.16, 0.34) +
        trailCore(h) * bandAt(x, y, trailCentre, 0.22, 0.4) +
        drizzle(h);
      const mm = Math.round(value * texture[row * COLS + col] * 10) / 10;
      cells[row * COLS + col] = mm;
      sum += mm;
    }
  }
  rain.push(cells);
  catchmentMeanMmPerHour.push(Math.round((sum / (COLS * ROWS)) * 10) / 10);
}

const forecast = {
  source: 'Design storm (synthetic, for demonstration): a convective band forming over Gunung Stong and drifting north-east along the Galas valley, peaking at hour 6',
  terms: 'synthetic — not a forecast; the three dated feeds behind the same chip are real',
  mode: 'scenario',
  issuedAt: ISSUED_AT,
  station: 'Kuala Krai, Sungai Kelantan',
  aoi,
  grid: { cols: COLS, rows: ROWS },
  hours: HOURS,
  units: { rain: 'mm/h', order: 'row-major, north row first' },
  catchmentMeanMmPerHour,
  spatial: 'drawn on the 16x14 tile grid; the catchment mean is the tile mean, not a basin mean',
  gauge: {
    reading: null,
    station: 'Kuala Krai (Sungai Kelantan), danger level 25.0 m',
    note: 'the demo opens at 27.0 m, two metres above danger level',
  },
  rain,
};

await writeFile(
  path.resolve('public/forecast.json'),
  JSON.stringify(forecast),
);
console.log(
  '[forecast] wrote public/forecast.json',
  `${HOURS} h × ${COLS}×${ROWS} cells;`,
  'catchment mean peak',
  Math.max(...catchmentMeanMmPerHour),
  'mm/h at hour',
  catchmentMeanMmPerHour.indexOf(Math.max(...catchmentMeanMmPerHour)),
);
