/**
 * Vehicle model is a display label ("Swift Dzire"), not a catalog id.
 * These helpers only tidy spelling so "swift   dzire" can match a model
 * this vendor already saved, without rejecting a name nobody has used yet.
 */

export interface VehicleModelSource {
  model: string
  vehicleTypeId: number | null
}

export const collapseVehicleModel = (value: string): string => {
  return value.trim().replace(/\s+/g, " ")
}

export const vehicleModelKey = (value: string): string => {
  return collapseVehicleModel(value).toLowerCase()
}

const preferVehicleModelSpelling = (spellings: readonly string[]): string => {
  const unique = [...new Set(spellings.map(collapseVehicleModel).filter(Boolean))]
  return unique.find((spelling) => spelling !== spelling.toLowerCase()) ?? unique[0] ?? ""
}

/** If `typed` matches a known spelling aside from case and extra spaces, return that saved spelling. */
export const canonicalizeVehicleModel = (typed: string, knownSpellings: readonly string[]): string => {
  const collapsed = collapseVehicleModel(typed)
  const key = collapsed.toLowerCase()
  const matches = knownSpellings.filter((spelling) => vehicleModelKey(spelling) === key)
  if (matches.length === 0) return collapsed
  return preferVehicleModelSpelling(matches)
}

/** Distinct labels for one vehicle type, stable and case-insensitive. Empty when the booking has no type. */
export const distinctModelSuggestions = (
  sources: readonly VehicleModelSource[],
  vehicleTypeId: number | null,
): string[] => {
  if (vehicleTypeId == null) return []
  const grouped = new Map<string, string[]>()
  for (const source of sources) {
    if (source.vehicleTypeId !== vehicleTypeId) continue
    const collapsed = collapseVehicleModel(source.model)
    if (!collapsed) continue
    const key = collapsed.toLowerCase()
    const list = grouped.get(key) ?? []
    list.push(collapsed)
    grouped.set(key, list)
  }
  return [...grouped.values()]
    .map((spellings) => preferVehicleModelSpelling(spellings))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
}
