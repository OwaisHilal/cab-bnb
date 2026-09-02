import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  bulkFail,
  bulkSuccess,
  canSendTemplate,
  matchesTemplateStatusFilter,
  sessionError,
  sessionSuccess,
} from "./envelope"

describe("bulk envelope", () => {
  it("returns hasError false with request_id and uuid", () => {
    assert.deepEqual(bulkSuccess("req-1", "wamid.ABC"), {
      status: "success",
      hasError: false,
      data: "Your request is in process, check delivery reports for status",
      request_id: "req-1",
      uuid: "wamid.ABC",
    })
  })

  it("returns fail envelope with errors.message", () => {
    assert.equal(bulkFail("missing template").hasError, true)
    assert.equal(bulkFail("missing template").errors.message, "missing template")
  })
})

describe("session envelope", () => {
  it("returns type success with uuid extra field", () => {
    assert.deepEqual(sessionSuccess("wamid.X"), {
      type: "success",
      message: "Message sent successfully",
      uuid: "wamid.X",
    })
  })

  it("returns type error so isMsg91ErrorBody treats it as failure", () => {
    assert.deepEqual(sessionError("bad payload"), {
      type: "error",
      message: "bad payload",
    })
  })
})

describe("template status", () => {
  it("only approved templates can send", () => {
    assert.equal(canSendTemplate("approved"), true)
    assert.equal(canSendTemplate("pending"), false)
    assert.equal(canSendTemplate("rejected"), false)
  })

  it("filters lowercase status from Get Templates", () => {
    assert.equal(matchesTemplateStatusFilter("pending", "PENDING"), true)
    assert.equal(matchesTemplateStatusFilter("approved", "approved"), true)
    assert.equal(matchesTemplateStatusFilter("rejected", "pending"), false)
    assert.equal(matchesTemplateStatusFilter("approved", undefined), true)
  })
})
