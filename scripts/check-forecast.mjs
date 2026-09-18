/**
 * Prints a forecast file and the modelled river level so the curve can be
 * sanity-checked without the UI:
 *
 *   node scripts/check-forecast.mjs [live|replay-2024|hindcast-2014|path] [observedLevelMetres]
 *
 * Defaults to the live file and an observed level of 2.0 m (gauge 27.0 m).
 * When the file carries ensemble quantiles the p10/p50/p90 curves are printed
 * beside the mean.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { FORECAST_FILES, floodBand, floodCurve } from '../lib/forecast.ts';

const which = process.argv[2] ?? 'live';
const observed = Number(process.argv[3] ?? 2.0);
const file = which in FORECAST_FILES ? `public${FORECAST_FILES[which]}` : which;
const forecast = JSON.parse(await readFile(path.resolve(file), 'utf8'));
const curve = floodCurve(forecast, observed);
const band = floodBand(forecast, observed);

console.log(`${file} · ${forecast.source}`);
if (forecast.basin) console.log(`basin: ${forecast.basin.name} · ${forecast.basin.areaKm2} km² · ${forecast.basin.source}`);
if (forecast.band) console.log(`band: ${forecast.band}`);
console.log(`issued ${forecast.issuedAt} · hour 0 valid ${forecast.validFrom ?? forecast.issuedAt} · ${forecast.hours} h · observed level ${observed.toFixed(1)} m`);
console.log(band ? 'hour  mean mm/h    p10   p50   p90 | level mean   p10   p50   p90' : 'hour  rain mm/h  level m');
const total = { mean: 0, p90: 0 };
for (let h = 0; h < forecast.hours; h += 1) {
  const rain = forecast.catchmentMeanMmPerHour[h];
  total.mean += rain;
  const level = curve.levels[h];
  if (band) {
    const q = forecast.catchmentMeanQuantiles;
    total.p90 += q.p90[h];
    console.log(
      `${String(h).padStart(3)}   ${rain.toFixed(2).padStart(8)}  ${q.p10[h].toFixed(2).padStart(5)} ${q.p50[h].toFixed(2).padStart(5)} ${q.p90[h].toFixed(2).padStart(5)} |  ${level.toFixed(2).padStart(8)} ${band.p10.levels[h].toFixed(2).padStart(5)} ${band.p50.levels[h].toFixed(2).padStart(5)} ${band.p90.levels[h].toFixed(2).padStart(5)}  ${'█'.repeat(Math.round(band.p50.levels[h] * 2))}`,
    );
  } else {
    console.log(`${String(h).padStart(3)}   ${rain.toFixed(2).padStart(7)}   ${level.toFixed(2).padStart(6)}  ${'█'.repeat(Math.round(level * 2))}`);
  }
}
console.log(`total rain ${total.mean.toFixed(1)} mm (mean)${band ? ` · ${total.p90.toFixed(1)} mm (p90)` : ''}`);
console.log(`peak level ${curve.peakLevel().toFixed(2)} m at hour ${curve.peakHour()} (mean)${band ? ` · p50 ${band.p50.peakLevel().toFixed(2)} m at +${band.p50.peakHour()} h · p10–p90 ${band.p10.peakLevel().toFixed(2)}–${band.p90.peakLevel().toFixed(2)} m` : ''}`);
if (forecast.gauge) console.log(`gauge at hour 0: ${forecast.gauge.reading ?? 'reading not found'}${forecast.gauge.note ? ` — ${forecast.gauge.note}` : ''}`);
