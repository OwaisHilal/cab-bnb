import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { shouldUseMsg91ApprovedTemplates } from "./useApprovedTemplates"

describe("shouldUseMsg91ApprovedTemplates", () => {
  it("defaults to true when unset or blank", () => {
    assert.equal(shouldUseMsg91ApprovedTemplates(undefined), true)
    assert.equal(shouldUseMsg91ApprovedTemplates(""), true)
    assert.equal(shouldUseMsg91ApprovedTemplates("  "), true)
  })

  it("treats true / yes / 1 as on", () => {
    assert.equal(shouldUseMsg91ApprovedTemplates("true"), true)
    assert.equal(shouldUseMsg91ApprovedTemplates("YES"), true)
    assert.equal(shouldUseMsg91ApprovedTemplates("1"), true)
  })

  it("treats false / no / 0 / off as off", () => {
    assert.equal(shouldUseMsg91ApprovedTemplates("false"), false)
    assert.equal(shouldUseMsg91ApprovedTemplates("NO"), false)
    assert.equal(shouldUseMsg91ApprovedTemplates("0"), false)
    assert.equal(shouldUseMsg91ApprovedTemplates("off"), false)
  })
})
