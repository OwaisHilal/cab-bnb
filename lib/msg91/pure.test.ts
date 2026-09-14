import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_MSG91_OTP_TEMPLATE_LANGUAGE,
  DEFAULT_MSG91_OTP_TEMPLATE_NAME,
  MSG91_WHATSAPP_BULK_URL,
  MSG91_WHATSAPP_OUTBOUND_URL,
  MSG91_WHATSAPP_PAYMENT_LINK_URL,
  buildMsg91AuthOtpComponents,
  buildMsg91BulkTemplateBody,
  buildMsg91InteractiveButtonBody,
  buildMsg91InteractiveListBody,
  buildMsg91PaymentLinkBody,
  buildMsg91TextOutboundUrl,
  mapMsg91ResponseToWaMessageId,
  resolveMsg91OtpTemplateConfig,
  resolveMsg91SendCredentials,
  sendMsg91InteractiveButtonWithConfig,
  sendMsg91PaymentLinkWithConfig,
  sendMsg91TemplateWithConfig,
  stripE164Plus,
} from "./pure";

const sampleInput = {
  toE164: "+919876543210",
  templateName: "otp_verification",
  languageCode: "en_US",
  namespace: "example_namespace",
  components: {
    body_1: { type: "text", value: "123456" },
  },
};

describe("stripE164Plus", () => {
  it("strips a leading plus from E.164", () => {
    assert.equal(stripE164Plus("+919876543210"), "919876543210");
  });

  it("leaves digits-only numbers unchanged", () => {
    assert.equal(stripE164Plus("919876543210"), "919876543210");
  });

  it("trims whitespace before stripping", () => {
    assert.equal(stripE164Plus(" +919876543210 "), "919876543210");
  });
});

describe("mapMsg91ResponseToWaMessageId", () => {
  it("prefers uuid (Meta WAMID) over requestId", () => {
    assert.equal(
      mapMsg91ResponseToWaMessageId({
        uuid: "wamid.ABC",
        requestId: "req-1",
      }),
      "wamid.ABC",
    );
  });

  it("maps requestId when uuid is absent", () => {
    assert.equal(mapMsg91ResponseToWaMessageId({ requestId: "req-1" }), "req-1");
  });

  it("maps request_id from the official SDK bulk-response shape", () => {
    assert.equal(
      mapMsg91ResponseToWaMessageId({
        status: "success",
        hasError: false,
        data: "Your request is in process, check delivery reports for status",
        request_id: "7dc9157ab37f4ab683e73d4f0a7c111a",
      }),
      "7dc9157ab37f4ab683e73d4f0a7c111a",
    );
  });

  it("maps nested data.uuid", () => {
    assert.equal(mapMsg91ResponseToWaMessageId({ data: { uuid: "wamid.NESTED" } }), "wamid.NESTED");
  });

  it("returns undefined when no id fields exist", () => {
    assert.equal(mapMsg91ResponseToWaMessageId({ status: "success" }), undefined);
  });
});

describe("resolveMsg91SendCredentials", () => {
  it("returns null when auth key is missing", () => {
    assert.equal(
      resolveMsg91SendCredentials({ MSG91_WHATSAPP_INTEGRATED_NUMBER: "919999999999" }),
      null,
    );
  });

  it("returns null when integrated number is missing", () => {
    assert.equal(resolveMsg91SendCredentials({ MSG91_AUTH_KEY: "key" }), null);
  });

  it("returns null when values are blank", () => {
    assert.equal(
      resolveMsg91SendCredentials({
        MSG91_AUTH_KEY: "  ",
        MSG91_WHATSAPP_INTEGRATED_NUMBER: "  ",
      }),
      null,
    );
  });

  it("returns trimmed credentials when both are set", () => {
    assert.deepEqual(
      resolveMsg91SendCredentials({
        MSG91_AUTH_KEY: " key ",
        MSG91_WHATSAPP_INTEGRATED_NUMBER: " +919999999999 ",
      }),
      { authKey: "key", integratedNumber: "+919999999999" },
    );
  });
});

describe("buildMsg91BulkTemplateBody", () => {
  it("strips plus from recipient and integrated number and includes namespace", () => {
    const body = buildMsg91BulkTemplateBody(sampleInput, "+919111111111");
    const payload = body.payload as Record<string, unknown>;
    const template = payload.template as Record<string, unknown>;
    const recipients = template.to_and_components as Array<{ to: string[] }>;

    assert.equal(body.integrated_number, "919111111111");
    assert.equal(body.content_type, "template");
    assert.equal(payload.type, "template");
    assert.equal(template.namespace, "example_namespace");
    assert.deepEqual(recipients[0]?.to, ["919876543210"]);
    assert.equal(MSG91_WHATSAPP_BULK_URL.includes("graph.facebook.com"), false);
  });

  it("omits namespace when blank rather than inventing one", () => {
    const body = buildMsg91BulkTemplateBody(
      { ...sampleInput, namespace: "  " },
      "919111111111",
    );
    const payload = body.payload as Record<string, unknown>;
    const template = payload.template as Record<string, unknown>;
    assert.equal("namespace" in template, false);
  });

  it("sets CRQID at the root when provided", () => {
    const body = buildMsg91BulkTemplateBody({ ...sampleInput, crqid: "otp-send-1" }, "919111111111");
    assert.equal(body.CRQID, "otp-send-1");
  });
});

describe("sendMsg91TemplateWithConfig", () => {
  it("returns configured: false and does not fetch when credentials are missing", async () => {
    let fetchCalls = 0;
    const result = await sendMsg91TemplateWithConfig(sampleInput, null, async () => {
      fetchCalls += 1;
      return new Response("{}", { status: 200 });
    });

    assert.equal(fetchCalls, 0);
    assert.deepEqual(result, {
      configured: false,
      success: false,
      error: "MSG91 WhatsApp credentials are not configured",
    });
  });

  it("maps uuid onto waMessageId on HTTP 200", async () => {
    const result = await sendMsg91TemplateWithConfig(
      sampleInput,
      { authKey: "key", integratedNumber: "919111111111" },
      async (url, init) => {
        assert.equal(url, MSG91_WHATSAPP_BULK_URL);
        assert.equal(String(url).includes("graph.facebook.com"), false);
        const headers = init?.headers as Record<string, string>;
        assert.equal(headers.authkey, "key");
        return new Response(JSON.stringify({ uuid: "wamid.SENT" }), { status: 200 });
      },
    );

    assert.deepEqual(result, {
      configured: true,
      success: true,
      waMessageId: "wamid.SENT",
    });
  });

  it("treats hasError: true as a failed send", async () => {
    const result = await sendMsg91TemplateWithConfig(
      sampleInput,
      { authKey: "key", integratedNumber: "919111111111" },
      async () =>
        new Response(JSON.stringify({ hasError: true, message: "bad template" }), { status: 200 }),
    );

    assert.equal(result.configured, true);
    assert.equal(result.success, false);
    assert.match(result.error ?? "", /bad template/);
  });
});

describe("resolveMsg91OtpTemplateConfig", () => {
  it("uses documented name and language fallbacks when env is blank", () => {
    assert.deepEqual(resolveMsg91OtpTemplateConfig({}), {
      templateName: DEFAULT_MSG91_OTP_TEMPLATE_NAME,
      languageCode: DEFAULT_MSG91_OTP_TEMPLATE_LANGUAGE,
    });
    assert.equal(DEFAULT_MSG91_OTP_TEMPLATE_NAME, "otp_verification");
    assert.equal(DEFAULT_MSG91_OTP_TEMPLATE_LANGUAGE, "en_US");
  });

  it("omits namespace when blank rather than inventing one", () => {
    const config = resolveMsg91OtpTemplateConfig({
      MSG91_OTP_TEMPLATE_NAME: "kashmir_otp",
      MSG91_OTP_TEMPLATE_NAMESPACE: "  ",
      MSG91_OTP_TEMPLATE_LANGUAGE: "en",
    });
    assert.deepEqual(config, { templateName: "kashmir_otp", languageCode: "en" });
    assert.equal("namespace" in config, false);
  });

  it("includes trimmed namespace when set", () => {
    assert.deepEqual(
      resolveMsg91OtpTemplateConfig({
        MSG91_OTP_TEMPLATE_NAME: " kashmir_otp ",
        MSG91_OTP_TEMPLATE_NAMESPACE: " ns-1 ",
        MSG91_OTP_TEMPLATE_LANGUAGE: " en_US ",
      }),
      { templateName: "kashmir_otp", languageCode: "en_US", namespace: "ns-1" },
    );
  });
});

describe("buildMsg91AuthOtpComponents", () => {
  it("sets body_1 and button_1 copy-code to the same OTP", () => {
    assert.deepEqual(buildMsg91AuthOtpComponents("123456"), {
      body_1: { type: "text", value: "123456" },
      button_1: { subtype: "url", type: "text", value: "123456" },
    });
  });
});

describe("buildMsg91InteractiveButtonBody", () => {
  it("maps interactive buttons to MSG91 session payload", () => {
    const body = buildMsg91InteractiveButtonBody(
      {
        toE164: "+919876543210",
        bodyText: "Pay to lock",
        buttons: [{ id: "BOOK_TOKEN::uuid-1", title: "Pay ₹99 to Lock" }],
      },
      "+919111111111",
    );

    assert.equal(body.recipient_number, "919876543210");
    assert.equal(body.integrated_number, "919111111111");
    assert.equal(body.content_type, "interactive");
    const interactive = body.interactive as Record<string, unknown>;
    const action = interactive.action as { buttons: Array<{ reply: { id: string; title: string } }> };
    assert.equal(action.buttons[0]?.reply.id, "BOOK_TOKEN::uuid-1");
    assert.equal(action.buttons[0]?.reply.title, "Pay ₹99 to Lock");
    assert.equal(MSG91_WHATSAPP_OUTBOUND_URL.includes("bulk"), false);
  });
});

describe("buildMsg91InteractiveListBody", () => {
  it("maps interactive list to MSG91 session payload", () => {
    const body = buildMsg91InteractiveListBody(
      {
        toE164: "+919876543210",
        bodyText: "Pick an operator",
        buttonText: "Choose operator",
        headerText: "Kashmir Cab Quotes",
        sections: [
          {
            title: "Pay ₹99 to lock",
            rows: [
              {
                id: "BOOK_TOKEN::uuid-1",
                title: "Nova Cabs",
                description: "₹10,800/day · Sedan",
              },
            ],
          },
        ],
      },
      "+919111111111",
    );

    assert.equal(body.recipient_number, "919876543210");
    assert.equal(body.integrated_number, "919111111111");
    assert.equal(body.content_type, "interactive");
    const interactive = body.interactive as Record<string, unknown>;
    assert.equal((interactive.header as { text: string }).text, "Kashmir Cab Quotes");
    const action = interactive.action as {
      button: string;
      sections: Array<{ rows: Array<{ id: string }> }>;
    };
    assert.equal(action.button, "Choose operator");
    assert.equal(action.sections[0]?.rows[0]?.id, "BOOK_TOKEN::uuid-1");
  });
});

describe("buildMsg91PaymentLinkBody", () => {
  it("maps Cashfree payment_link session payload with numeric amount and CRQID", () => {
    const body = buildMsg91PaymentLinkBody(
      {
        toE164: "+919876543210",
        bodyText: "Lock this cab with a ₹99 token.",
        footerText: "Pay ₹99 to lock this cab.",
        headerImageUrl: "https://example.com/cab.jpg",
        items: [{ name: "Token lock · Aala Cabs · 5 days", amount: 99, quantity: 1 }],
        crqid: "11111111-1111-4111-8111-111111111111",
      },
      "+919111111111",
    );

    assert.equal(body.recipient_number, "919876543210");
    assert.equal(body.integrated_number, "919111111111");
    assert.equal(body.content_type, "interactive");
    assert.equal(body.CRQID, "11111111-1111-4111-8111-111111111111");
    const interactive = body.interactive as Record<string, unknown>;
    assert.equal(interactive.type, "payment_link");
    assert.equal((interactive.body as { text: string }).text, "Lock this cab with a ₹99 token.");
    assert.equal((interactive.footer as { text: string }).text, "Pay ₹99 to lock this cab.");
    const items = interactive.items as Array<{ name: string; amount: number; quantity: number }>;
    assert.equal(items[0]?.amount, 99);
    assert.equal(typeof items[0]?.amount, "number");
    assert.equal(items[0]?.quantity, 1);
    assert.deepEqual(interactive.header, {
      type: "image",
      image: { link: "https://example.com/cab.jpg" },
    });
  });
});

describe("buildMsg91TextOutboundUrl", () => {
  it("builds the documented text session query string", () => {
    const url = buildMsg91TextOutboundUrl(
      { toE164: "+919876543210", bodyText: "Hello driver" },
      "+919111111111",
    );
    assert.match(url, /^https:\/\/control\.msg91\.com\/api\/v5\/whatsapp\/whatsapp-outbound-message\/?\?/);
    assert.match(url, /integrated_number=919111111111/);
    assert.match(url, /recipient_number=919876543210/);
    assert.match(url, /content_type=text/);
    assert.match(url, /text=Hello\+driver/);
  });
});

describe("sendMsg91InteractiveButtonWithConfig", () => {
  it("posts to the session outbound endpoint", async () => {
    const result = await sendMsg91InteractiveButtonWithConfig(
      {
        toE164: "+919876543210",
        bodyText: "Quote ready",
        buttons: [{ id: "BOOK_TOKEN::uuid-1", title: "Pay ₹99 to Lock" }],
      },
      { authKey: "key", integratedNumber: "919111111111" },
      async (url, init) => {
        assert.equal(url, MSG91_WHATSAPP_OUTBOUND_URL);
        assert.equal(String(url).includes("graph.facebook.com"), false);
        const headers = init?.headers as Record<string, string>;
        assert.equal(headers.authkey, "key");
        return new Response(JSON.stringify({ uuid: "wamid.BUTTON" }), { status: 200 });
      },
    );

    assert.deepEqual(result, {
      configured: true,
      success: true,
      waMessageId: "wamid.BUTTON",
    });
  });
});

describe("sendMsg91PaymentLinkWithConfig", () => {
  it("posts payment_link JSON to the session outbound endpoint", async () => {
    const result = await sendMsg91PaymentLinkWithConfig(
      {
        toE164: "+919876543210",
        bodyText: "Lock this cab with a ₹99 token.",
        items: [{ name: "Token lock · Aala Cabs", amount: 99, quantity: 1 }],
        crqid: "pay-1",
      },
      { authKey: "key", integratedNumber: "919111111111" },
      async (url, init) => {
        assert.equal(url, MSG91_WHATSAPP_PAYMENT_LINK_URL);
        const parsed = JSON.parse(String(init?.body)) as Record<string, unknown>;
        assert.equal(parsed.CRQID, "pay-1");
        const interactive = parsed.interactive as { type: string };
        assert.equal(interactive.type, "payment_link");
        return new Response(JSON.stringify({ request_id: "req-pay" }), { status: 200 });
      },
    );

    assert.deepEqual(result, {
      configured: true,
      success: true,
      waMessageId: "req-pay",
    });
  });
});
