import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { canSendTemplate } from "./envelope"
import { paginateTemplateRows } from "./templates"

describe("paginateTemplateRows", () => {
  it("sets hasMoreData false on the last page", () => {
    const rows = Array.from({ length: 25 }, (_, index) => index)
    const page1 = paginateTemplateRows(rows, 20, 1)
    assert.equal(page1.rows.length, 20)
    assert.equal(page1.hasMoreData, true)

    const page2 = paginateTemplateRows(rows, 20, 2)
    assert.equal(page2.rows.length, 5)
    assert.equal(page2.hasMoreData, false)
  })
})

describe("non-approved bulk reject", () => {
  it("rejects pending and rejected templates", () => {
    assert.equal(canSendTemplate("pending"), false)
    assert.equal(canSendTemplate("rejected"), false)
    assert.equal(canSendTemplate("approved"), true)
  })
})
