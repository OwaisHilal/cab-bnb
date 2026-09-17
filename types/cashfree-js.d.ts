/**
 * `@cashfreepayments/cashfree-js` ships no TypeScript types (its
 * package.json has no "types"/"typings" field — see
 * node_modules/@cashfreepayments/cashfree-js/package.json) — this covers
 * only the surface features/token-payment/components/CashfreeCheckoutButton.tsx
 * actually calls. See https://docs.cashfree.com/docs/js-integration.
 */
declare module "@cashfreepayments/cashfree-js" {
  export interface CashfreeCheckoutOptions {
    paymentSessionId: string
    returnUrl?: string
    redirectTarget?: "_self" | "_blank" | "_top" | "_modal" | HTMLElement
  }

  export interface CashfreeCheckoutError {
    message?: string
    [key: string]: unknown
  }

  export interface CashfreeCheckoutResult {
    error?: CashfreeCheckoutError
    redirect?: boolean
    paymentDetails?: { paymentMessage?: string; [key: string]: unknown }
  }

  export interface CashfreeInstance {
    checkout(options: CashfreeCheckoutOptions): Promise<CashfreeCheckoutResult>
  }

  export interface CashfreeLoadOptions {
    mode: "sandbox" | "production"
  }

  /** Resolves to `null` when called outside a browser environment. */
  export function load(options: CashfreeLoadOptions): Promise<CashfreeInstance | null>
}
