/**
 * Hourly rain over the terrain AOI and the river-level curve derived from
 * it. Four inputs share this shape and run through the same model:
 *
 *   scenario      public/forecast.json       a synthetic design storm for the demo (scripts/make-forecast.mjs); the default
 *   live          public/forecast-live.json  WeatherNext 3 statistics, newest init (scripts/fetch-weathernext.py)
 *   replay-2024   public/forecast-2024.json  WeatherNext 2 archive, issue 27 Nov 2024 00Z (scripts/fetch-replay.py)
 *   hindcast-2014 public/forecast-2014.json  ERA5-Land reanalysis, 22 Dec 2014 06Z + 72 h (scripts/fetch-replay.py)
 *
 * The scenario is labelled as such everywhere; the three dated feeds are
 * real. The river model is deliberately simple and transparent so every
 * number on screen can be traced back to it.
 */

// Self-contained on purpose: scripts/check-forecast.mjs imports this module
// straight into Node, where bundler-style extensionless imports do not resolve.
const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

// --- Model constants (illustrative) ------------------------------------------
/** Level the river settles back to with no rain, in HAND metres. Real: the station's normal level via its rating curve. */
export const BASE_LEVEL = 0.5;
/** Lowest and highest levels the scene can show; matches the baked HAND range. */
export const MIN_LEVEL = 0.5;
export const MAX_LEVEL = 14;
/** Metres of stage rise per mm/h of catchment-mean rain over one hour. Real: unit hydrograph × rating curve for the reach. */
export const RUNOFF_COEF = 0.11;
/** Fraction of the excess stage (above BASE_LEVEL) that drains each hour. Real: recession constant fitted to past hydrographs. */
export const RECESSION = 0.12;
/** Hours for rain over the catchment to reach the gauge. Real: time of concentration for the basin. */
export const LAG_HOURS = 2;

/**
 * The three constants that answer to the station rather than to the app.
 * Each valley carries its own in `lib/maps.ts`; the defaults here are the
 * Kuala Krai ones, which is what the Node check scripts run against.
 */
export type RiverModel = {
  runoffCoef: number;
  recession: number;
  lagHours: number;
  baseLevel: number;
};
export const DEFAULT_RIVER: RiverModel = {
  runoffCoef: RUNOFF_COEF,
  recession: RECESSION,
  lagHours: LAG_HOURS,
  baseLevel: BASE_LEVEL,
};

export type ForecastMode = 'scenario' | 'live' | 'replay-2024' | 'hindcast-2014';
export const FORECAST_MODES: ForecastMode[] = ['scenario', 'live', 'replay-2024', 'hindcast-2014'];
export const FORECAST_FILES: Record<ForecastMode, string> = {
  scenario: '/forecast.json',
  live: '/forecast-live.json',
  'replay-2024': '/forecast-2024.json',
  'hindcast-2014': '/forecast-2014.json',
};
/** Modes whose hour 0 is the wall clock; the replays pin "now" to their issue time. */
export const wallClockMode = (mode: ForecastMode) => mode === 'scenario' || mode === 'live';

export type Forecast = {
  source: string;
  terms?: string;
  mode?: ForecastMode;
  /** Model init (live) or issue/start time (replays), ISO. */
  issuedAt: string;
  /** Valid time of hour 0, ISO. Live files start at the init's first lead. */
  validFrom?: string;
  station: string;
  aoi: { west: number; east: number; south: number; north: number };
  grid: { cols: number; rows: number };
  hours: number;
  units?: { rain: string; order: string };
  /** The basin the catchment mean is taken over. */
  basin?: { name: string; areaKm2: number | null; source: string };
  /** Catchment-mean rain per hour, mm/h (ensemble mean where there is an ensemble). */
  catchmentMeanMmPerHour: number[];
  /** Ensemble spread of the catchment mean, when the source has one. */
  catchmentMeanQuantiles?: { p10: number[]; p50: number[]; p90: number[] };
  band?: string;
  spatial?: string;
  /** The gauge reading at hour 0, when one was found for the event. */
  gauge?: { reading: number | null; station?: string; at?: string; note?: string };
  /** rain[hour][row * cols + col], mm/h, row-major with the north row first. */
  rain: number[][];
};

export type FloodCurve = {
  /** Predicted HAND level per forecast hour, metres; index 0 is "now". */
  levels: number[];
  /** Level at a fractional hour, linearly interpolated. */
  levelAt: (hour: number) => number;
  /** First hour at which the highest level occurs. */
  peakHour: () => number;
  peakLevel: () => number;
};

/** The river curve run on the ensemble's p10, p50 and p90 rain. */
export type FloodBand = { p10: FloodCurve; p50: FloodCurve; p90: FloodCurve };

export async function loadForecast(
  mode: ForecastMode = 'live',
  files: Partial<Record<ForecastMode, string>> = FORECAST_FILES,
): Promise<Forecast> {
  const url = files[mode] ?? FORECAST_FILES[mode];
  const response = await fetch(url);
  if (response.ok) return (await response.json()) as Forecast;
  const scenario = files.scenario ?? FORECAST_FILES.scenario;
  if (mode === 'live' || url !== scenario) {
    // Without the requested file the demo still opens, on this map's scenario.
    const fallback = await fetch(scenario);
    if (fallback.ok) return (await fallback.json()) as Forecast;
  }
  throw new Error(`Failed to load forecast (${mode}): ${response.status}`);
}

/**
 * A live file starts at the init's first lead, which is already in the past
 * by the time it is read. Drop the hours behind `nowMs` so index 0 is "now".
 * Replays are read at their issue time, so nothing moves.
 */
export function alignToNow(forecast: Forecast, nowMs: number): Forecast {
  if (!forecast.validFrom) return forecast;
  const offset = Math.floor((nowMs - Date.parse(forecast.validFrom)) / 3_600_000);
  if (offset <= 0) return forecast;
  const hours = forecast.hours - offset;
  // Too stale to trim: show it as issued rather than an empty chart.
  if (hours < 6) return forecast;
  const cut = (series: number[]) => series.slice(offset);
  const q = forecast.catchmentMeanQuantiles;
  return {
    ...forecast,
    hours,
    validFrom: new Date(Date.parse(forecast.validFrom) + offset * 3_600_000).toISOString(),
    catchmentMeanMmPerHour: cut(forecast.catchmentMeanMmPerHour),
    catchmentMeanQuantiles: q ? { p10: cut(q.p10), p50: cut(q.p50), p90: cut(q.p90) } : undefined,
    rain: forecast.rain.slice(offset),
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const utcDay = (at: Date) => `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]}`;

/** Short label for the mode chip: "Scenario · design storm", "Live · WeatherNext 3, init 18 Sep 06Z". */
export function forecastLabel(forecast: Forecast | null, mode: ForecastMode) {
  const at = forecast ? new Date(forecast.issuedAt) : null;
  if (mode === 'scenario') return 'Scenario · design storm';
  if (mode === 'live') {
    if (!forecast || forecast.mode !== 'live' || !at) return 'Live · no live file, showing the scenario';
    return `Live · WeatherNext 3, init ${utcDay(at)} ${String(at.getUTCHours()).padStart(2, '0')}Z`;
  }
  if (mode === 'replay-2024') return `Replay · ${at ? `${utcDay(at)} ${at.getUTCFullYear()}` : '27 Nov 2024'}`;
  return `Hindcast · ${at ? `${utcDay(at)} ${at.getUTCFullYear()}` : '22 Dec 2014'}`;
}

/** Rain intensity at a point and (fractional) hour: bilinear in space, linear in time. */
export function rainAt(
  forecast: Forecast,
  hour: number,
  lon: number,
  lat: number,
): number {
  const { aoi, grid, rain } = forecast;
  if (hour < 0 || hour > forecast.hours - 1) return 0;
  // Cell-centre coordinates; clamp so edge cells extend to the AOI border.
  const fx = clamp(
    ((lon - aoi.west) / (aoi.east - aoi.west)) * grid.cols - 0.5,
    0,
    grid.cols - 1,
  );
  const fy = clamp(
    ((aoi.north - lat) / (aoi.north - aoi.south)) * grid.rows - 0.5,
    0,
    grid.rows - 1,
  );
  const c0 = Math.floor(fx);
  const r0 = Math.floor(fy);
  const c1 = Math.min(c0 + 1, grid.cols - 1);
  const r1 = Math.min(r0 + 1, grid.rows - 1);
  const tx = fx - c0;
  const ty = fy - r0;

  const sample = (cells: number[]) => {
    const a = cells[r0 * grid.cols + c0] ?? 0;
    const b = cells[r0 * grid.cols + c1] ?? 0;
    const c = cells[r1 * grid.cols + c0] ?? 0;
    const d = cells[r1 * grid.cols + c1] ?? 0;
    return (
      a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty
    );
  };

  const h0 = Math.floor(hour);
  const h1 = Math.min(h0 + 1, forecast.hours - 1);
  const th = hour - h0;
  return sample(rain[h0]!) * (1 - th) + sample(rain[h1]!) * th;
}

/**
 * Leaky-store river model: each hour the level rises with the catchment-mean
 * rain that fell LAG_HOURS earlier and drains in proportion to how far it
 * sits above BASE_LEVEL. Starts from the observed level at hour 0.
 */
function curveFrom(
  mean: number[],
  hours: number,
  observedLevelMetres: number,
  river: RiverModel = DEFAULT_RIVER,
): FloodCurve {
  const levels: number[] = [clamp(observedLevelMetres, MIN_LEVEL, MAX_LEVEL)];
  for (let h = 1; h < hours; h += 1) {
    const previous = levels[h - 1]!;
    // Rain before "now" is taken to match hour 0, so the lag does not open
    // with an artificial dip.
    const inflow = mean[Math.max(0, h - river.lagHours)] ?? 0;
    const next =
      previous + river.runoffCoef * inflow - river.recession * (previous - river.baseLevel);
    levels.push(clamp(next, MIN_LEVEL, MAX_LEVEL));
  }

  const levelAt = (hour: number) => {
    const t = clamp(hour, 0, levels.length - 1);
    const h0 = Math.floor(t);
    const h1 = Math.min(h0 + 1, levels.length - 1);
    return levels[h0]! + (levels[h1]! - levels[h0]!) * (t - h0);
  };
  const peakHour = () => {
    let best = 0;
    for (let h = 1; h < levels.length; h += 1) {
      if (levels[h]! > levels[best]!) best = h;
    }
    return best;
  };

  return {
    levels,
    levelAt,
    peakHour,
    peakLevel: () => levels[peakHour()]!,
  };
}

/** The river curve on the catchment mean (the ensemble mean where there is one). */
export function floodCurve(
  forecast: Forecast,
  observedLevelMetres: number,
  river: RiverModel = DEFAULT_RIVER,
): FloodCurve {
  return curveFrom(
    forecast.catchmentMeanMmPerHour,
    forecast.hours,
    observedLevelMetres,
    river,
  );
}

/**
 * The same model run on the ensemble's p10, p50 and p90 rain, or null when
 * the source has no spread (a reanalysis). The app plans on p50 and draws
 * p10–p90 as the band.
 */
export function floodBand(
  forecast: Forecast,
  observedLevelMetres: number,
  river: RiverModel = DEFAULT_RIVER,
): FloodBand | null {
  const q = forecast.catchmentMeanQuantiles;
  if (!q) return null;
  return {
    p10: curveFrom(q.p10, forecast.hours, observedLevelMetres, river),
    p50: curveFrom(q.p50, forecast.hours, observedLevelMetres, river),
    p90: curveFrom(q.p90, forecast.hours, observedLevelMetres, river),
  };
}
