export type DispatchRowStatus = "pending" | "matching" | "matched";

export interface DispatchVendorRow {
  id: string;
  name: string;
  status: DispatchRowStatus;
}

export interface QuoteMatchSummary {
  tripRequestId: string;
  matchedVendorCount: number;
  recommendationReason: string | null;
}
