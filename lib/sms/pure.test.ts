import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MSG91_OTP_SEND_URL, sanitizeMsg91OtpResponseBody, sendMsg91OtpSmsWithConfig } from "./pure";

const options = { otpLength: 6, otpExpiryMinutes: 5 };

describe("sendMsg91OtpSmsWithConfig", () => {
  it("returns configured: false and does not fetch when credentials are missing", async () => {
    let fetchCalls = 0;
    const result = await sendMsg91OtpSmsWithConfig(
      "+919876543210",
      "123456",
      null,
      options,
      async () => {
        fetchCalls += 1;
        return new Response("{}", { status: 200 });
      },
    );

    assert.equal(fetchCalls, 0);
    assert.deepEqual(result, {
      configured: false,
      success: false,
      error: "MSG91 OTP is not configured",
    });
  });

  it("returns configured: false when auth key or template id is blank", async () => {
    const result = await sendMsg91OtpSmsWithConfig(
      "+919876543210",
      "123456",
      { authKey: "  ", templateId: "tmpl-1" },
      options,
      async () => {
        throw new Error("fetch should not run");
      },
    );

    assert.deepEqual(result, {
      configured: false,
      success: false,
      error: "MSG91 OTP is not configured",
    });
  });

  it("treats type: success as a successful send", async () => {
    const result = await sendMsg91OtpSmsWithConfig(
      "+919876543210",
      "123456",
      { authKey: "key", templateId: "tmpl-1" },
      options,
      async (url, init) => {
        assert.equal(String(url).startsWith(MSG91_OTP_SEND_URL), true);
        const parsed = new URL(String(url));
        assert.equal(parsed.searchParams.get("mobile"), "919876543210");
        assert.equal(parsed.searchParams.get("otp"), "123456");
        assert.equal(parsed.searchParams.get("template_id"), "tmpl-1");
        assert.equal(parsed.searchParams.get("otp_length"), "6");
        assert.equal(parsed.searchParams.get("otp_expiry"), "5");
        assert.equal(init?.method, "POST");
        assert.equal(init?.body, "{}");
        const headers = init?.headers as Record<string, string>;
        assert.equal(headers.authkey, "key");
        return new Response(JSON.stringify({ type: "success", request_id: "req-99" }), { status: 200 });
      },
    );

    assert.equal(result.configured, true);
    assert.equal(result.success, true);
    assert.equal(result.httpStatus, 200);
    assert.equal(result.msg91Type, "success");
    assert.equal(result.requestId, "req-99");
    assert.deepEqual(result.bodyKeys, ["type", "request_id"]);
  });

  it("treats HTTP 200 without type as a failed send", async () => {
    const result = await sendMsg91OtpSmsWithConfig(
      "+919876543210",
      "123456",
      { authKey: "key", templateId: "tmpl-1" },
      options,
      async () => new Response("{}", { status: 200 }),
    );

    assert.equal(result.configured, true);
    assert.equal(result.success, false);
    assert.equal(result.httpStatus, 200);
    assert.match(result.error ?? "", /returned 200/);
  });

  it("treats type: error as a failed send", async () => {
    const result = await sendMsg91OtpSmsWithConfig(
      "+919876543210",
      "123456",
      { authKey: "key", templateId: "tmpl-1" },
      options,
      async () => new Response(JSON.stringify({ type: "error", message: "invalid template" }), { status: 200 }),
    );

    assert.equal(result.configured, true);
    assert.equal(result.success, false);
    assert.match(result.error ?? "", /invalid template/);
  });

  it("treats type: fail and hasError as a failed send", async () => {
    const failResult = await sendMsg91OtpSmsWithConfig(
      "+919876543210",
      "123456",
      { authKey: "key", templateId: "tmpl-1" },
      options,
      async () => new Response(JSON.stringify({ type: "fail" }), { status: 200 }),
    );
    assert.equal(failResult.success, false);

    const hasErrorResult = await sendMsg91OtpSmsWithConfig(
      "+919876543210",
      "123456",
      { authKey: "key", templateId: "tmpl-1" },
      options,
      async () => new Response(JSON.stringify({ hasError: true }), { status: 200 }),
    );
    assert.equal(hasErrorResult.success, false);
  });
});

describe("sanitizeMsg91OtpResponseBody", () => {
  it("redacts otp and authkey and keeps other keys", () => {
    const sanitized = sanitizeMsg91OtpResponseBody({
      type: "success",
      otp: "123456",
      authkey: "secret",
      request_id: "abc",
    });
    assert.deepEqual(sanitized, {
      type: "success",
      otp: "[redacted]",
      authkey: "[redacted]",
      request_id: "abc",
    });
  });
});
