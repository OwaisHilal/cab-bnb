export function formatInr(amount: number): string {
  return `\u20b9${amount.toLocaleString("en-IN")}`
}

export const TOKEN_LOCK_AMOUNT = 99
export const WHATSAPP_BUTTON_TITLE_MAX = 20

export function formatWhatsAppPayButtonTitle(amountInr: number): string {
  return `Pay ${formatInr(amountInr)} Now`.slice(0, WHATSAPP_BUTTON_TITLE_MAX)
}
