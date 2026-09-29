import type { GuestTripCandidate } from "@/lib/guest-trip/types"

const byNewest = (a: GuestTripCandidate, b: GuestTripCandidate): number => {
  return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0
}

export const pickCurrentGuestTrip = <T extends GuestTripCandidate>(rows: T[]): T | null => {
  const inProgress = rows.filter((row) => row.inProgress && !row.closed).sort(byNewest)
  if (inProgress[0]) return inProgress[0]
  const finished = rows.filter((row) => row.finished && !row.closed).sort(byNewest)
  return finished[0] ?? null
}
