"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import { cn } from "@/lib/utils/cn"
import type { AdminDebugFeed, AdminDebugTripRequest } from "@/features/admin-debug/types"
import {
  TripWhatsAppDebugger,
  WhatsAppDebugSection,
} from "@/features/admin-debug/components/WhatsAppDebugSection"
import { AdminMessagingFlowPanel } from "@/features/admin-debug/components/AdminMessagingFlowPanel"
import {
  filterFlowEligibleTrips,
  FlowTripSelect,
  formatFlowTripSummary,
} from "@/features/admin-debug/components/FlowTripSelect"

const POLL_INTERVAL_MS = 3000

type AdminPageTab = "trips" | "flow" | "bookings" | "whatsapp"

const PAGE_TABS: Array<{ id: AdminPageTab; label: string }> = [
  { id: "trips", label: "Trips" },
  { id: "flow", label: "WhatsApp flow" },
  { id: "bookings", label: "Bookings" },
  { id: "whatsapp", label: "WA log" },
]

async function fetchDebugFeed(): Promise<
  { ok: true; data: AdminDebugFeed } | { ok: false; error: string }
> {
  try {
    const response = await fetch("/api/admin/debug/feed")
    const data = (await response.json().catch(() => null)) as AdminDebugFeed | { error?: string } | null

    if (!response.ok) {
      return { ok: false, error: (data as { error?: string } | null)?.error ?? "Failed to load debug feed" }
    }

    return { ok: true, data: data as AdminDebugFeed }
  } catch {
    return { ok: false, error: "Network error while loading debug feed" }
  }
}

const TRIP_STATUS_LABELS: Record<string, string> = {
  matching: "Matching",
  quotes_ready: "Awaiting OTP",
  otp_pending: "Verified · WA queued",
  quotes_sent: "Quotes sent",
  negotiating: "Negotiating",
  booked: "Booked",
  expired: "Expired",
  abandoned: "Abandoned",
}

const TRIP_STATUS_STYLES: Record<string, string> = {
  matching: "bg-kmr-muted-3/20 text-kmr-muted-1",
  quotes_ready: "bg-kmr-blue/10 text-kmr-blue",
  otp_pending: "bg-kmr-orange/15 text-kmr-orange-dark",
  quotes_sent: "bg-kmr-green/15 text-kmr-green-dark",
  negotiating: "bg-kmr-blue/15 text-kmr-blue-dark",
  booked: "bg-kmr-green/20 text-kmr-green-dark",
  expired: "bg-black/10 text-kmr-muted-2",
  abandoned: "bg-black/10 text-kmr-muted-2",
}

function formatInr(amount: number): string {
  return `\u20b9${amount.toLocaleString("en-IN")}`
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

function shortId(id: string): string {
  return id.slice(0, 8).toUpperCase()
}

export function AdminDebugPanel() {
  const [feed, setFeed] = useState<AdminDebugFeed | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<AdminPageTab>("trips")
  const [flowTripId, setFlowTripId] = useState<string | null>(null)

  const applyFeedResult = useCallback((result: Awaited<ReturnType<typeof fetchDebugFeed>>) => {
    if (result.ok) {
      setFeed(result.data)
      setError(null)
      return
    }

    setError(result.error)
  }, [])

  const handleRefresh = useCallback(async () => {
    setIsLoading(true)
    applyFeedResult(await fetchDebugFeed())
    setIsLoading(false)
  }, [applyFeedResult])

  useEffect(() => {
    let cancelled = false

    const tick = async () => {
      const result = await fetchDebugFeed()
      if (cancelled) return
      applyFeedResult(result)
      setIsLoading(false)
    }

    void tick()
    const timer = setInterval(() => {
      void tick()
    }, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [applyFeedResult])

  const flowEligibleTrips = useMemo(
    () => filterFlowEligibleTrips(feed?.trip_requests ?? []),
    [feed?.trip_requests],
  )

  const stats = useMemo(() => {
    return {
      total: flowEligibleTrips.length,
      awaitingOtp: flowEligibleTrips.filter((row) => row.status === "otp_pending" || row.status === "quotes_ready").length,
      quotesSent: flowEligibleTrips.filter((row) => row.status === "quotes_sent" || row.status === "negotiating").length,
      bookings: feed?.bookings.length ?? 0,
    }
  }, [feed?.bookings.length, flowEligibleTrips])

  const handleToggleExpand = (id: string) => {
    setExpandedId((current) => (current === id ? null : id))
  }

  useEffect(() => {
    if (!feed || flowEligibleTrips.length === 0) {
      if (flowTripId) setFlowTripId(null)
      return
    }
    if (flowTripId && flowEligibleTrips.some((row) => row.id === flowTripId)) return
    setFlowTripId(flowEligibleTrips[0]?.id ?? null)
  }, [feed, flowEligibleTrips, flowTripId])

  const handleOpenFlowTab = (tripRequestId: string) => {
    setFlowTripId(tripRequestId)
    setActiveTab("flow")
  }

  return (
    <div className="min-h-dvh bg-kmr-backdrop">
      <header className="border-b border-black/10 bg-white px-4 py-4 md:px-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[9px] font-semibold tracking-[1.5px] text-kmr-orange">
              DEMO OPS CONSOLE
            </span>
            <h1 className="font-archivo text-2xl font-extrabold tracking-[-0.5px] text-kmr-ink">
              Live booking debug
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 rounded-sm bg-kmr-green/15 px-2.5 py-1 font-mono text-[9px] font-semibold tracking-[1px] text-kmr-green-dark">
              <span className="size-1.5 animate-kmr-pulse rounded-full bg-kmr-green" />
              LIVE · {POLL_INTERVAL_MS / 1000}s
            </span>
            <button
              type="button"
              onClick={() => {
                void handleRefresh()
              }}
              className="rounded-sm bg-kmr-surface px-3 py-2 font-archivo text-xs font-bold text-kmr-ink"
            >
              Refresh
            </button>
            <Link
              href="/"
              className="rounded-sm bg-kmr-blue px-3 py-2 font-archivo text-xs font-bold text-white"
            >
              Customer app
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 md:px-8">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Trip requests" value={stats.total} />
          <StatCard label="Awaiting OTP" value={stats.awaitingOtp} accent="orange" />
          <StatCard label="Quotes active" value={stats.quotesSent} accent="blue" />
          <StatCard label="Bookings" value={stats.bookings} accent="green" />
        </div>

        {error && (
          <div className="mt-4 rounded-sm bg-kmr-orange/10 px-4 py-3 font-mono text-xs font-semibold text-kmr-orange-dark">
            {error}
          </div>
        )}

        {isLoading && !feed && (
          <p className="mt-6 font-archivo text-sm font-medium text-kmr-muted-2">Loading feed…</p>
        )}

        {feed && (
          <>
            <nav
              className="mt-6 flex flex-wrap gap-1.5 border-b border-black/10 pb-3"
              role="tablist"
              aria-label="Admin debug sections"
            >
              {PAGE_TABS.map((tab) => {
                const isActive = activeTab === tab.id
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      "rounded-full px-4 py-2 font-archivo text-xs font-bold transition-colors",
                      isActive ? "bg-kmr-ink text-white" : "bg-white text-kmr-muted-1 hover:bg-kmr-surface",
                    )}
                  >
                    {tab.label}
                  </button>
                )
              })}
            </nav>

            {activeTab === "trips" && (
            <section className="mt-6">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="font-archivo text-lg font-extrabold tracking-[-0.3px] text-kmr-ink">
                  Incoming trip requests
                </h2>
                <span className="font-mono text-[9px] font-medium tracking-[1px] text-kmr-muted-3">
                  Updated {formatTime(feed.fetched_at)}
                </span>
              </div>

              {flowEligibleTrips.length === 0 ? (
                <EmptyState
                  message={
                    feed.trip_requests.length === 0
                      ? "No trip requests yet — submit one from the customer app."
                      : "No trips with verified phone yet — complete OTP on the customer app."
                  }
                />
              ) : (
                <div className="flex flex-col gap-2">
                  {flowEligibleTrips.map((request) => (
                    <TripRequestCard
                      key={request.id}
                      request={request}
                      expanded={expandedId === request.id}
                      whatsapp={feed.whatsapp}
                      onToggle={() => handleToggleExpand(request.id)}
                      onOpenFlow={() => handleOpenFlowTab(request.id)}
                      onWhatsAppSent={() => {
                        void handleRefresh()
                      }}
                    />
                  ))}
                </div>
              )}
            </section>
            )}

            {activeTab === "flow" && (
              <section className="mt-6">
                <div className="mb-4 flex flex-col gap-3 rounded-sm border border-black/10 bg-white p-4">
                  <div>
                    <h2 className="font-archivo text-lg font-extrabold tracking-[-0.3px] text-kmr-ink">
                      WhatsApp flow
                    </h2>
                    <p className="mt-1 font-archivo text-xs font-medium text-kmr-muted-2">
                      Filter by status, pick a trip, then Guest · Nova · Driver.
                    </p>
                  </div>

                  {feed.trip_requests.length === 0 ? (
                    <EmptyState message="No trip requests yet — start a booking on the customer app." />
                  ) : (
                    <>
                      <FlowTripSelect
                        trips={feed.trip_requests}
                        value={flowTripId}
                        onChange={setFlowTripId}
                      />
                      {flowTripId && flowEligibleTrips.some((row) => row.id === flowTripId) && (
                        <p className="font-archivo text-xs text-kmr-muted-2">
                          {formatFlowTripSummary(
                            flowEligibleTrips.find((row) => row.id === flowTripId) ??
                              flowEligibleTrips[0],
                          )}
                        </p>
                      )}
                    </>
                  )}
                </div>

                {flowTripId && flowEligibleTrips.some((row) => row.id === flowTripId) && (
                  <AdminMessagingFlowPanel tripRequestId={flowTripId} />
                )}
              </section>
            )}

            {activeTab === "bookings" && (
            <section className="mt-6">
              <h2 className="mb-3 font-archivo text-lg font-extrabold tracking-[-0.3px] text-kmr-ink">
                Bookings
              </h2>
              {feed.bookings.length === 0 ? (
                <EmptyState message="No finalized bookings yet — they appear after WhatsApp finalize flow." />
              ) : (
                <div className="overflow-x-auto rounded-sm border border-black/10 bg-white">
                  <table className="min-w-full text-left">
                    <thead>
                      <tr className="border-b border-black/10 bg-kmr-surface font-mono text-[8.5px] font-semibold tracking-[1px] text-kmr-muted-2">
                        <th className="px-3 py-2">Ref</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2">Phone</th>
                        <th className="px-3 py-2">Vendor</th>
                        <th className="px-3 py-2">Quote</th>
                        <th className="px-3 py-2">Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {feed.bookings.map((booking) => (
                        <tr key={booking.id} className="border-b border-black/5 font-archivo text-sm">
                          <td className="px-3 py-2.5 font-mono text-xs font-bold">{booking.booking_ref}</td>
                          <td className="px-3 py-2.5">
                            <StatusBadge status={booking.status} />
                          </td>
                          <td className="px-3 py-2.5 font-mono text-xs">{booking.tourist_phone ?? "—"}</td>
                          <td className="px-3 py-2.5">{booking.vendor_name ?? "—"}</td>
                          <td className="px-3 py-2.5 font-mono text-xs font-bold">
                            {booking.final_quote ? formatInr(booking.final_quote) : "—"}
                          </td>
                          <td className="px-3 py-2.5 font-mono text-[10px] text-kmr-muted-2">
                            {formatTime(booking.created_at)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            )}

            {activeTab === "whatsapp" && feed.whatsapp && (
              <div className="mt-6">
                <WhatsAppDebugSection whatsapp={feed.whatsapp} />
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string
  value: number
  accent?: "orange" | "blue" | "green"
}) {
  const accentClass =
    accent === "orange"
      ? "text-kmr-orange-dark"
      : accent === "blue"
        ? "text-kmr-blue"
        : accent === "green"
          ? "text-kmr-green-dark"
          : "text-kmr-ink"

  return (
    <div className="rounded-sm bg-white p-4 shadow-sm">
      <span className="font-mono text-[8.5px] font-semibold tracking-[1.2px] text-kmr-muted-3">{label}</span>
      <span className={cn("mt-1 block font-archivo text-3xl font-extrabold tracking-[-0.5px]", accentClass)}>
        {value}
      </span>
    </div>
  )
}

function TripRequestCard({
  request,
  expanded,
  whatsapp,
  onToggle,
  onOpenFlow,
  onWhatsAppSent,
}: {
  request: AdminDebugTripRequest
  expanded: boolean
  whatsapp: AdminDebugFeed["whatsapp"]
  onToggle: () => void
  onOpenFlow: () => void
  onWhatsAppSent: () => void
}) {
  return (
    <article className="rounded-sm border border-black/10 bg-white">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full flex-col gap-2 px-4 py-3 text-left md:flex-row md:items-center md:justify-between"
        aria-expanded={expanded}
      >
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[9px] font-semibold tracking-[1px] text-kmr-muted-3">
            REQ-{shortId(request.id)}
          </span>
          <span className="font-archivo text-base font-bold text-kmr-ink">
            {request.trip_days} days · {request.pax_count} pax · {request.requested_vehicle_type_label ?? "Vehicle TBD"}
          </span>
          <span className="font-mono text-[10px] text-kmr-muted-2">
            {request.tourist_phone} · start {request.trip_start_date}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={request.status} />
          <span className="font-mono text-xs font-bold text-kmr-blue">
            {request.quote_count} quotes
            {request.best_quote ? ` · best ${formatInr(request.best_quote)}` : ""}
          </span>
          <span className="font-mono text-[9px] text-kmr-muted-3">{formatTime(request.created_at)}</span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-black/5 bg-kmr-surface/50 px-4 py-3">
          <dl className="grid gap-2 font-mono text-[10px] text-kmr-muted-1 md:grid-cols-2">
            <div>
              <dt className="text-kmr-muted-3">Session</dt>
              <dd className="break-all">{request.session_id}</dd>
            </div>
            <div>
              <dt className="text-kmr-muted-3">Trip request id</dt>
              <dd className="break-all">{request.id}</dd>
            </div>
            {request.recommendation_reason && (
              <div className="md:col-span-2">
                <dt className="text-kmr-muted-3">Recommendation</dt>
                <dd>{request.recommendation_reason}</dd>
              </div>
            )}
          </dl>
          {request.quotes.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1.5">
              {request.quotes.map((quote) => (
                <li
                  key={quote.id}
                  className={cn(
                    "flex items-center justify-between rounded-sm px-3 py-2 font-archivo text-sm",
                    quote.is_best_price ? "bg-kmr-blue/10" : "bg-white",
                  )}
                >
                  <span className="font-bold text-kmr-ink">
                    {quote.vendor_name}
                    {quote.is_best_price ? " · BEST" : ""}
                  </span>
                  <span className="font-mono text-xs font-bold">{formatInr(quote.current_quote)}</span>
                </li>
              ))}
            </ul>
          )}
          {whatsapp && (
            <TripWhatsAppDebugger request={request} whatsapp={whatsapp} onSent={onWhatsAppSent} />
          )}
          <button
            type="button"
            onClick={onOpenFlow}
            className="mt-3 w-full rounded-sm bg-kmr-ink px-3 py-2 font-archivo text-xs font-bold text-white"
          >
            Open WhatsApp flow (Guest · Nova · Driver)
          </button>
        </div>
      )}
    </article>
  )
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "rounded-sm px-2 py-0.5 font-mono text-[8.5px] font-bold tracking-[0.8px] uppercase",
        TRIP_STATUS_STYLES[status] ?? "bg-kmr-surface text-kmr-muted-1",
      )}
    >
      {TRIP_STATUS_LABELS[status] ?? status.replaceAll("_", " ")}
    </span>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-sm border border-dashed border-black/15 bg-white px-4 py-8 text-center">
      <p className="font-archivo text-sm font-medium text-kmr-muted-2">{message}</p>
    </div>
  )
}
