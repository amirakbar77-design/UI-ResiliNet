/**
 * The Kuala Krai gauge and the one mapping from its reading to the scene's
 * flood level. Shared by the dashboard, the hindcast and the method panel so
 * the number on screen and the number in the model are the same constant.
 */

/** JPS danger level at Kuala Krai (Sungai Kelantan), metres. */
export const GAUGE_DANGER = 25;
/** The December 2014 record at the same gauge, metres. */
export const GAUGE_RECORD_2014 = 34.2;
/** Lowest and highest flood levels the scene can show, in HAND metres. */
const LEVEL_MIN = 0.5;
const LEVEL_MAX = 14;

/**
 * Illustrative mapping from the gauge reading to the scene's HAND threshold:
 * every metre above danger level is taken as a metre of water above the
 * drainage datum across the valley. A real deployment would replace this
 * with a rating curve per reach.
 */
export const gaugeToHandLevel = (gauge: number) =>
  Math.min(LEVEL_MAX, Math.max(LEVEL_MIN, gauge - GAUGE_DANGER));
