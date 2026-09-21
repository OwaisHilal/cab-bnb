import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  MSG91_VENDOR_ASSIGN_DRIVER_TEMPLATE_NAME,
  VENDOR_ASSIGN_DRIVER_CTA_TITLE,
  VENDOR_ASSIGN_DRIVER_DASHBOARD_BODY,
  buildVendorAssignDriverV2CreateApiBody,
} from "./vendorAssignDriverCreateTemplate"

const SAMPLE_TOKEN =
  "eyJib29raW5nSWQiOiIxMTExMTExMS0xMTExLTQxMTEtODExMS0xMTExMTExMTExMTEiLCJ2ZW5kb3JJZCI6IjIyMjIyMjIyLTIyMjItNDIyMi04MjIyLTIyMjIyMjIyMjIyMiIsImV4cCI6MTc1ODUyMzIwMDAwMH0.k8F3n2QpZ7xT1vM9wL4rY6bC0dE5fG2h"

describe("vendor_assign_driver_v2 dashboard body", () => {
  it("does not start or end with a variable", () => {
    assert.equal(VENDOR_ASSIGN_DRIVER_DASHBOARD_BODY.startsWith("{{"), false)
    assert.equal(VENDOR_ASSIGN_DRIVER_DASHBOARD_BODY.trimEnd().endsWith("}}"), false)
  })

  it("keeps the exact vendor_assign_driver_v1 body copy (9 numbered variables)", () => {
    for (let n = 1; n <= 9; n += 1) {
      assert.match(VENDOR_ASSIGN_DRIVER_DASHBOARD_BODY, new RegExp(`\\{\\{${n}\\}\\}`))
    }
    assert.doesNotMatch(VENDOR_ASSIGN_DRIVER_DASHBOARD_BODY, /\{\{10\}\}/)
  })
})

describe("buildVendorAssignDriverV2CreateApiBody", () => {
  it("emits Facebook-shaped BODY + BUTTONS with one dynamic URL button", () => {
    const body = buildVendorAssignDriverV2CreateApiBody("+919111111111", SAMPLE_TOKEN)

    assert.equal(body.template_name, MSG91_VENDOR_ASSIGN_DRIVER_TEMPLATE_NAME)
    assert.equal(body.name, MSG91_VENDOR_ASSIGN_DRIVER_TEMPLATE_NAME)
    assert.equal(body.integrated_number, "919111111111")
    assert.equal(body.language, "en_US")
    assert.equal(body.category, "UTILITY")
    assert.equal(body.allow_category_change, false)

    const types = body.components.map((component) => component.type)
    assert.deepEqual(types, ["BODY", "BUTTONS"])

    const bodyComponent = body.components[0] as {
      text: string
      example: { body_text: string[][] }
    }
    assert.equal(bodyComponent.text, VENDOR_ASSIGN_DRIVER_DASHBOARD_BODY)
    assert.equal(bodyComponent.example.body_text.length, 1)
    assert.equal(bodyComponent.example.body_text[0]?.length, 9)

    const buttons = body.components[1]?.buttons as Array<{
      type: string
      text: string
      url: string
      example: string[]
    }>
    assert.equal(buttons.length, 1)
    assert.equal(buttons[0]?.type, "URL")
    assert.equal(buttons[0]?.text, VENDOR_ASSIGN_DRIVER_CTA_TITLE)
    assert.match(buttons[0]?.url ?? "", /\/vendor\/assign-driver\?token=\{\{1\}\}$/)
    assert.deepEqual(buttons[0]?.example, [SAMPLE_TOKEN])
  })

  it("strips a leading + from the integrated number", () => {
    const withPlus = buildVendorAssignDriverV2CreateApiBody("+919111111111", SAMPLE_TOKEN)
    const withoutPlus = buildVendorAssignDriverV2CreateApiBody("919111111111", SAMPLE_TOKEN)
    assert.equal(withPlus.integrated_number, withoutPlus.integrated_number)
  })
})
