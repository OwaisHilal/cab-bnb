import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  JOIN_APPROVAL_AUTO,
  buildMsg91CreateGroupBody,
  parseMsg91GroupPayload,
  parseRideGroupWebhook,
  whatsAppInviteCode,
  withGroupsCreateSlash,
} from "./groupApi"

describe("withGroupsCreateSlash", () => {
  it("appends a trailing slash to the bare collection URL", () => {
    assert.equal(
      withGroupsCreateSlash("https://control.msg91.com/api/v5/whatsapp/groups"),
      "https://control.msg91.com/api/v5/whatsapp/groups/",
    )
  })

  it("does not double the slash if one is already present", () => {
    assert.equal(
      withGroupsCreateSlash("https://control.msg91.com/api/v5/whatsapp/groups/"),
      "https://control.msg91.com/api/v5/whatsapp/groups/",
    )
  })
})

describe("MSG91 group payload parsing", () => {
  it("parses the local sim create-group envelope", () => {
    const parsed = parseMsg91GroupPayload({
      status: "success",
      hasError: false,
      data: {
        id: "g.us.demo1",
        subject: "Ride ABC123 · Abdul · Aala",
        invite_link: "https://chat.whatsapp.com/demo1",
      },
    })
    assert.equal(parsed.groupId, "g.us.demo1")
    assert.equal(parsed.inviteLink, "https://chat.whatsapp.com/demo1")
    assert.equal(whatsAppInviteCode(parsed.inviteLink ?? ""), "demo1")
  })

  it("creates groups with auto_approve and a 128-char subject cap", () => {
    const body = buildMsg91CreateGroupBody({
      integratedNumber: "+919876543210",
      subject: "x".repeat(200),
      description: "Ride room",
    })
    assert.equal(body.join_approval_mode, JOIN_APPROVAL_AUTO)
    assert.equal(String(body.subject).length, 128)
    assert.equal(body.integrated_number, "919876543210")
  })

  it("does not treat a normal inbound WhatsApp message as a group event", () => {
    const event = parseRideGroupWebhook({
      eventName: "incoming message",
      uuid: "wamid.ABC",
      customerNumber: "919876543210",
      id: "wamid.ABC",
      text: "hello",
    })
    assert.equal(event, null)
  })

  it("maps a join webhook to the guest or driver wa_id", () => {
    const event = parseRideGroupWebhook({
      eventName: "group_participants_update",
      group_id: "g.us.demo1",
      participants: [{ wa_id: "919876543210" }],
    })
    assert.ok(event)
    assert.equal(event?.eventType, "join")
    assert.equal(event?.groupId, "g.us.demo1")
    assert.equal(event?.waId, "919876543210")
  })

  it("does not treat a group chat inbound as a join/create event", () => {
    const event = parseRideGroupWebhook({
      eventName: "incoming message",
      group_id: "g.us.demo1",
      customerNumber: "919876543210",
      uuid: "wamid.ABC",
      text: "DRIVER: Irfan | 9876543210 | JK01AA1111 | Innova",
    })
    assert.equal(event, null)
  })
})
