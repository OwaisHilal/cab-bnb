export type SeasonQuarter = "Q1" | "Q2" | "Q3" | "Q4" | "PEAK" | "OFF_PEAK" | "ALL_YEAR";

export interface MatchedVendorBand {
  vendorRateBandId: string;
  vendorId: string;
  vendorName: string;
  vehicleTypeId: number;
  maxQuote: number;
  minQuote: number;
}

export interface VehicleRecommendation {
  recommendedVehicleTypeId: number;
  reason: string;
}

export interface MatchTripRequestInput {
  paxCount: number;
  tripDays: number;
  tripStartDate: string;
  requestedVehicleTypeId: number;
}

export interface MatchTripRequestResult {
  matchedBands: MatchedVendorBand[];
  recommendation: VehicleRecommendation | null;
}
