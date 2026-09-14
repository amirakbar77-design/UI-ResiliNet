/**
 * Prints the existing-network failure table for a gauge reading, so the
 * model can be sanity-checked without the UI:
 *
 *   node scripts/check-network.mjs [gaugeMetres]   (default 27.0)
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { floodCurve } from '../lib/forecast.ts';
import { assessNetwork, BATTERY_HOURS, GENSET_HOURS } from '../lib/network.ts';

const gauge = Number(process.argv[2] ?? 27);
const level = Math.min(14, Math.max(0.5, gauge - 25));
const meta = JSON.parse(await readFile(path.resolve('public/terrain/terrain.json'), 'utf8'));
const graph = JSON.parse(await readFile(path.resolve('public/terrain', meta.roads.file), 'utf8'));
const forecast = JSON.parse(await readFile(path.resolve('public/forecast.json'), 'utf8'));
const curve = floodCurve(forecast, level);
const terrain = { meta, graph };

const { sites, summary, darkAt } = assessNetwork(terrain, curve);
console.log(
  `gauge ${gauge.toFixed(1)} m (HAND ${level.toFixed(1)} m) · peak ${curve.peakLevel().toFixed(1)} m at +${curve.peakHour()} h · battery ${BATTERY_HOURS} h, genset +${GENSET_HOURS} h`,
);
console.log('now: ' + summary.total + ' sites · ' + summary.up + ' up · ' + summary.battery + ' on battery · ' + summary.down + ' down');
console.log('id       name                    src   hand   status   access cut   flooded   fails at   cause       backhaul');
for (const s of sites) {
  const c = s.site;
  console.log(
    [
      s.id.padEnd(8),
      c.name.slice(0, 23).padEnd(23),
      c.source.slice(0, 5).padEnd(5),
      String(c.handDm / 10).padStart(5) + ' m',
      s.status.padEnd(8),
      (s.accessCutHour === null ? '—' : `+${s.accessCutHour} h`).padStart(10),
      (s.inundationHour === null ? '—' : `+${s.inundationHour} h`).padStart(9),
      (s.failureHour === null ? 'survives' : `+${s.failureHour} h`).padStart(10),
      (s.failureCause ?? '—').padEnd(11),
      c.backhaul.kind + (c.backhaul.parent ? ' → ' + c.backhaul.parent : ' (hub)'),
    ].join('  '),
  );
}
for (const h of [0, 3, 6, 9, 12, 18, 23]) console.log(`by +${String(h).padStart(2)} h: ${darkAt(h)} of ${summary.total} dark`);
