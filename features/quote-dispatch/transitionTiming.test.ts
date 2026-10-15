import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { computeVerifiedTransitionDelayMs } from "./transitionTiming";

describe("computeVerifiedTransitionDelayMs", () => {
  it("waits out the remaining matching animation when verified early", () => {
    // Verified 1s into a 4.5s animation, with a 900ms success beat — the
    // 3.5s left on the animation dominates the 900ms floor.
    assert.equal(computeVerifiedTransitionDelayMs(1000, 4500, 900), 3500);
  });

  it("falls back to the success beat once the animation has finished", () => {
    // Verified after the 4.5s animation already elapsed.
    assert.equal(computeVerifiedTransitionDelayMs(5000, 4500, 900), 900);
  });

  it("falls back to the success beat when verified at the exact animation end", () => {
    assert.equal(computeVerifiedTransitionDelayMs(4500, 4500, 900), 900);
  });

  it("falls back to the success beat when no matching animation ever ran (resume flow)", () => {
    // The resume flow never calls runDispatch, so callers pass a very large
    // elapsed value (or Infinity) to represent "no animation in flight".
    assert.equal(computeVerifiedTransitionDelayMs(Number.POSITIVE_INFINITY, 4500, 900), 900);
  });

  it("never returns a negative delay", () => {
    assert.equal(computeVerifiedTransitionDelayMs(0, 0, 900), 900);
  });
});
