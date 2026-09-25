import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { formatDisplayName } from "./formatDisplayName"

describe("formatDisplayName", () => {
  it("title-cases all-caps names", () => {
    assert.equal(formatDisplayName("BILAL AHMAD"), "Bilal Ahmad")
  })

  it("leaves mixed-case names unchanged", () => {
    assert.equal(formatDisplayName("Bilal Ahmed"), "Bilal Ahmed")
  })
})
