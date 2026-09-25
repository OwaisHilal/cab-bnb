/** Display-only: soften ALL-CAPS roster names without changing stored data. */
export const formatDisplayName = (name: string): string => {
  const trimmed = name.trim()
  if (!trimmed) return trimmed
  const letters = trimmed.replace(/[^a-zA-Z]/g, "")
  if (letters.length > 0 && letters === letters.toUpperCase()) {
    return trimmed.toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase())
  }
  return trimmed
}
