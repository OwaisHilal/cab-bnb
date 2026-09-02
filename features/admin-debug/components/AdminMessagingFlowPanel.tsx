"use client"

import { useEffect, useMemo, useState } from "react"
import { cn } from "@/lib/utils/cn"
import {
  getAudienceLabel,
  getAudienceStyle,
  MESSAGING_FLOW_STEPS,
  type MessagingFlowAudience,
} from "@/features/admin-debug/messagingFlow"
import type { MockMessagingMessage, MockMessagingThread } from "@/features/demo/types"

type FlowTab = MessagingFlowAudience

const FLOW_TABS: Array<{ id: FlowTab; label: string }> = [
  { id: "customer", label: "Guest" },
  { id: "vendor", label: "Nova" },
  { id: "driver", label: "Driver" },
]

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
}

export function AdminMessagingFlowPanel({ tripRequestId }: { tripRequestId: string }) {
  const [thread, setThread] = useState<MockMessagingThread | null>(null)
  const [activeTab, setActiveTab] = useState<FlowTab>("customer")

  useEffect(() => {
    let cancelled = false

    const tick = async () => {
      try {
        const response = await fetch(
          `/api/demo/messaging/thread?trip_request_id=${tripRequestId}&audience=admin`,
        )
        const data = (await response.json().catch(() => null)) as MockMessagingThread | null
        if (!cancelled && response.ok && data) setThread(data)
      } catch {
        // Thread unavailable outside demo mode.
      }
    }

    void tick()
    const timer = setInterval(() => {
      void tick()
    }, 3000)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [tripRequestId])

  const messages = thread?.messages ?? []

  const counts = useMemo(() => {
    return {
      customer: messages.filter((message) => (message.audience ?? "customer") === "customer").length,
      vendor: messages.filter((message) => message.audience === "vendor").length,
      driver: messages.filter((message) => message.audience === "driver").length,
    }
  }, [messages])

  const filteredMessages = useMemo(() => {
    return messages.filter((message) => (message.audience ?? "customer") === activeTab)
  }, [activeTab, messages])

  const completedCount = useMemo(() => {
    const ids = new Set(
      messages
        .map((message) => message.flow_step_id)
        .filter((stepId): stepId is string => Boolean(stepId)),
    )
    return ids.size
  }, [messages])

  const emptyCopy =
    activeTab === "customer"
      ? "No guest messages yet — run OTP + Pay ₹99 in the customer app."
      : activeTab === "vendor"
        ? "No Nova messages yet — shows after booking is locked."
        : "No driver message yet — shows after guest pays balance."

  return (
    <div className="rounded-sm border border-black/10 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-[9px] font-semibold tracking-[1px] text-kmr-muted-3">
          {completedCount}/{MESSAGING_FLOW_STEPS.length} steps logged
        </span>
      </div>

      <div
        className="mt-3 flex gap-1.5"
        role="tablist"
        aria-label="WhatsApp flow audience"
      >
        {FLOW_TABS.map((tab) => {
          const isActive = activeTab === tab.id
          const count = counts[tab.id]
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex-1 rounded-full px-3 py-2 font-archivo text-xs font-bold transition-colors sm:flex-none",
                isActive
                  ? getAudienceStyle(tab.id)
                  : "bg-kmr-surface text-kmr-muted-2 hover:bg-black/5",
              )}
            >
              {tab.label}
              {count > 0 ? ` · ${count}` : ""}
            </button>
          )
        })}
      </div>

      {!thread ? (
        <p className="mt-4 font-archivo text-sm text-kmr-muted-2">Loading…</p>
      ) : filteredMessages.length === 0 ? (
        <p className="mt-4 rounded-sm bg-kmr-surface px-3 py-6 text-center font-archivo text-sm text-kmr-muted-2">
          {emptyCopy}
        </p>
      ) : (
        <ul className="mt-4 flex max-h-96 flex-col gap-3 overflow-y-auto">
          {filteredMessages.map((message) => (
            <FlowMessageCard key={message.id} message={message} />
          ))}
        </ul>
      )}
    </div>
  )
}

function FlowMessageCard({ message }: { message: MockMessagingMessage }) {
  const audience = message.audience ?? "customer"

  return (
    <li className="rounded-sm border border-black/5 bg-kmr-surface/50 px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <AudienceBadge audience={audience} />
        <span className="font-mono text-[10px] text-kmr-muted-3">{formatTime(message.created_at)}</span>
      </div>

      <pre className="mt-2 whitespace-pre-wrap font-archivo text-[13px] leading-relaxed text-kmr-ink">
        {message.body_snapshot}
      </pre>

      {message.buttons.length > 0 && (
        <p className="mt-2 font-archivo text-[11px] font-semibold text-[#008069]">
          Buttons: {message.buttons.map((button) => button.title).join(" · ")}
        </p>
      )}
    </li>
  )
}

function AudienceBadge({ audience }: { audience: MessagingFlowAudience }) {
  return (
    <span
      className={cn(
        "rounded-full px-2.5 py-0.5 font-archivo text-[10px] font-bold",
        getAudienceStyle(audience),
      )}
    >
      {getAudienceLabel(audience)}
    </span>
  )
}
