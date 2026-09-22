import { describe, expect, it } from "vitest";

import {
  ACT_STARTS,
  BEATS,
  LOOP_SECONDS,
  SCENARIO,
  actIndexAt,
  beatIndexAt,
  chipAt,
  stageMetresAt,
  tipAt,
} from "./landingModel";

describe("landing beats", () => {
  it("starts on the normal day and ends on the closing card", () => {
    expect(beatIndexAt(0)).toBe(0);
    expect(BEATS[beatIndexAt(0)]!.eyebrow).toBe("The normal day");
    expect(beatIndexAt(LOOP_SECONDS - 0.01)).toBe(BEATS.length - 1);
  });

  it("advances exactly at each beat time and never between", () => {
    for (let i = 0; i < BEATS.length; i++) {
      const t = BEATS[i]!.t;
      expect(beatIndexAt(t)).toBe(i);
      if (i > 0) expect(beatIndexAt(t - 0.01)).toBe(i - 1);
    }
  });

  it("names the failure as power, not the tower falling over", () => {
    const failure = BEATS[beatIndexAt(7)]!;
    expect(failure.heading.toLowerCase()).toContain("power");
    expect(failure.tone).toBe("red");
  });

  it("keeps every beat within the loop", () => {
    for (const b of BEATS) expect(b.t).toBeLessThan(LOOP_SECONDS);
  });
});

describe("acts", () => {
  it("maps each act start to its own index", () => {
    ACT_STARTS.forEach((t, i) => expect(actIndexAt(t)).toBe(i));
  });

  it("holds the last act to the end of the loop", () => {
    expect(actIndexAt(LOOP_SECONDS - 0.01)).toBe(ACT_STARTS.length - 1);
  });
});

describe("the counter", () => {
  it("opens on the online figure, labelled as modelled coverage", () => {
    const chip = chipAt(0);
    expect(chip.figure).toBe(SCENARIO.online);
    expect(chip.label).toBe("online");
    expect(chip.sub).toBe("modelled coverage · before storm");
    expect(chip.tone).toBe("teal");
  });

  it("counts up to the cut-off total after the power fails", () => {
    expect(chipAt(9.2).figure).toBe(0);
    expect(chipAt(11.4).figure).toBe(SCENARIO.cutOff);
    expect(chipAt(10.3).figure).toBeGreaterThan(0);
    expect(chipAt(10.3).figure).toBeLessThan(SCENARIO.cutOff);
    expect(chipAt(11.4).tone).toBe("red");
  });

  it("counts up to the reconnected total once the tower lands", () => {
    expect(chipAt(27.25).figure).toBe(0);
    expect(chipAt(29.05).figure).toBe(SCENARIO.back);
    expect(chipAt(29.05).label).toBe("kept on signal");
    expect(chipAt(29.05).tone).toBe("teal");
  });

  it("never claims more people back than were cut off", () => {
    expect(SCENARIO.back).toBeLessThan(SCENARIO.cutOff);
    for (let t = 0; t < LOOP_SECONDS; t += 0.25) {
      expect(chipAt(t).figure).toBeLessThanOrEqual(SCENARIO.online);
    }
  });
});

describe("the scenario dial", () => {
  it("stands at zero before the surge and rises to the modelled stage", () => {
    expect(stageMetresAt(0)).toBe(0);
    expect(stageMetresAt(6.4)).toBe(0);
    expect(stageMetresAt(9.6)).toBeCloseTo(1.4, 5);
  });

  it("never falls back as the loop runs on", () => {
    let previous = 0;
    for (let t = 0; t <= 12; t += 0.1) {
      const now = stageMetresAt(t);
      expect(now).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = now;
    }
  });
});

describe("the placement tip", () => {
  it("says it is simulating before the drop and reports after it", () => {
    expect(tipAt(25).title).toContain("simulate");
    const after = tipAt(27);
    expect(after.title).toContain("1,128");
    expect(after.detail).toContain("8,604");
    expect(after.detail).toContain("13,811");
  });
});

// These totals must reconcile across the demo and the working prototype.
describe("Kuala Krai response accounting", () => {
  it("separates routine support from the additional response", () => {
    expect(SCENARIO.generator + SCENARIO.portableTower).toBe(SCENARIO.additionalResponse);
    expect(SCENARIO.routineSupport + SCENARIO.additionalResponse).toBe(SCENARIO.totalWithRoutineSupport);
    expect(SCENARIO.initialAtRisk - SCENARIO.routineSupport).toBe(SCENARIO.cutOff);
    expect(SCENARIO.back).toBe(SCENARIO.additionalResponse);
    expect(SCENARIO.back + SCENARIO.remaining).toBe(SCENARIO.cutOff);
  });
});
