/**
 * Hourly rain forecast over the terrain AOI and the river-level curve
 * derived from it. The data in `public/forecast.json` is illustrative (see
 * `scripts/make-forecast.mjs`); the model here is deliberately simple and
 * transparent so every number on screen can be traced back to it.
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

export type Forecast = {
  source: string;
  issuedAt: string;
  station: string;
  aoi: { west: number; east: number; south: number; north: number };
  grid: { cols: number; rows: number };
  hours: number;
  units?: { rain: string; order: string };
  /** Catchment-mean rain per hour, mm/h. */
  catchmentMeanMmPerHour: number[];
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

export async function loadForecast(url = '/forecast.json'): Promise<Forecast> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load forecast: ${response.status}`);
  }
  return (await response.json()) as Forecast;
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
export function floodCurve(
  forecast: Forecast,
  observedLevelMetres: number,
): FloodCurve {
  const mean = forecast.catchmentMeanMmPerHour;
  const levels: number[] = [clamp(observedLevelMetres, MIN_LEVEL, MAX_LEVEL)];
  for (let h = 1; h < forecast.hours; h += 1) {
    const previous = levels[h - 1]!;
    // Rain before "now" is taken to match hour 0, so the lag does not open
    // with an artificial dip.
    const inflow = mean[Math.max(0, h - LAG_HOURS)] ?? 0;
    const next =
      previous + RUNOFF_COEF * inflow - RECESSION * (previous - BASE_LEVEL);
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
