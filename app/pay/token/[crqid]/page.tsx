import type { ReactNode } from "react"
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server"
import { formatInr } from "@/lib/whatsapp/formatInr"
import { getAppBaseUrl } from "@/lib/utils/appUrl"
import { CashfreeCheckoutButton } from "@/features/token-payment/components/CashfreeCheckoutButton"
import { RefreshStatusButton } from "@/features/token-payment/components/RefreshStatusButton"
import { Spinner } from "@/components/ui/Spinner"
import { StepTracker } from "@/components/ui/StepTracker"
import { TopBar } from "@/components/ui/TopBar"
import { CheckIcon, InfoIcon, LockIcon, ShieldCheckIcon } from "@/components/ui/icons"

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
  purpose: string | null
  trip_request_id: string | null
}

async function loadPaymentIntent(crqid: string): Promise<TokenPaymentIntentRow | null> {
  const supabase = getSupabaseServiceRoleClient()
  const { data, error } = await supabase
    .from("whatsapp_payment_intents")
    .select("status, amount_inr, payment_session_id, cashfree_order_status, purpose, trip_request_id")
    .eq("id", crqid)
    .maybeSingle()

  if (error) {
    console.error("[pay/token] failed to load payment intent", { crqid, error: error.message })
    return null
  }

  return (data as TokenPaymentIntentRow | null) ?? null
}

function PaymentPageShell({ children, stepIndex }: { children: ReactNode; stepIndex?: number }) {
  return (
    <main className="flex min-h-dvh justify-center bg-kmr-backdrop">
      <div className="flex min-h-dvh w-full max-w-[430px] flex-col gap-6 bg-white px-[30px] py-[30px] shadow-[0_0_40px_rgba(16,17,24,0.12)] animate-kmr-fade">
        <TopBar />
        {stepIndex === undefined ? null : <StepTracker current={stepIndex} />}
        <div className="flex flex-1 flex-col justify-center gap-5 pb-6">{children}</div>
        <p className="flex items-center justify-center gap-1.5 pb-1 text-center font-mono text-[9px] font-semibold tracking-[1px] text-kmr-muted-3">
          <ShieldCheckIcon size={13} className="text-kmr-green-dark" />
          PAYMENTS SECURED BY CASHFREE
        </p>
      </div>
    </main>
  )
}

function PaymentStatusBlock({
  icon,
  tone,
  title,
  description,
  children,
}: {
  icon: ReactNode
  tone: "blue" | "green" | "orange"
  title: string
  description?: string
  children?: ReactNode
}) {
  const toneClasses = {
    blue: "bg-kmr-blue/10 text-kmr-blue",
    green: "bg-kmr-green/10 text-kmr-green-dark",
    orange: "bg-kmr-orange/10 text-kmr-orange",
  }
  return (
    <div role="status" className="flex flex-col items-center gap-3 text-center animate-kmr-reveal">
      <span className={`flex size-16 items-center justify-center rounded-full ${toneClasses[tone]}`}>{icon}</span>
      <h1 className="font-archivo text-[26px] font-extrabold leading-[1.15] tracking-[-0.6px] text-kmr-ink">{title}</h1>
      {description ? (
        <p className="font-archivo text-sm font-medium leading-[1.55] text-kmr-muted-1">{description}</p>
      ) : null}
      {children ? <div className="mt-2 flex flex-col items-center gap-3">{children}</div> : null}
    </div>
  )
}

function TripLink({ href }: { href: string }) {
  return (
    <a href={href} className="font-archivo text-sm font-bold text-kmr-blue underline underline-offset-4">
      Back to your trip
    </a>
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
  const tripHref = (confirming: "token" | "balance" | null) =>
    confirming ? `/?continue=1&confirming=${confirming}` : "/?continue=1"

  if (!intent) {
    return (
      <PaymentPageShell>
        <PaymentStatusBlock icon={<InfoIcon size={30} />} tone="orange" title="Payment link not found">
          <TripLink href="/?continue=1" />
        </PaymentStatusBlock>
      </PaymentPageShell>
    )
  }

  const isBalance = intent.purpose === "balance"
  const confirming = isBalance ? "balance" : "token"
  let tripClosed = false
  if (intent.trip_request_id) {
    const supabase = getSupabaseServiceRoleClient()
    const { data: trip } = await supabase
      .from("trip_requests")
      .select("status")
      .eq("id", intent.trip_request_id)
      .maybeSingle()
    tripClosed = trip?.status === "abandoned" || trip?.status === "expired"
  }

  if (tripClosed) {
    return (
      <PaymentPageShell>
        <PaymentStatusBlock icon={<InfoIcon size={30} />} tone="blue" title="This trip is closed.">
          <TripLink href="/?continue=1" />
        </PaymentStatusBlock>
      </PaymentPageShell>
    )
  }

  if (intent.status === "paid") {
    return (
      <PaymentPageShell stepIndex={isBalance ? 4 : 2}>
        <PaymentStatusBlock
          icon={<CheckIcon size={32} />}
          tone="green"
          title="Payment received"
          description={
            isBalance
              ? `Your ${formatInr(intent.amount_inr)} balance is confirmed.`
              : `Your ${formatInr(intent.amount_inr)} token is confirmed.`
          }
        >
          <TripLink href="/?continue=1" />
        </PaymentStatusBlock>
      </PaymentPageShell>
    )
  }

  const orderIsPayable = Boolean(intent.payment_session_id) && intent.cashfree_order_status === "ACTIVE"

  if (!orderIsPayable) {
    return (
      <PaymentPageShell stepIndex={isBalance ? 3 : 1}>
        <PaymentStatusBlock
          icon={returningFromCheckout ? <Spinner tone="blue" size="lg" /> : <InfoIcon size={30} />}
          tone={returningFromCheckout ? "blue" : "orange"}
          title={returningFromCheckout ? "Confirming your payment…" : "This payment link needs a refresh"}
          description={
            returningFromCheckout
              ? "If you already paid, you'll get a WhatsApp message shortly. This can take a few seconds. Please don't close this page."
              : "This link has expired or was already used."
          }
        >
          {returningFromCheckout && <RefreshStatusButton />}
          <TripLink href={returningFromCheckout ? tripHref(confirming) : "/?continue=1"} />
        </PaymentStatusBlock>
      </PaymentPageShell>
    )
  }

  const appBaseUrl = getAppBaseUrl()
  const environment: "sandbox" | "production" =
    process.env.CASHFREE_ENVIRONMENT?.trim().toLowerCase() === "sandbox" ? "sandbox" : "production"

  return (
    <PaymentPageShell stepIndex={isBalance ? 3 : 1}>
      <div className="flex flex-col items-center gap-3 text-center animate-kmr-reveal">
        <span className="flex size-16 items-center justify-center rounded-full bg-kmr-green/10 text-kmr-green-dark">
          <LockIcon size={28} />
        </span>
        <span className="font-mono text-[9px] font-semibold tracking-[1.5px] text-kmr-muted-3">
          {isBalance ? "PAY THE BALANCE" : "PAY THE TOKEN"}
        </span>
        <p className="font-mono text-[44px] font-bold leading-none tracking-[-1.5px] text-kmr-ink">
          {formatInr(intent.amount_inr)}
        </p>
        <h1 className="font-archivo text-[19px] font-extrabold leading-[1.25] tracking-[-0.4px] text-kmr-ink">
          {isBalance
            ? `Pay ${formatInr(intent.amount_inr)} to confirm your booking`
            : `Pay ${formatInr(intent.amount_inr)} to lock this cab`}
        </h1>
        <p className="flex items-center gap-1.5 rounded-full bg-kmr-surface px-3 py-1.5 font-archivo text-[12.5px] font-semibold text-kmr-muted-1">
          <ShieldCheckIcon size={14} className="text-kmr-green-dark" />
          Secure checkout powered by Cashfree.
        </p>
      </div>
      <div className="mt-2">
        <CashfreeCheckoutButton
          paymentSessionId={intent.payment_session_id as string}
          returnUrl={`${appBaseUrl}/?continue=1&confirming=${confirming}`}
          environment={environment}
          amountInr={intent.amount_inr}
        />
      </div>
    </PaymentPageShell>
  )
}
