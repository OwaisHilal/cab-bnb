import "server-only";

import { OTP_CODE_LENGTH, OTP_EXPIRY_SECONDS } from "@/lib/otp/config";
import { resolveMsg91OtpSmsCredentials, sendMsg91OtpSmsWithConfig, type SendOtpSmsResult } from "./pure";
import { lookupMsg91OtpDelivery } from "./lookupOtpDelivery";
import { phoneLast4 } from "@/lib/utils/phone";

export interface SmsProvider {
  sendOtp(phoneE164: string, code: string): Promise<SendOtpSmsResult>;
}

const otpExpiryMinutes = Math.max(1, Math.round(OTP_EXPIRY_SECONDS / 60));

/**
 * MSG91 SendOTP (SMS). docs.msg91.com/otp/sendotp
 * Requires MSG91_AUTH_KEY + MSG91_OTP_TEMPLATE_ID (OTP section template id,
 * not the WhatsApp template name). We generate the code and pass it as `otp`
 * so app/api/otp/verify can keep local hash verification.
 */
export async function sendOtpSms(phoneE164: string, code: string): Promise<SendOtpSmsResult> {
  const authKeySet = Boolean(process.env.MSG91_AUTH_KEY?.trim());
  const templateId = process.env.MSG91_OTP_TEMPLATE_ID?.trim() || null;
  const last4 = phoneLast4(phoneE164);
  const digits = phoneE164.replace(/\D/g, "");
  console.info("[otp sms] config", { authKeySet, templateId });
  // #region agent log
  fetch("http://127.0.0.1:7828/ingest/95a77bd1-9ab2-4b73-9ea7-97e60a581348",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"89bbe3"},body:JSON.stringify({sessionId:"89bbe3",runId:"pre-fix",hypothesisId:"C",location:"lib/sms/sendOtpSms.ts:send",message:"SMS send start",data:{last4,digitCount:digits.length,startsWith91:digits.startsWith("91")},timestamp:Date.now()})}).catch(()=>{});
  // #endregion

  const result = await sendMsg91OtpSmsWithConfig(
    phoneE164,
    code,
    resolveMsg91OtpSmsCredentials({
      MSG91_AUTH_KEY: process.env.MSG91_AUTH_KEY,
      MSG91_OTP_TEMPLATE_ID: process.env.MSG91_OTP_TEMPLATE_ID,
    }),
    { otpLength: OTP_CODE_LENGTH, otpExpiryMinutes },
  );

  console.info("[otp sms] result", {
    configured: result.configured,
    success: result.success,
    httpStatus: result.httpStatus,
    type: result.msg91Type,
    message: result.msg91Message,
    requestId: result.requestId,
    bodyKeys: result.bodyKeys,
    body: result.sanitizedBody,
  });
  // #region agent log
  fetch("http://127.0.0.1:7828/ingest/95a77bd1-9ab2-4b73-9ea7-97e60a581348",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"89bbe3"},body:JSON.stringify({sessionId:"89bbe3",runId:"pre-fix",hypothesisId:"B",location:"lib/sms/sendOtpSms.ts:result",message:"MSG91 SendOTP result",data:{success:result.success,httpStatus:result.httpStatus,type:result.msg91Type,requestId:result.requestId,bodyKeys:result.bodyKeys},timestamp:Date.now()})}).catch(()=>{});
  // #endregion

  const authKey = process.env.MSG91_AUTH_KEY?.trim();
  if (authKey && result.requestId) {
    try {
      const delivery = await lookupMsg91OtpDelivery({
        authKey,
        requestId: result.requestId,
        last4,
      });
      console.info("[otp sms] delivery lookup", {
        httpStatus: delivery.httpStatus,
        rowCount: delivery.rowCount,
        matchByRequestId: delivery.matchByRequestId,
        matchByLast4: delivery.matchByLast4,
        smsHttpStatus: delivery.smsHttpStatus,
        smsRowCount: delivery.smsRowCount,
        smsMatchByRequestId: delivery.smsMatchByRequestId,
        smsMatchByLast4: delivery.smsMatchByLast4,
      });
      // #region agent log
      fetch("http://127.0.0.1:7828/ingest/95a77bd1-9ab2-4b73-9ea7-97e60a581348",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"89bbe3"},body:JSON.stringify({sessionId:"89bbe3",runId:"post-fix",hypothesisId:"B",location:"lib/sms/sendOtpSms.ts:lookup",message:"MSG91 OTP log match",data:{rowCount:delivery.rowCount,metadata:delivery.metadata,matchByRequestId:delivery.matchByRequestId,matchByLast4:delivery.matchByLast4,last4},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      // #region agent log
      fetch("http://127.0.0.1:7828/ingest/95a77bd1-9ab2-4b73-9ea7-97e60a581348",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"89bbe3"},body:JSON.stringify({sessionId:"89bbe3",runId:"post-fix",hypothesisId:"G",location:"lib/sms/sendOtpSms.ts:sms-lookup",message:"MSG91 SMS report match",data:{smsRowCount:delivery.smsRowCount,smsHttpStatus:delivery.smsHttpStatus,smsMatchByRequestId:delivery.smsMatchByRequestId,smsMatchByLast4:delivery.smsMatchByLast4,otpLast4s:delivery.otpLast4s,smsLast4s:delivery.smsLast4s,last4},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      // #region agent log
      fetch("http://127.0.0.1:7828/ingest/95a77bd1-9ab2-4b73-9ea7-97e60a581348",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"89bbe3"},body:JSON.stringify({sessionId:"89bbe3",runId:"post-fix",hypothesisId:"J",location:"lib/sms/sendOtpSms.ts:flow-ids",message:"MSG91 OTP log flow vs configured template",data:{otpFlowIds:delivery.otpFlowIds,otpCampaignNames:delivery.otpCampaignNames,otpIsApiValues:delivery.otpIsApiValues,configuredTemplateId:templateId},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
    } catch (error) {
      // #region agent log
      fetch("http://127.0.0.1:7828/ingest/95a77bd1-9ab2-4b73-9ea7-97e60a581348",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"89bbe3"},body:JSON.stringify({sessionId:"89bbe3",runId:"pre-fix",hypothesisId:"E",location:"lib/sms/sendOtpSms.ts:lookup-error",message:"OTP log lookup failed",data:{error:error instanceof Error ? error.message : "unknown"},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
    }
  }

  return result;
}
