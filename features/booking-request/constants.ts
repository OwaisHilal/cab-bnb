import type { DateOption, TripPreset, VehicleTypeOption, VehicleTypeCode } from "./types";

export const VEHICLE_TYPES: VehicleTypeOption[] = [
  { code: "sedan", label: "Sedan", seatCapacity: 4, who: "Couples & small families" },
  { code: "suv", label: "SUV", seatCapacity: 6, who: "Groups up to 6" },
  { code: "tempo", label: "Tempo Traveller", seatCapacity: 12, who: "Large groups" },
];

/**
 * POST /api/trip-requests needs a numeric `requested_vehicle_type_id`
 * (vehicle_types.id), but the app never fetches vehicle_types over the
 * network today. These ids mirror the fixed, deterministic seed order in
 * supabase/migrations/20260810000100_0001_core_actors.sql (sedan, suv,
 * tempo) — if that seed ever changes, this map must change with it.
 */
export const VEHICLE_TYPE_IDS_BY_CODE: Record<VehicleTypeCode, number> = {
  sedan: 1,
  suv: 2,
  tempo: 3,
};

export const TRIP_PRESETS: TripPreset[] = [
  { id: "valley-loop", name: "Srinagar - Gulmarg - Pahalgam", days: 5, meta: "Classic valley loop" },
  { id: "sonamarg-run", name: "Srinagar - Sonamarg", days: 3, meta: "Short glacier run" },
  { id: "meadows", name: "Doodhpathri - Yusmarg", days: 4, meta: "Meadows & pine forests" },
  { id: "gurez", name: "Srinagar - Gurez", days: 6, meta: "Offbeat border valley" },
];

export const UPCOMING_DATES: DateOption[] = [
  { id: "d1", shortLabel: "Sat 15 Aug", isoDate: "2026-08-15" },
  { id: "d2", shortLabel: "Sun 16 Aug", isoDate: "2026-08-16" },
  { id: "d3", shortLabel: "Mon 17 Aug", isoDate: "2026-08-17" },
  { id: "d4", shortLabel: "Wed 19 Aug", isoDate: "2026-08-19" },
];

export const MIN_TRIP_DAYS = 1;
export const MAX_TRIP_DAYS = 14;
export const MIN_PAX_COUNT = 1;
export const MAX_PAX_COUNT = 20;

export const SEDAN_SEAT_CAPACITY =
  VEHICLE_TYPES.find((vehicle) => vehicle.code === "sedan")?.seatCapacity ?? 4;
