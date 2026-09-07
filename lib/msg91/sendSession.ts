import "server-only"

import {
  resolveMsg91SendCredentials,
  sendMsg91CtaUrlWithConfig,
  sendMsg91ImageWithConfig,
  sendMsg91InteractiveButtonWithConfig,
  sendMsg91InteractiveListWithConfig,
  sendMsg91PaymentLinkWithConfig,
  sendMsg91TextWithConfig,
} from "./pure"
import type {
  Msg91SendResult,
  SendMsg91CtaUrlInput,
  SendMsg91ImageInput,
  SendMsg91InteractiveInput,
  SendMsg91InteractiveListInput,
  SendMsg91PaymentLinkInput,
  SendMsg91TextInput,
} from "./types"

function readMsg91Credentials() {
  return resolveMsg91SendCredentials({
    MSG91_AUTH_KEY: process.env.MSG91_AUTH_KEY,
    MSG91_WHATSAPP_INTEGRATED_NUMBER: process.env.MSG91_WHATSAPP_INTEGRATED_NUMBER,
  })
}

export function isMsg91WhatsAppConfigured(): boolean {
  return readMsg91Credentials() !== null
}

export async function sendMsg91InteractiveButtonMessage(
  input: SendMsg91InteractiveInput,
): Promise<Msg91SendResult> {
  return sendMsg91InteractiveButtonWithConfig(input, readMsg91Credentials())
}

export async function sendMsg91InteractiveCtaUrlMessage(
  input: SendMsg91CtaUrlInput,
): Promise<Msg91SendResult> {
  return sendMsg91CtaUrlWithConfig(input, readMsg91Credentials())
}

export async function sendMsg91InteractiveListMessage(
  input: SendMsg91InteractiveListInput,
): Promise<Msg91SendResult> {
  return sendMsg91InteractiveListWithConfig(input, readMsg91Credentials())
}

export async function sendMsg91PaymentLinkMessage(
  input: SendMsg91PaymentLinkInput,
): Promise<Msg91SendResult> {
  return sendMsg91PaymentLinkWithConfig(input, readMsg91Credentials())
}

export async function sendMsg91TextMessage(input: SendMsg91TextInput): Promise<Msg91SendResult> {
  return sendMsg91TextWithConfig(input, readMsg91Credentials())
}

export async function sendMsg91ImageMessage(input: SendMsg91ImageInput): Promise<Msg91SendResult> {
  return sendMsg91ImageWithConfig(input, readMsg91Credentials())
}
