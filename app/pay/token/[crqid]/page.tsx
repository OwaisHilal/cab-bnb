import type { ReactNode } from "react"
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server"
import { formatInr } from "@/lib/whatsapp/formatInr"
import { getAppBaseUrl } from "@/lib/utils/appUrl"
import { CashfreeCheckoutButton } from "@/features/token-payment/components/CashfreeCheckoutButton"
import { RefreshStatusButton } from "@/features/token-payment/components/RefreshStatusButton"

export const metadata = {
  title: "Pay ₹99 token — KMR Cabs",
}

// Cashfree's webhook (server-to-server) is the only thing allowed to mark
// an intent paid — always read this fresh from the DB, never cache.
export const dynamic = "force-dynamic"

interface TokenPaymentIntentRow {
  status: string
  amount_inr: number
  payment_session_id: string | null
  cashfree_order_status: string | null
}

async function loadPaymentIntent(crqid: string): Promise<TokenPaymentIntentRow | null> {
  const supabase = getSupabaseServiceRoleClient()
  const { data, error } = await supabase
    .from("whatsapp_payment_intents")
    .select("status, amount_inr, payment_session_id, cashfree_order_status")
    .eq("id", crqid)
    .maybeSingle()

  if (error) {
    console.error("[pay/token] failed to load payment intent", { crqid, error: error.message })
    return null
  }

  return (data as TokenPaymentIntentRow | null) ?? null
}

function PaymentPageShell({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-kmr-backdrop px-6 py-12">
      <div className="w-full max-w-sm rounded-md bg-white p-6 text-center shadow-sm">{children}</div>
    </main>
  )
}

function BackToWhatsAppHint() {
  return (
    <p className="mt-2 font-archivo text-sm text-kmr-muted-1">
      Please go back to WhatsApp and tap &ldquo;Select vendor&rdquo; again to get a fresh payment link.
    </p>
  )
}

export default async function TokenPaymentPage({
  params,
  searchParams,
}: {
  params: Promise<{ crqid: string }>
  searchParams: Promise<{ order_id?: string | string[] }>
}) {
  const { crqid } = await params
  const { order_id: orderIdParam } = await searchParams
  const returningFromCheckout = Boolean(orderIdParam)

  const intent = await loadPaymentIntent(crqid)

  if (!intent) {
    return (
      <PaymentPageShell>
        <h1 className="font-archivo text-lg font-bold text-kmr-ink">Payment link not found</h1>
        <BackToWhatsAppHint />
      </PaymentPageShell>
    )
  }

  if (intent.status === "paid") {
    return (
      <PaymentPageShell>
        <h1 className="font-archivo text-lg font-bold text-kmr-green">Payment received</h1>
        <p className="mt-2 font-archivo text-sm text-kmr-muted-1">
          Your {formatInr(intent.amount_inr)} token is confirmed. Check WhatsApp for your booking details.
        </p>
      </PaymentPageShell>
    )
  }

  const orderIsPayable = Boolean(intent.payment_session_id) && intent.cashfree_order_status === "ACTIVE"

  if (!orderIsPayable) {
    return (
      <PaymentPageShell>
        <h1 className="font-archivo text-lg font-bold text-kmr-ink">
          {returningFromCheckout ? "Confirming your payment…" : "This payment link needs a refresh"}
        </h1>
        <p className="mt-2 font-archivo text-sm text-kmr-muted-1">
          {returningFromCheckout
            ? "If you already paid, you'll get a WhatsApp message shortly. This can take a few seconds."
            : "This link has expired or was already used."}
        </p>
        <div className="mt-4 flex flex-col items-center gap-3">
          {returningFromCheckout && <RefreshStatusButton />}
          <BackToWhatsAppHint />
        </div>
      </PaymentPageShell>
    )
  }

  const appBaseUrl = getAppBaseUrl()
  const environment: "sandbox" | "production" =
    process.env.CASHFREE_ENVIRONMENT?.trim().toLowerCase() === "sandbox" ? "sandbox" : "production"

  return (
    <PaymentPageShell>
      <h1 className="font-archivo text-lg font-bold text-kmr-ink">
        Pay {formatInr(intent.amount_inr)} to lock this cab
      </h1>
      <p className="mt-2 font-archivo text-sm text-kmr-muted-1">Secure checkout powered by Cashfree.</p>
      <div className="mt-6">
        <CashfreeCheckoutButton
          paymentSessionId={intent.payment_session_id as string}
          returnUrl={`${appBaseUrl}/pay/token/${crqid}?order_id={order_id}`}
          environment={environment}
        />
      </div>
    </PaymentPageShell>
  )
}
