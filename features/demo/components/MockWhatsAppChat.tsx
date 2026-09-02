"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  isQuoteCardMessageBody,
  resolveQuoteCardButtons,
} from "@/features/booking-status/quoteActions"
import type { QuoteRowUi } from "@/features/booking-status/types"
import { MockChatMessageBubble } from "@/features/demo/components/MockChatMessageBubble"
import type { MockMessagingThread } from "@/features/demo/types"

interface MockWhatsAppChatProps {
  tripRequestId: string
  phoneDisplay: string
  selectedQuote: Pick<QuoteRowUi, "id" | "vendorName" | "priceLabel" | "isBestPrice"> | null
  onClose: () => void
}

export function MockWhatsAppChat({
  tripRequestId,
  phoneDisplay,
  selectedQuote,
  onClose,
}: MockWhatsAppChatProps) {
  const [thread, setThread] = useState<MockMessagingThread | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [pendingButton, setPendingButton] = useState<string | null>(null)

  const loadThread = useCallback(async () => {
    try {
      const params = new URLSearchParams({ trip_request_id: tripRequestId })
      if (selectedQuote?.id) {
        params.set("selected_quote_id", selectedQuote.id)
      }

      const response = await fetch(`/api/demo/messaging/thread?${params.toString()}`)
      const data = (await response.json().catch(() => null)) as MockMessagingThread | { error?: string } | null

      if (!response.ok) {
        setError((data as { error?: string } | null)?.error ?? "Could not load chat")
        return
      }

      setThread(data as MockMessagingThread)
      setError(null)
    } catch {
      setError("Network error loading chat")
    } finally {
      setIsLoading(false)
    }
  }, [selectedQuote, tripRequestId])

  useEffect(() => {
    let cancelled = false

    const tick = async () => {
      if (cancelled) return
      await loadThread()
    }

    void tick()
    const timer = setInterval(() => {
      void tick()
    }, 3000)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [loadThread])

  const latestActionableMessageId = useMemo(() => {
    const outbound = [...(thread?.messages ?? [])]
      .reverse()
      .find((message) => {
        if (message.direction !== "outbound") return false
        if (message.template_name === "driver_assignment_v1") return false
        if (message.buttons.some((button) => button.id.startsWith("COMPLETE_PAYMENT"))) return true
        if (message.buttons.some((button) => button.id.startsWith("BOOK_TOKEN"))) return true
        return Boolean(selectedQuote && isQuoteCardMessageBody(message.body_snapshot))
      })
    return outbound?.id ?? null
  }, [selectedQuote, thread])

  const resolveMessageButtons = useCallback(
    (messageId: string, buttons: MockMessagingThread["messages"][number]["buttons"]) => {
      return resolveQuoteCardButtons(buttons, {
        selectedQuote,
        isLatestActionable: messageId === latestActionableMessageId,
      })
    },
    [latestActionableMessageId, selectedQuote],
  )

  const handleButtonClick = async (buttonPayload: string, buttonTitle: string) => {
    setPendingButton(buttonPayload)
    setError(null)

    try {
      const response = await fetch("/api/demo/messaging/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trip_request_id: tripRequestId,
          button_payload: buttonPayload,
          button_title: buttonTitle,
          selected_quote_id: selectedQuote?.id,
        }),
      })
      const data = (await response.json().catch(() => null)) as
        | { thread?: MockMessagingThread; error?: string }
        | null

      if (!response.ok) {
        setError((data as { error?: string } | null)?.error ?? "Action failed")
        return
      }

      if (data?.thread) {
        setThread(data.thread)
      } else {
        await loadThread()
      }
    } catch {
      setError("Network error sending action")
    } finally {
      setPendingButton(null)
    }
  }

  return (
    <>
      <div className="absolute inset-0 animate-kmr-fade bg-black/45" aria-hidden onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 top-[8%] flex max-h-[92%] flex-col rounded-t-xl bg-[#efeae2] animate-kmr-sheet-up">
        <header className="flex items-center gap-3 rounded-t-xl bg-kmr-green px-4 py-3 text-white">
          <button
            type="button"
            onClick={onClose}
            className="font-archivo text-lg font-bold"
            aria-label="Close demo chat"
          >
            ←
          </button>
          <div className="flex flex-col">
            <span className="font-archivo text-sm font-bold">KMR Cabs</span>
            <span className="font-mono text-[9px] text-white/80">
              Demo chat · {phoneDisplay}
              {selectedQuote ? ` · ${selectedQuote.vendorName}` : ""}
            </span>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-3 py-4">
          {isLoading && !thread && (
            <p className="text-center font-archivo text-sm text-kmr-muted-2">Loading chat…</p>
          )}

          {error && (
            <p className="mb-3 rounded-sm bg-kmr-orange/15 px-3 py-2 text-center font-mono text-[10px] font-semibold text-kmr-orange-dark">
              {error}
            </p>
          )}

          <div className="flex flex-col gap-2">
            {(thread?.messages ?? []).map((message) => (
              <MockChatMessageBubble
                key={message.id}
                message={message}
                selectedQuote={selectedQuote}
                buttons={resolveMessageButtons(message.id, message.buttons)}
                isLatestActionable={message.id === latestActionableMessageId}
                pendingButton={pendingButton}
                onButtonClick={(payload, title) => {
                  void handleButtonClick(payload, title)
                }}
              />
            ))}
          </div>

          {thread && thread.messages.length === 0 && (
            <p className="text-center font-archivo text-sm text-kmr-muted-2">
              Loading your quotes… If this stays empty, finish OTP verify on the booking tab first.
            </p>
          )}
        </div>
      </div>
    </>
  )
}
