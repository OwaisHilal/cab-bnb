"use client"

import { useCallback, useEffect, useState } from "react"
import { cn } from "@/lib/utils/cn"
import type {
  AdminDebugTripRequest,
  AdminDebugWhatsAppFeed,
  AdminDebugWhatsAppPreview,
  AdminDebugWhatsAppSendResult,
} from "@/features/admin-debug/types"

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

export function WhatsAppDebugSection({ whatsapp }: { whatsapp: AdminDebugWhatsAppFeed }) {
  return (
    <section className="mt-10">
      <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="font-archivo text-lg font-extrabold tracking-[-0.3px] text-kmr-ink">
            WhatsApp debugger
          </h2>
          <p className="font-archivo text-xs font-medium text-kmr-muted-2">
            Global message log — expand a trip for full Guest · Nova · Driver flow.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ConfigPill
            label={
              whatsapp.whatsapp_configured
                ? whatsapp.whatsapp_provider === "msg91"
                  ? "MSG91 WhatsApp configured"
                  : "Meta Cloud API configured"
                : "WhatsApp not configured"
            }
            tone={whatsapp.whatsapp_configured ? "green" : "muted"}
          />
          {whatsapp.simulate_when_unconfigured && !whatsapp.whatsapp_configured && (
            <ConfigPill label="Demo simulate enabled" tone="orange" />
          )}
        </div>
      </div>

      {whatsapp.pending_jobs.length > 0 && (
        <div className="mb-4 rounded-sm border border-kmr-orange/20 bg-kmr-orange/5 p-4">
          <span className="font-mono text-[8.5px] font-semibold tracking-[1.2px] text-kmr-orange-dark">
            QUEUED SEND_QUOTES JOBS
          </span>
          <ul className="mt-2 flex flex-col gap-1.5">
            {whatsapp.pending_jobs.map((job) => (
              <li key={job.id} className="font-mono text-[10px] text-kmr-muted-1">
                {job.trip_request_id ? `REQ-${shortId(job.trip_request_id)}` : job.id} · {job.status}
                {job.attempts > 0 ? ` · ${job.attempts} attempts` : ""}
                {job.last_error ? ` · ${job.last_error}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {whatsapp.messages.length === 0 ? (
        <div className="rounded-sm border border-dashed border-black/15 bg-white px-4 py-8 text-center">
          <p className="font-archivo text-sm font-medium text-kmr-muted-2">
            No WhatsApp messages logged yet — expand a trip request and send a quote message.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-sm border border-black/10 bg-white">
          <table className="min-w-full text-left">
            <thead>
              <tr className="border-b border-black/10 bg-kmr-surface font-mono text-[8.5px] font-semibold tracking-[1px] text-kmr-muted-2">
                <th className="px-3 py-2">Time</th>
                <th className="px-3 py-2">Trip</th>
                <th className="px-3 py-2">Dir</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">WA message id</th>
                <th className="px-3 py-2">Preview</th>
              </tr>
            </thead>
            <tbody>
              {whatsapp.messages.map((message) => (
                <tr key={message.id} className="border-b border-black/5 align-top">
                  <td className="px-3 py-2.5 font-mono text-[10px] text-kmr-muted-2">
                    {formatTime(message.created_at)}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[10px]">
                    {message.trip_request_id ? `REQ-${shortId(message.trip_request_id)}` : "—"}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[10px] uppercase">{message.direction}</td>
                  <td className="px-3 py-2.5">
                    <WaStatusBadge status={message.wa_status} template={message.template_name} />
                  </td>
                  <td className="max-w-[140px] truncate px-3 py-2.5 font-mono text-[10px] text-kmr-muted-1">
                    {message.wa_message_id ?? "—"}
                  </td>
                  <td className="max-w-xs px-3 py-2.5 font-archivo text-xs text-kmr-ink">
                    <pre className="whitespace-pre-wrap font-sans text-[11px] leading-snug text-kmr-muted-1">
                      {message.body_snapshot?.slice(0, 180)}
                      {(message.body_snapshot?.length ?? 0) > 180 ? "…" : ""}
                    </pre>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export function TripWhatsAppDebugger({
  request,
  whatsapp,
  onSent,
}: {
  request: AdminDebugTripRequest
  whatsapp: AdminDebugWhatsAppFeed
  onSent: () => void
}) {
  const [preview, setPreview] = useState<AdminDebugWhatsAppPreview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const [sendResult, setSendResult] = useState<AdminDebugWhatsAppSendResult | null>(null)
  const [isLoadingPreview, setIsLoadingPreview] = useState(false)
  const [isSending, setIsSending] = useState(false)

  const canSend =
    Boolean(request.tourist_phone) &&
    (request.status === "otp_pending" || request.status === "quotes_ready" || request.status === "quotes_sent")

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      setIsLoadingPreview(true)
      setPreviewError(null)

      try {
        const response = await fetch(`/api/admin/debug/whatsapp/preview?trip_request_id=${request.id}`)
        const data = (await response.json().catch(() => null)) as AdminDebugWhatsAppPreview | { error?: string } | null

        if (cancelled) return

        if (!response.ok) {
          setPreview(null)
          setPreviewError((data as { error?: string } | null)?.error ?? "Could not load WhatsApp preview")
          return
        }

        setPreview(data as AdminDebugWhatsAppPreview)
      } catch {
        if (!cancelled) setPreviewError("Network error loading preview")
      } finally {
        if (!cancelled) setIsLoadingPreview(false)
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [request.id])

  const reloadPreview = useCallback(async () => {
    setIsLoadingPreview(true)
    setPreviewError(null)

    try {
      const response = await fetch(`/api/admin/debug/whatsapp/preview?trip_request_id=${request.id}`)
      const data = (await response.json().catch(() => null)) as AdminDebugWhatsAppPreview | { error?: string } | null

      if (!response.ok) {
        setPreview(null)
        setPreviewError((data as { error?: string } | null)?.error ?? "Could not load WhatsApp preview")
        return
      }

      setPreview(data as AdminDebugWhatsAppPreview)
    } catch {
      setPreviewError("Network error loading preview")
    } finally {
      setIsLoadingPreview(false)
    }
  }, [request.id])

  const handleSendWhatsApp = async () => {
    setIsSending(true)
    setSendError(null)
    setSendResult(null)

    try {
      const response = await fetch("/api/admin/debug/whatsapp/send-quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trip_request_id: request.id }),
      })
      const data = (await response.json().catch(() => null)) as AdminDebugWhatsAppSendResult | { error?: string } | null

      if (!response.ok) {
        setSendError((data as { error?: string } | null)?.error ?? "WhatsApp send failed")
        onSent()
        return
      }

      setSendResult(data as AdminDebugWhatsAppSendResult)
      void reloadPreview()
      onSent()
    } catch {
      setSendError("Network error while sending WhatsApp message")
    } finally {
      setIsSending(false)
    }
  }

  return (
    <div className="mt-4 rounded-sm border border-kmr-green/20 bg-kmr-green/5 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <span className="font-mono text-[8.5px] font-semibold tracking-[1.2px] text-kmr-green-dark">
            WHATSAPP TO TOURIST
          </span>
          <p className="mt-1 font-archivo text-xs font-medium text-kmr-muted-1">
            To: {request.tourist_phone ?? "Verify OTP first"}
          </p>
        </div>
        <button
          type="button"
          disabled={!canSend || isSending}
          onClick={() => {
            void handleSendWhatsApp()
          }}
          className="rounded-sm bg-kmr-green px-3 py-2 font-archivo text-xs font-bold text-white disabled:opacity-50"
        >
          {isSending ? "Sending…" : "Send quote WhatsApp"}
        </button>
      </div>

      {!whatsapp.whatsapp_configured && whatsapp.simulate_when_unconfigured && (
        <p className="mt-2 font-mono text-[9px] font-medium tracking-[0.5px] text-kmr-orange-dark">
          WhatsApp Cloud API not configured — demo mode will simulate delivery and log the message.
        </p>
      )}

      {isLoadingPreview && !preview && (
        <p className="mt-3 font-archivo text-xs text-kmr-muted-2">Loading message preview…</p>
      )}

      {previewError && (
        <p className="mt-3 font-mono text-[10px] font-semibold text-kmr-orange-dark">{previewError}</p>
      )}

      {preview && (
        <div className="mt-3 rounded-sm bg-white p-3">
          <span className="font-mono text-[8.5px] font-semibold tracking-[1px] text-kmr-muted-3">
            MESSAGE PREVIEW · {preview.pending_snapshot_count} quotes pending send
          </span>
          <pre className="mt-2 whitespace-pre-wrap font-archivo text-xs leading-relaxed text-kmr-ink">
            {preview.body_text}
          </pre>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {preview.buttons.map((button) => (
              <span
                key={button.id}
                className="rounded-sm bg-kmr-surface px-2 py-1 font-mono text-[9px] font-semibold text-kmr-blue"
              >
                {button.title}
              </span>
            ))}
          </div>
        </div>
      )}

      {sendError && (
        <p className="mt-3 font-mono text-[10px] font-semibold text-kmr-orange-dark">{sendError}</p>
      )}

      {sendResult && (
        <div className="mt-3 rounded-sm bg-white p-3 font-mono text-[10px] text-kmr-green-dark">
          Sent via {sendResult.channel}
          {sendResult.simulated ? " (simulated)" : ""} · WA id {sendResult.wa_message_id ?? "—"}
        </div>
      )}
    </div>
  )
}

function ConfigPill({ label, tone }: { label: string; tone: "green" | "orange" | "muted" }) {
  return (
    <span
      className={cn(
        "rounded-sm px-2.5 py-1 font-mono text-[8.5px] font-semibold tracking-[0.8px]",
        tone === "green" && "bg-kmr-green/15 text-kmr-green-dark",
        tone === "orange" && "bg-kmr-orange/15 text-kmr-orange-dark",
        tone === "muted" && "bg-kmr-surface text-kmr-muted-2",
      )}
    >
      {label}
    </span>
  )
}

function WaStatusBadge({ status, template }: { status: string | null; template: string | null }) {
  const label =
    template === "quote_single_v1" || template === "quote_multi_v1"
      ? "quote sent"
      : template === "driver_balance_v1"
        ? "balance due"
        : template === "driver_contact_v1"
          ? "driver contact"
          : status ?? "unknown"
  const isFailed = status === "failed"

  return (
    <span
      className={cn(
        "rounded-sm px-2 py-0.5 font-mono text-[8.5px] font-bold uppercase tracking-[0.8px]",
        isFailed ? "bg-kmr-orange/15 text-kmr-orange-dark" : "bg-kmr-green/15 text-kmr-green-dark",
      )}
    >
      {label}
    </span>
  )
}
