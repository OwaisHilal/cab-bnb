import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { getUpcomingDates } from "./upcomingDates"

describe("getUpcomingDates", () => {
  it("starts from the given date and returns consecutive local calendar days", () => {
    const dates = getUpcomingDates(new Date(2026, 7, 15), 4)
    assert.deepEqual(dates, [
      { id: "d1", shortLabel: "Sat 15 Aug", isoDate: "2026-08-15" },
      { id: "d2", shortLabel: "Sun 16 Aug", isoDate: "2026-08-16" },
      { id: "d3", shortLabel: "Mon 17 Aug", isoDate: "2026-08-17" },
      { id: "d4", shortLabel: "Tue 18 Aug", isoDate: "2026-08-18" },
    ])
  })

  it("rolls over a month boundary using local calendar math, not UTC", () => {
    const dates = getUpcomingDates(new Date(2026, 7, 30), 4) // Aug 30, 2026
    assert.deepEqual(
      dates.map((date) => date.isoDate),
      ["2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02"],
    )
  })

  it("defaults to today plus the next 3 days when called with no arguments", () => {
    const today = new Date()
    const expectedFirstIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
      today.getDate(),
    ).padStart(2, "0")}`

    const dates = getUpcomingDates()

    assert.equal(dates.length, 4)
    assert.equal(dates[0].id, "d1")
    assert.equal(dates[0].isoDate, expectedFirstIso)
  })

  it("supports a custom count", () => {
    const dates = getUpcomingDates(new Date(2026, 7, 15), 2)
    assert.equal(dates.length, 2)
  })
})
