export type CashfreeCheckoutEnvironment = "sandbox" | "production"

export const canLaunchCheckout = (input: {
  paymentSessionId?: string | null
  returnUrl?: string | null
  environment?: string | null
}): input is {
  paymentSessionId: string
  returnUrl: string
  environment: CashfreeCheckoutEnvironment
} => {
  if (!input.paymentSessionId || !input.returnUrl) return false
  return input.environment === "sandbox" || input.environment === "production"
}
