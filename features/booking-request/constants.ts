import type { DateOption, TripPreset, VehicleTypeOption, VehicleTypeCode } from "./types";
import { getUpcomingDates } from "./upcomingDates";

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

// Was a hardcoded Aug 2026 array that silently went stale once "today"
// passed those dates — quick-pick chips kept offering days in the past.
// Computed fresh (from the real clock) every time this module loads.
export const UPCOMING_DATES: DateOption[] = getUpcomingDates();

export const MIN_TRIP_DAYS = 1;
export const MAX_TRIP_DAYS = 14;
export const MIN_PAX_COUNT = 1;
export const MAX_PAX_COUNT = 20;

export const SEDAN_SEAT_CAPACITY =
  VEHICLE_TYPES.find((vehicle) => vehicle.code === "sedan")?.seatCapacity ?? 4;

export const ORBIT_DESTINATIONS = [
  "SRINAGAR",
  "GULMARG",
  "PAHALGAM",
  "SONAMARG",
  "DOODHPATHRI",
  "YUSMARG",
  "AHARBAL",
  "GUREZ",
] as const;

/** Demo fixture vendors — keep in sync with supabase/seed.sql business_name values. */
export const DEMO_VENDOR_NAMES = ["Nova Cabs", "Ola Cabs", "Aala Cabs", "Uber"] as const;

export const ORBIT_CONFIG = {
  revolutionMs: 20000,
  introDelayMs: 400,
  introFormMs: 1120,
  introSettleMs: 1104,
  maxVisibleLabels: 3,
  throttleMs: 33,
  maxDpr: 2,
} as const;
