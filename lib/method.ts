/**
 * The method panel's content, built from the constants the model actually
 * uses, so the panel cannot drift from the code. Three short tables and a
 * line about seeds: what is real, what is derived, what is assumed.
 */

import { BASE_LEVEL, type Forecast, LAG_HOURS, RECESSION, RUNOFF_COEF } from './forecast.ts';
import { GAUGE_DANGER } from './gauge.ts';
import { BATTERY_HOURS, FUEL_RUN_KM, GENSET_HOURS, SITE_COVERAGE_RADIUS_METRES } from './network.ts';
import { CONVOY_KMH } from './recommend.ts';
import { BRIDGE_DECK_HAND_DM, CUT_RUN_METRES, EMBANKMENT_HAND_DM } from './routing.ts';
import { BACKHAUL_CLEARANCE_METRES, BACKHAUL_RANGE_METRES, PORTABLE_MAST_METRES } from './sites.ts';
import type { TerrainMeta } from './terrain-field.ts';
import { VIEWSHED_RINGS, VIEWSHED_SPOKES } from './viewshed.ts';

/** [name, what, licence-or-source] */
export type MethodRow = [string, string, string];

export type MethodSections = {
  real: MethodRow[];
  synthetic: MethodRow[];
  derived: MethodRow[];
  assumptions: MethodRow[];
  seeds: string;
};

const km = (metres: number) => `${(metres / 1000).toFixed(metres % 1000 === 0 ? 0 : 1)} km`;

export function methodSections(meta: TerrainMeta | null, live: Forecast | null): MethodSections {
  const rules = meta?.rules;
  const masts = [...new Set((meta?.sites ?? []).map((s) => s.mastMetres))].sort((a, b) => a - b);
  const seeds = (meta?.sites ?? []).filter((s) => s.source === 'seed');
  const liveInit = live?.mode === 'live' ? live.issuedAt.slice(0, 16).replace('T', ' ') + 'Z' : 'newest 6-hourly init at fetch';

  const real: MethodRow[] = [
    ['NASA SRTM', 'elevation, 30 m', 'public domain · 2000'],
    ['Sentinel-2 cloudless (EOX)', 'the ground texture', 'CC BY 4.0 · 2020'],
    ['OpenStreetMap', 'roads, rail, bridges, buildings, places, petrol stations, one mast', 'ODbL · at bake'],
    ['WorldPop', 'people per 100 m cell; every count in the app', 'CC BY 4.0 · 2020'],
    ['OpenCellID', `cell samples, clustered into the ${meta?.sites.length ?? 12} existing sites`, 'CC BY-SA 4.0 · at bake'],
    ['WeatherNext 3 (Live)', 'hourly basin rain, ensemble mean and p10–p90', `GDM experimental terms · ${liveInit}`],
    ['WeatherNext 2 archive (Replay)', '6-hourly basin rain, issue 27 Nov 2024 00Z, five-issue band', 'CC BY 4.0 · 2024'],
    ['ERA5-Land (Hindcast)', 'hourly basin rain from 22 Dec 2014 06Z', 'Copernicus C3S · 2014'],
    ['HydroBASINS level 9', 'the 11,502 km² basin above the gauge', 'HydroSHEDS · v1'],
  ];

  const synthetic: MethodRow[] = [
    ['Scenario · design storm', 'a drawn convective band, peaking at hour 6; the default rain', 'not data — labelled on the chip'],
  ];

  const derived: MethodRow[] = [
    ['HAND', 'height above the nearest drainage cell: priority-flood fill and D8 flow on SRTM', 'lib/terrain-field, bake'],
    ['Flood at a level', `every cell with HAND below the level; level = gauge − ${GAUGE_DANGER} m`, 'lib/gauge'],
    ['Road cut', `${CUT_RUN_METRES} m of a road continuously under water, after bridge and embankment allowances`, 'lib/routing'],
    ['Route wave', 'Dijkstra from the Kuala Krai depot over roads not cut; closing hours read off the forecast', 'lib/routing'],
    ['Viewshed', `line of sight from the mast over SRTM, ${VIEWSHED_SPOKES} spokes × ${VIEWSHED_RINGS} rings to ${km(SITE_COVERAGE_RADIUS_METRES)}`, 'lib/viewshed'],
    ['River level', 'leaky store: rises with lagged basin rain, drains toward base level', 'lib/forecast'],
    ['Site failure', 'earliest of inundation, power (battery after the fuel road closes) and backhaul (parent dark)', 'lib/network'],
    ['Coverage hole', 'people with signal now that no surviving site covers at the planned hour', 'lib/network'],
    ['Plan', 'local top-ups assumed; the convoy and the portable tower ranked over the residual hole', 'lib/recommend'],
  ];

  const emb = EMBANKMENT_HAND_DM;
  const assumptions: MethodRow[] = [
    ['Gauge → flood level', `1 m above the ${GAUGE_DANGER} m danger level = 1 m of water above the drainage datum`, 'JPS rating curve per reach'],
    ['Runoff', `${RUNOFF_COEF} m of stage per mm/h of basin rain`, 'unit hydrograph × rating curve'],
    ['Recession', `${RECESSION} of the excess stage drains each hour`, 'fitted to past hydrographs'],
    ['Lag', `${LAG_HOURS} h from rain to gauge`, 'time of concentration'],
    ['Base level', `${BASE_LEVEL} m`, "the station's normal level"],
    ['Bridge deck', `+${BRIDGE_DECK_HAND_DM / 10} m above the channel`, 'bridge survey'],
    ['Embankment', `trunk/primary +${(emb.trunk ?? 0) / 10} m, secondary +${(emb.secondary ?? 0) / 10} m, tertiary +${(emb.tertiary ?? 0) / 10} m`, 'LiDAR road heights'],
    ['Cut run', `${CUT_RUN_METRES} m under water`, 'road-closure records'],
    [
      'Portable-tower site',
      rules
        ? `slope ≤ ${rules.candidates.maxSlopeDeg}°, road ≤ ${rules.candidates.maxRoadMetres} m, HAND ≥ ${rules.candidates.minHandDm / 10} m`
        : 'bake rule (see scripts/bake-terrain.mjs)',
      'site survey',
    ],
    ['Battery', `${BATTERY_HOURS} h; a genset adds ${GENSET_HOURS} h`, 'operator site data'],
    ['Fuel run', `a town or petrol station within ${FUEL_RUN_KM} km by open road`, 'operator crews'],
    ['Convoy', `${CONVOY_KMH} km/h; roads open for the whole drive; on site before the battery dies`, 'fleet data'],
    ['Backhaul', `microwave line of sight ≤ ${km(BACKHAUL_RANGE_METRES)}, ${BACKHAUL_CLEARANCE_METRES} m clearance`, 'operator topology'],
    ['Coverage', `${km(SITE_COVERAGE_RADIUS_METRES)} line of sight; masts ${masts.length ? masts.join('/') : 45} m (sites), ${PORTABLE_MAST_METRES} m (portable)`, 'operator RF planning'],
    [
      'Existing sites',
      rules
        ? `OpenCellID cells within ${km(rules.sites.clusterMetres)} are one site, ≥ ${rules.sites.minCells} cells or ${rules.sites.minOperators} operators, ≥ ${km(rules.sites.minSpacingMetres)} apart, at most ${rules.sites.maxCount}, snapped ≤ ${rules.sites.snapMetres} m to dry ground`
        : 'bake rule (see scripts/bake-terrain.mjs)',
      'operator site list',
    ],
  ];

  return {
    real,
    synthetic,
    derived,
    assumptions,
    seeds:
      seeds.length === 0
        ? `None in this bake: all ${meta?.sites.length ?? 12} sites come from OpenCellID and OpenStreetMap. Hand-placed seeds, flagged "seed", are added only where the map is empty.`
        : `${seeds.length} hand-placed: ${seeds.map((s) => s.name).join(', ')} — flagged "seed" on the map; placeholders, not infrastructure.`,
  };
}
