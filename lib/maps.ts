/**
 * The valleys the dashboard can open, and the per-place constants the model
 * needs for each: where its baked assets live, which gauge drives the flood,
 * and which rain inputs have files.
 *
 * Everything else — routing, viewshed, network, recommendation, population —
 * reads only from the baked `TerrainData`, so adding a valley here plus a
 * `npm run bake:terrain -- <id>` is the whole job.
 */

import type { ForecastMode } from './forecast.ts';

export type MapId = 'kelantan' | 'padas';

export type GaugeSpec = {
  /** Station as JPS/DID names it, for the label above the input. */
  station: string;
  /** JPS danger level on the station datum, metres. */
  danger: number;
  /** Where the Now stage opens, metres. */
  initial: number;
  /**
   * The highest reading we could source for this station, and how solid it is.
   * `record: true` means it is reported as the station record; `false` means it
   * is only the highest reading found, which the UI says in as many words.
   */
  peak: { metres: number; label: string; record: boolean };
  /** Range and step of the reading input, metres on the station datum. */
  min: number;
  max: number;
  step: number;
  /**
   * Metres of water above the drainage datum per metre of gauge above danger
   * level: the slope of a straight-line stand-in for the station's rating
   * curve. It is not 1 everywhere. A gauge in a narrow valley channel climbs
   * nearly as fast as the water deepens, but one in a wide flat channel rises
   * slowly while the water spreads for kilometres, so the same metre of stage
   * means far more inundation. A real deployment replaces the whole mapping
   * with a rating curve per reach.
   */
  metresPerGaugeMetre: number;
  /**
   * Metres of stage rise per mm/h of catchment-mean rain over one hour — the
   * slope of the river model in `lib/forecast`. Per station, because the same
   * rain moves a small steep basin much further than a large slow one. Real:
   * a unit hydrograph and rating curve fitted to past events.
   */
  runoffCoef: number;
  /** Hours from rain over the catchment to a response at the gauge. */
  lagHours: number;
};

export type MapSpec = {
  id: MapId;
  /** The full place line, for the chip and the footer. */
  label: string;
  /** Two or three words, for the dropdown row. */
  short: string;
  /** The river and state, under the short name in the dropdown. */
  sublabel: string;
  /** Where `loadTerrain` reads the baked assets from. */
  assetBase: string;
  /** Spoken description of the 3D scene, for the map region's aria-label. */
  sceneLabel: string;
  gauge: GaugeSpec;
  /** Rain inputs this map has files for; the first is the default. */
  forecastModes: ForecastMode[];
  forecastFiles: Partial<Record<ForecastMode, string>>;
  /**
   * Whether `lib/hindcast` has checked facts for this place. Only Kelantan
   * does; Padas shows no hindcast rather than an unchecked one.
   */
  hindcast: boolean;
  /**
   * Area of the HydroBASINS catchment traced upstream from the gauge, km².
   * null where no trace has been run, in which case the catchment mean is a
   * tile mean and the method sheet says so instead of citing HydroSHEDS.
   */
  basinKm2: number | null;
};

export const MAPS: Record<MapId, MapSpec> = {
  kelantan: {
    id: 'kelantan',
    label: 'Dabong – Kuala Krai, Sungai Galas valley, Kelantan, Malaysia',
    short: 'Dabong – Kuala Krai',
    sublabel: 'Sungai Galas · Kelantan',
    assetBase: '/terrain',
    sceneLabel:
      'Interactive 3D terrain model of the Sungai Galas valley, Dabong to Kuala Krai',
    gauge: {
      station: 'Kuala Krai gauge',
      danger: 25,
      initial: 27,
      peak: { metres: 34.2, label: 'Record 2014', record: true },
      min: 20,
      max: 34,
      step: 0.1,
      // A confined valley: the 2014 record stood 9.2 m over danger level and
      // put water on a school's third floor, so a metre at the gauge is about
      // a metre of depth over the floodplain.
      metresPerGaugeMetre: 1,
      runoffCoef: 0.11,
      lagHours: 2,
    },
    forecastModes: ['scenario', 'live', 'replay-2024', 'hindcast-2014'],
    forecastFiles: {
      scenario: '/forecast.json',
      live: '/forecast-live.json',
      'replay-2024': '/forecast-2024.json',
      'hindcast-2014': '/forecast-2014.json',
    },
    hindcast: true,
    basinKm2: 11502,
  },
  padas: {
    id: 'padas',
    label: 'Beaufort & the Padas gorge, Sungai Padas, Sabah, Malaysia',
    short: 'Beaufort & the gorge',
    sublabel: 'Sungai Padas · Sabah',
    assetBase: '/terrain-padas',
    sceneLabel:
      'Interactive 3D terrain model of the Sungai Padas, the Crocker Range gorge down to the Beaufort floodplain',
    gauge: {
      station: 'Beaufort gauge',
      danger: 8.7,
      initial: 9.4,
      // 9.68 m is the highest reading we could source, not a stated record:
      // Beaufort crosses its danger level most years and the reports quote
      // the crossing, not the series. Flagged as such wherever it is shown.
      peak: { metres: 9.68, label: 'Highest found', record: false },
      // The scale runs past the highest sourced reading on purpose: planning
      // for worse than the last flood is the job. Finer step, because this
      // station's whole band above danger is about a metre wide.
      min: 7.5,
      max: 11.5,
      step: 0.05,
      // Anchored to reported impact, not to a rating curve we have: Beaufort's
      // whole sourced band above danger is about a metre, yet at 9.4–9.9 m the
      // reports describe dozens of villages flooded, thousands displaced and a
      // declared disaster zone. At 1:1 the model would call that a nuisance, so
      // the slope is set so the highest sourced reading (9.68 m) produces a
      // flood of that severity. Illustrative, and the method sheet says so.
      metresPerGaugeMetre: 2.9,
      // Scaled to this station's band: the Padas at Beaufort moves through
      // roughly a metre at the gauge where the Kelantan moves through nine, so
      // the same rain must buy proportionally less stage or a storm walks the
      // gauge straight off its own scale. Illustrative — there is no basin
      // trace and no rating curve for the Padas here yet.
      runoffCoef: 0.045,
      // A much smaller, steeper catchment than the Kelantan's 11,502 km²:
      // rain over the Crocker Range reaches Beaufort sooner.
      lagHours: 1,
    },
    // No basin trace and no Earth Engine run for the Padas yet, so the three
    // dated feeds have no file here. The chip shows only what exists.
    forecastModes: ['scenario'],
    forecastFiles: { scenario: '/forecast-padas.json' },
    hindcast: false,
    basinKm2: null,
  },
};

export const MAP_IDS = Object.keys(MAPS) as MapId[];
export const DEFAULT_MAP: MapId = 'kelantan';

export const isMapId = (value: string): value is MapId =>
  Object.hasOwn(MAPS, value);
