export type QuoteSnapshotStatusUi =
  | "pending_send"
  | "sent"
  | "viewed"
  | "negotiating"
  | "finalized"
  | "expired"
  | "lost";

export interface QuoteRowUi {
  id: string;
  vendorName: string;
  priceLabel: string;
  isBestPrice: boolean;
  status: QuoteSnapshotStatusUi;
  isNew: boolean;
}

export interface BookingSummaryUi {
  bookingRef: string;
  summaryLabel: string;
  quotes: QuoteRowUi[];
}
