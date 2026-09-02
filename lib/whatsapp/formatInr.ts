export function formatInr(amount: number): string {
  return `\u20b9${amount.toLocaleString("en-IN")}`
}

export const TOKEN_LOCK_AMOUNT = 99
