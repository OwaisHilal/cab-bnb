import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { pickCurrentGuestTrip } from "@/lib/guest-trip/pickCurrentGuestTrip"

describe("pickCurrentGuestTrip", () => {
  it("prefers the newest in-progress trip", () => {
    const picked = pickCurrentGuestTrip([
      { id: "old", createdAt: "2026-09-01T00:00:00.000Z", inProgress: true, finished: false, closed: false },
      { id: "new", createdAt: "2026-09-02T00:00:00.000Z", inProgress: true, finished: false, closed: false },
    ])
    assert.equal(picked?.id, "new")
  })

  it("returns the newest finished trip when nothing is in progress", () => {
    const picked = pickCurrentGuestTrip([
      { id: "done", createdAt: "2026-09-03T00:00:00.000Z", inProgress: false, finished: true, closed: false },
      { id: "closed", createdAt: "2026-09-04T00:00:00.000Z", inProgress: false, finished: true, closed: true },
    ])
    assert.equal(picked?.id, "done")
  })

  it("returns null when every row is closed", () => {
    assert.equal(
      pickCurrentGuestTrip([
        { id: "a", createdAt: "2026-09-01T00:00:00.000Z", inProgress: false, finished: false, closed: true },
      ]),
      null,
    )
  })
})
