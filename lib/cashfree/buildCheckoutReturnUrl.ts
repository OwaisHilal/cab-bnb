export type CheckoutConfirming = "token" | "balance"

export interface BuildCheckoutReturnUrlInput {
  appBaseUrl: string
  confirming: CheckoutConfirming
  sessionId: string
}

export const buildCheckoutReturnUrl = (input: BuildCheckoutReturnUrlInput): string => {
  const confirming = input.confirming === "balance" ? "balance" : "token"
  return `${input.appBaseUrl}/?continue=1&confirming=${confirming}&sid=${encodeURIComponent(input.sessionId)}`
}
