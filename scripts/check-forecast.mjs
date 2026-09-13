/**
 * Prints the forecast and the modelled river level so the curve can be
 * sanity-checked without the UI:
 *
 *   node scripts/check-forecast.mjs [observedLevelMetres]
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { floodCurve } from '../lib/forecast.ts';

const observed = Number(process.argv[2] ?? 2.4);
const forecast = JSON.parse(
  await readFile(path.resolve('public/forecast.json'), 'utf8'),
);
const curve = floodCurve(forecast, observed);

console.log(`observed level ${observed.toFixed(1)} m · ${forecast.source}`);
console.log('hour  rain mm/h  level m');
for (let h = 0; h < forecast.hours; h += 1) {
  const rain = forecast.catchmentMeanMmPerHour[h];
  const level = curve.levels[h];
  const bar = '█'.repeat(Math.round(level * 2));
  console.log(
    `${String(h).padStart(3)}   ${rain.toFixed(1).padStart(7)}   ${level.toFixed(2).padStart(6)}  ${bar}`,
  );
}
console.log(
  `peak level ${curve.peakLevel().toFixed(2)} m at hour ${curve.peakHour()}`,
);
