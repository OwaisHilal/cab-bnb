export type VehicleTypeCode = "sedan" | "suv" | "tempo";

export interface VehicleTypeOption {
  code: VehicleTypeCode;
  label: string;
  seatCapacity: number;
  who: string;
}

export interface TripPreset {
  id: string;
  name: string;
  days: number;
  meta: string;
}

export interface DateOption {
  id: string;
  shortLabel: string;
  isoDate: string;
}

export interface BookingRequestDraft {
  days: number;
  paxCount: number;
  vehicleType: VehicleTypeCode;
  selectedDateId: string | null;
  customDate: string | null;
}

export type BookingRequestStep = 0 | 1 | 2 | 3;
