import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { UPCOMING_DATES } from "./constants";
import { resolveTripStartDate } from "./resolveTripStartDate";

describe("resolveTripStartDate", () => {
  it("returns null when no preset or custom date is chosen", () => {
    assert.equal(
      resolveTripStartDate({ selectedDateId: null, customDate: null }),
      null,
    );
  });

  it("returns null for a blank custom date", () => {
    assert.equal(
      resolveTripStartDate({ selectedDateId: null, customDate: "" }),
      null,
    );
    assert.equal(
      resolveTripStartDate({ selectedDateId: null, customDate: "   " }),
      null,
    );
  });

  it("returns the matching preset iso date", () => {
    const preset = UPCOMING_DATES[1];
    assert.equal(
      resolveTripStartDate({ selectedDateId: preset.id, customDate: null }),
      preset.isoDate,
    );
  });

  it("returns the custom date when one is chosen", () => {
    assert.equal(
      resolveTripStartDate({ selectedDateId: null, customDate: "2026-09-01" }),
      "2026-09-01",
    );
  });

  it("does not fall back to the first upcoming date for an unknown preset id", () => {
    assert.equal(
      resolveTripStartDate({ selectedDateId: "not-a-date", customDate: null }),
      null,
    );
  });
});
