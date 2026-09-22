/* The landing loop, as pure functions of loop time.
   The terrain is illustrative; counters are a verified snapshot of the
   Kuala Krai model (27.0 m initial gauge, +14 h planning hour), and every piece of state it shows is derived here so it can be
   tested without a WebGL context: which beat is on screen, which act, what
   the counter reads, where the stage dial stands. */

export const LOOP_SECONDS = 34.5;
export const ACT_STARTS = [0, 6, 13, 21] as const;

export type Tone = "teal" | "red";

export interface Beat {
  t: number;
  eyebrow: string;
  tone: Tone;
  heading: string;
  sub: string;
}

/** Verified with node scripts/check-sites.mjs kelantan 27 in the full app.
 * Modelled coverage, not observed subscriber counts or confirmed restored calls.
 * Keep this snapshot self-contained so the simulation remains standalone. */
export const SCENARIO = {
  online: 80368, initialAtRisk: 36614, cutOff: 13811,
  routineSupport: 22803, generator: 7476, portableTower: 1128,
  additionalResponse: 8604, back: 8604, totalWithRoutineSupport: 31407, remaining: 5207,
} as const;

export const BEATS: Beat[] = [
  {
    t: 0,
    eyebrow: "The normal day",
    tone: "teal",
    heading: "Kuala Krai, connected.",
    sub: "The model starts with 80,368 people in covered areas across the Dabong–Kuala Krai valley.",
  },
  {
    t: 6,
    eyebrow: "The failure",
    tone: "red",
    heading: "The power dies before the water peaks.",
    sub: "Even after routine support, 13,811 people would lose coverage at hour 14. Flooded roads, exhausted batteries and broken network links leave communities at risk.",
  },
  {
    t: 13,
    eyebrow: "The first instinct",
    tone: "red",
    heading: "Truck a generator to the dark site?",
    sub: "Some roads flood before crews can arrive. ResiliNet checks which generator routes remain usable, and when help must arrive.",
  },
  {
    t: 17,
    eyebrow: "Where would you put it?",
    tone: "red",
    heading: "The far ridge? Blocked.",
    sub: "Dry and high, but the mountain stands between it and every village.",
  },
  {
    t: 21,
    eyebrow: "The engine",
    tone: "teal",
    heading: "Score every dry, reachable site.",
    sub: "The plan combines generator support at Kuala Balah with a portable tower at Kampung Bukit Bedak. Together they help 8,604 more people after routine support.",
  },
  {
    t: 29.45,
    eyebrow: "ResiliNet 3D",
    tone: "teal",
    heading: "8,604 people kept on signal.",
    sub: "In our Kelantan scenario, 8,604 of the 13,811 who would otherwise lose coverage stay connected through generator support and a portable tower. 5,207 still need help.",
  },
];

export const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));

/** Smoothstep between two times; the whole loop is built out of these. */
export function ss(t: number, a: number, b: number): number {
  const x = clamp((t - a) / (b - a), 0, 1);
  return x * x * (3 - 2 * x);
}

export const lerp = (a: number, b: number, f: number): number => a + (b - a) * f;

/** 0, then an overshoot settling to 1, starting at `a` over `d` seconds. */
export function pop(t: number, a: number, d: number): number {
  const x = clamp((t - a) / d, 0, 1);
  return x === 0 ? 0 : 1 + 2.2 * Math.pow(1 - x, 2.5) * Math.sin(x * 9) * (1 - x);
}

export function beatIndexAt(t: number): number {
  let i = 0;
  for (let k = 0; k < BEATS.length; k++) if (t >= BEATS[k]!.t) i = k;
  return i;
}

export function actIndexAt(t: number): number {
  let i = 0;
  for (let k = 0; k < ACT_STARTS.length; k++) if (t >= ACT_STARTS[k]!) i = k;
  return i;
}

export interface ChipState {
  figure: number;
  label: string;
  sub: string;
  tone: Tone;
}

/** The counter, counting up as each phase lands. */
export function chipAt(t: number): ChipState {
  if (t < 9.2) {
    return { figure: SCENARIO.online, label: "online", sub: "modelled coverage · before storm", tone: "teal" };
  }
  if (t < 27.25) {
    return {
      figure: Math.round(SCENARIO.cutOff * ss(t, 9.2, 11.4)),
      label: "would lose coverage",
      sub: "remaining at risk after routine support",
      tone: "red",
    };
  }
  return {
    figure: Math.round(SCENARIO.back * ss(t, 27.25, 29.05)),
    label: "kept on signal",
    sub: `of ${SCENARIO.cutOff.toLocaleString("en-US")} who would lose coverage`,
    tone: "teal",
  };
}

/** The scenario dial, in metres. A dial the viewer watches, never a forecast. */
export function stageMetresAt(t: number): number {
  return 1.4 * ss(t, 6.4, 9.6);
}

/** The tip beside the pointer while the tower is being placed. */
export function tipAt(t: number): { title: string; detail: string } {
  return t > 26.8
    ? {
        title: `Portable tower: +${SCENARIO.portableTower.toLocaleString("en-US")} people`,
        detail: "Combined response: 8,604 of 13,811 kept on signal, after routine support.",
      }
    : {
        title: "We simulate the placement…",
        detail: "…and compute who comes back: coverage, flood depth, road access",
      };
}
