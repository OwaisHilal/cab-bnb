"use client"

import Image from "next/image"
import { cn } from "@/lib/utils/cn"
import { stripQuoteNegotiateFooter } from "@/lib/demo/mockChatPayload"
import {
  buildSelectedQuoteChatBody,
  isQuoteCardMessageBody,
  type QuoteActionButton,
} from "@/features/booking-status/quoteActions"
import type { QuoteRowUi } from "@/features/booking-status/types"
import type { MockMessagingMessage } from "@/features/demo/types"

interface MockChatMessageBubbleProps {
  message: MockMessagingMessage
  selectedQuote: Pick<QuoteRowUi, "vendorName" | "priceLabel"> | null
  buttons: QuoteActionButton[]
  isLatestActionable: boolean
  pendingButton: string | null
  onButtonClick: (payload: string, title: string) => void
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
}

function parseDriverMeta(body: string | null): { name: string | null; vehicle: string | null } {
  if (!body) return { name: null, vehicle: null }

  const name =
    body.match(/^Driver: (.+)$/m)?.[1] ??
    body.match(/^Your driver: (.+)$/m)?.[1] ??
    null
  const vehicle = body.match(/^Vehicle: (.+)$/m)?.[1] ?? null

  return { name, vehicle }
}

function formatDriverCardBody(body: string | null, hasMedia: boolean): string {
  if (!body) return ""
  if (!hasMedia) return body

  return body
    .split("\n")
    .filter((line) => !/^Driver: /.test(line) && !/^Vehicle: /.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

export function MockChatMessageBubble({
  message,
  selectedQuote,
  buttons,
  isLatestActionable,
  pendingButton,
  onButtonClick,
}: MockChatMessageBubbleProps) {
  const isOutbound = message.direction === "outbound"
  const rawBody = stripQuoteNegotiateFooter(message.body_snapshot)
  const hasMedia = Boolean(message.media)
  const bodyText =
    selectedQuote && isQuoteCardMessageBody(message.body_snapshot)
      ? buildSelectedQuoteChatBody(selectedQuote)
      : formatDriverCardBody(rawBody, hasMedia)
  const showCta = isOutbound && Boolean(message.ctaUrl?.url)
  const showInlineButtons = isOutbound && !showCta && buttons.length > 0
  const driverMeta = parseDriverMeta(message.body_snapshot)

  return (
    <div className={cn("flex", isOutbound ? "justify-start" : "justify-end")}>
      <div className={cn("max-w-[88%]", (showInlineButtons || showCta) && "w-full max-w-[88%]")}>
        <div
          className={cn(
            "overflow-hidden shadow-sm",
            isOutbound ? "rounded-lg rounded-tl-none bg-white" : "rounded-lg rounded-tr-none bg-[#d9fdd3]",
            (showInlineButtons || showCta) && "rounded-b-none",
          )}
        >
          {hasMedia && message.media && (
            <div className="border-b border-black/5">
              <div className="relative min-h-[6.5rem] overflow-hidden">
                <Image
                  src={message.media.carImageUrl}
                  alt="Assigned vehicle"
                  fill
                  className="object-cover"
                  unoptimized
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/35 to-black/10" />

                <div className="relative z-10 flex min-h-[6.5rem] items-end gap-3 p-3">
                  <div className="relative size-16 flex-none overflow-hidden rounded-full bg-black/40 ring-2 ring-white/20 shadow-lg">
                    <Image
                      src={message.media.driverImageUrl}
                      alt={driverMeta.name ? `${driverMeta.name} profile photo` : "Driver photo"}
                      fill
                      className="object-cover"
                      unoptimized
                    />
                  </div>

                  {(driverMeta.name || driverMeta.vehicle) && (
                    <div className="min-w-0 flex-1 pb-1">
                      {driverMeta.name && (
                        <span className="block font-archivo text-[13px] font-extrabold leading-tight text-white drop-shadow-sm">
                          {driverMeta.name}
                        </span>
                      )}
                      {driverMeta.vehicle && (
                        <span className="mt-0.5 block truncate font-archivo text-[11px] font-medium text-white/85 drop-shadow-sm">
                          {driverMeta.vehicle}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {bodyText && (
            <div className={cn("px-3 py-2", hasMedia && "pt-2")}>
              <pre className="whitespace-pre-wrap font-archivo text-[13px] leading-snug text-kmr-ink">
                {bodyText}
              </pre>
              {!showInlineButtons && !showCta && (
                <span className="mt-1 block text-right font-mono text-[8px] text-kmr-muted-3">
                  {formatTime(message.created_at)}
                </span>
              )}
            </div>
          )}
        </div>

        {showCta && message.ctaUrl && (
          <div className="overflow-hidden rounded-b-lg rounded-t-none border border-t-0 border-black/5 bg-white shadow-sm">
            <a
              href={message.ctaUrl.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center justify-center px-3 py-3 font-archivo text-[14px] font-semibold text-[#008069] transition-colors active:bg-black/5"
              aria-label={message.ctaUrl.title}
            >
              {message.ctaUrl.title}
            </a>
            <span className="block px-3 pb-2 text-right font-mono text-[8px] text-kmr-muted-3">
              {formatTime(message.created_at)}
            </span>
          </div>
        )}

        {showInlineButtons && (
          <div className="overflow-hidden rounded-b-lg rounded-t-none border border-t-0 border-black/5 bg-white shadow-sm">
            {buttons.map((button, index) => {
              const isPending = pendingButton === button.id
              const isDisabled = !isLatestActionable || pendingButton !== null

              return (
                <button
                  key={button.id}
                  type="button"
                  disabled={isDisabled}
                  onClick={() => {
                    if (isDisabled) return
                    onButtonClick(button.id, button.title)
                  }}
                  className={cn(
                    "flex w-full items-center justify-center px-3 py-3 font-archivo text-[14px] font-semibold transition-colors",
                    index > 0 && "border-t border-black/8",
                    isDisabled
                      ? "cursor-default text-kmr-muted-3"
                      : "text-[#008069] active:bg-black/5",
                    isPending && "opacity-60",
                  )}
                  aria-label={button.title}
                >
                  {isPending ? "Sending…" : button.title}
                </button>
              )
            })}
            <span className="block px-3 pb-2 text-right font-mono text-[8px] text-kmr-muted-3">
              {formatTime(message.created_at)}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
