import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { validateAnalyticsWindow, validateLogWindow } from "./dates"

const now = new Date("2026-09-02T12:00:00.000Z")

describe("validateLogWindow", () => {
  it("accepts a 3-day inclusive YYYY-MM-DD range", () => {
    const result = validateLogWindow("2026-08-31", "2026-09-02", now)
    assert.equal(result.ok, true)
  })

  it("rejects start dates older than 3 days", () => {
    const result = validateLogWindow("2026-08-20", "2026-08-21", now)
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.match(result.message, /last 3 days/)
  })

  it("rejects a span longer than 3 days", () => {
    const result = validateLogWindow("2026-08-31", "2026-09-04", now)
    assert.equal(result.ok, false)
  })
})

describe("validateAnalyticsWindow", () => {
  it("rejects a span longer than 31 days", () => {
    const result = validateAnalyticsWindow("2026-07-01", "2026-09-02", now)
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.match(result.message, /31 days/)
  })

  it("defaults to the last 31 days when dates are omitted", () => {
    const result = validateAnalyticsWindow(undefined, undefined, now)
    assert.equal(result.ok, true)
  })
})
