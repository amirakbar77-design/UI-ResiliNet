/**
 * Compare the design-storm peak flood mask with the December 2014 hindcast
 * peak on the app's native HAND grid.
 *
 * Usage: node scripts/compare-design-hindcast.mjs
 */
import { readFile } from 'node:fs/promises';
import { floodCurve } from '../lib/forecast.ts';

const [terrainRaw, handBuffer, designRaw, hindcastRaw] = await Promise.all([
  readFile(new URL('../public/terrain/terrain.json', import.meta.url), 'utf8'),
  readFile(new URL('../public/terrain/hand.bin', import.meta.url)),
  readFile(new URL('../public/forecast.json', import.meta.url), 'utf8'),
  readFile(new URL('../public/forecast-2014.json', import.meta.url), 'utf8'),
]);

const terrain = JSON.parse(terrainRaw);
const design = JSON.parse(designRaw);
const hindcast = JSON.parse(hindcastRaw);
const hand = new Uint8Array(handBuffer.buffer, handBuffer.byteOffset, handBuffer.byteLength);

const DESIGN_START_HAND_M = 2.0; // app default gauge 27.0 m minus danger 25.0 m
const HINDCAST_PEAK_HAND_M = 9.2; // recorded gauge 34.2 m minus danger 25.0 m
const designCurve = floodCurve(design, DESIGN_START_HAND_M);
const hindcastCurve = floodCurve(hindcast, HINDCAST_PEAK_HAND_M);
const designPeak = designCurve.peakLevel();
const hindcastPeak = hindcastCurve.peakLevel();

let intersection = 0;
let designOnly = 0;
let hindcastOnly = 0;
let bothDry = 0;
let drainageCells = 0;

for (const value of hand) {
  if (value === 255) continue;
  drainageCells += 1;
  const height = value / 10;
  const designWet = height < designPeak;
  const hindcastWet = height < hindcastPeak;
  if (designWet && hindcastWet) intersection += 1;
  else if (designWet) designOnly += 1;
  else if (hindcastWet) hindcastOnly += 1;
  else bothDry += 1;
}

const designFlood = intersection + designOnly;
const hindcastFlood = intersection + hindcastOnly;
const union = intersection + designOnly + hindcastOnly;
const ratio = (n, d) => (d === 0 ? null : n / d);
const result = {
  comparison: 'Design-storm peak extent versus December 2014 hindcast peak extent',
  interpretation: 'model-to-model peak-extent agreement; not independent historical accuracy',
  grid: {
    width: terrain.grid.width,
    height: terrain.grid.height,
    drainageCells,
    rule: 'HAND value is valid and HAND/10 < peak level',
  },
  designScenario: {
    source: design.source,
    startingGaugeMetres: 27.0,
    startingHandMetres: DESIGN_START_HAND_M,
    peakHour: designCurve.peakHour(),
    peakHandMetres: designPeak,
    equivalentGaugeMetres: 25 + designPeak,
    floodedCells: designFlood,
  },
  hindcast2014: {
    source: hindcast.source,
    peakHour: hindcastCurve.peakHour(),
    peakHandMetres: hindcastPeak,
    gaugeMetres: 25 + hindcastPeak,
    floodedCells: hindcastFlood,
  },
  confusion: { intersection, designOnly, hindcastOnly, bothDry, union },
  metrics: {
    intersectionOverUnion: ratio(intersection, union),
    recallAgainstHindcast: ratio(intersection, hindcastFlood),
    precisionAgainstHindcast: ratio(intersection, designFlood),
    f1Dice: ratio(2 * intersection, 2 * intersection + designOnly + hindcastOnly),
    peakLevelRatio: ratio(designPeak, hindcastPeak),
    peakLevelBiasMetres: designPeak - hindcastPeak,
  },
};

console.log(JSON.stringify(result, null, 2));
