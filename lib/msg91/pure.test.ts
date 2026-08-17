import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_MSG91_OTP_TEMPLATE_LANGUAGE,
  DEFAULT_MSG91_OTP_TEMPLATE_NAME,
  MSG91_WHATSAPP_BULK_URL,
  buildMsg91AuthOtpComponents,
  buildMsg91BulkTemplateBody,
  mapMsg91ResponseToWaMessageId,
  resolveMsg91OtpTemplateConfig,
  resolveMsg91SendCredentials,
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
