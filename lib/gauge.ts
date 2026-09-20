/**
 * The mapping from a river gauge reading to the scene's flood level. Shared by
 * the dashboard, the hindcast and the method panel so the number on screen and
 * the number in the model are the same arithmetic.
 *
 * Each valley brings its own station, danger level and slope — see the
 * `gauge` block of its entry in `lib/maps.ts`.
 */

import type { GaugeSpec } from './maps.ts';

/** Lowest and highest flood levels the scene can show, in HAND metres. */
export const LEVEL_MIN = 0.5;
export const LEVEL_MAX = 14;

/**
 * Illustrative mapping from a gauge reading to the scene's HAND threshold:
 * each metre above the station's danger level becomes `metresPerGaugeMetre`
 * metres of water above the drainage datum. A real deployment would replace
 * it with a rating curve per reach.
 */
export const gaugeToHandLevel = (gauge: number, spec: GaugeSpec) =>
  Math.min(
    LEVEL_MAX,
    Math.max(LEVEL_MIN, (gauge - spec.danger) * spec.metresPerGaugeMetre),
  );

/** The inverse, for printing "the model floods this at a gauge of X m". */
export const handLevelToGauge = (level: number, spec: GaugeSpec) =>
  spec.danger + level / spec.metresPerGaugeMetre;
