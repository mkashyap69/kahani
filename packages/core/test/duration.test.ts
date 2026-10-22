import { describe, expect, it } from "vitest";
import { shotDuration, toFrames, estimateSpeechSeconds, totalDuration, MIN_SHOT_SEC } from "../src/domain/duration.js";
import { canTransition } from "../src/domain/status.js";
import { zonedTime, localDate } from "../src/pipeline/daily.js";

describe("shot duration", () => {
  it("is audio + 0.4s padding", () => {
    expect(shotDuration(3.0)).toBeCloseTo(3.4, 5);
  });
  it("never goes below 2.5s", () => {
    expect(shotDuration(0.8)).toBe(MIN_SHOT_SEC);
    expect(shotDuration(2.1)).toBe(MIN_SHOT_SEC);
  });
  it("uses the estimate for silent shots, floored at 2.5s", () => {
    expect(shotDuration(null, 4)).toBe(4);
    expect(shotDuration(null, 1)).toBe(2.5);
    expect(shotDuration(0, undefined)).toBe(2.5);
  });
  it("is frame aligned (rounds up to whole frames at 30fps)", () => {
    const d = shotDuration(3.017);
    expect(Math.abs(d * 30 - Math.round(d * 30))).toBeLessThan(1e-9);
    expect(d).toBeGreaterThanOrEqual(3.417);
    expect(toFrames(1)).toBe(30);
    expect(toFrames(1.0001)).toBe(31);
  });
  it("sums totals", () => {
    expect(totalDuration([shotDuration(3), shotDuration(null, 2)])).toBeCloseTo(5.9, 5);
  });
  it("estimates Hindi speech time", () => {
    const s = estimateSpeechSeconds("दादी, आप फिर से मेरी चाय पी गईं?");
    expect(s).toBeGreaterThan(1);
    expect(s).toBeLessThan(4);
    expect(estimateSpeechSeconds("दादी आप", 2)).toBeLessThan(estimateSpeechSeconds("दादी आप", 1));
  });
});

describe("status machine", () => {
  it("allows the happy path", () => {
    const path = ["QUEUED", "SCRIPTING", "SCRIPT_READY", "IMAGING", "IMAGES_READY", "VOICING", "ANIMATING", "ASSEMBLING", "REVIEW", "PUBLISHING", "PUBLISHED"] as const;
    for (let i = 1; i < path.length; i++) expect(canTransition(path[i - 1], path[i])).toBe(true);
  });
  it("lets failed / reviewed items re-run a stage but never re-open published ones", () => {
    expect(canTransition("FAILED", "VOICING")).toBe(true);
    expect(canTransition("REVIEW", "IMAGING")).toBe(true);
    expect(canTransition("PUBLISHED", "IMAGING")).toBe(false);
    expect(canTransition("QUEUED", "PUBLISHING")).toBe(false);
    expect(canTransition("IMAGING", "PUBLISHED")).toBe(false);
  });
});

describe("timezone scheduling", () => {
  it("converts Asia/Kolkata wall time to UTC", () => {
    expect(zonedTime("2026-10-22", "18:00", "Asia/Kolkata").toISOString()).toBe("2026-10-22T12:30:00.000Z");
  });
  it("handles DST zones", () => {
    expect(zonedTime("2026-07-01", "09:00", "America/New_York").toISOString()).toBe("2026-07-01T13:00:00.000Z");
    expect(zonedTime("2026-12-01", "09:00", "America/New_York").toISOString()).toBe("2026-12-01T14:00:00.000Z");
  });
  it("computes the local date", () => {
    expect(localDate("Asia/Kolkata", new Date("2026-10-22T20:00:00Z"))).toBe("2026-10-23");
  });
});
