import type { NextRequest } from "next/server"

export function getExpectedAuthKey(): string | null {
  const sim = process.env.MSG91_SIM_AUTH_KEY?.trim() ?? ""
  const live = process.env.MSG91_AUTH_KEY?.trim() ?? ""
  const key = sim || live
  return key.length > 0 ? key : null
}

export function readAuthKey(request: NextRequest): string | null {
  const header = request.headers.get("authkey")?.trim()
  if (header) {
    return header
  }
  const query = request.nextUrl.searchParams.get("authkey")?.trim()
  return query && query.length > 0 ? query : null
}

export function isAuthorized(request: NextRequest): boolean {
  const expected = getExpectedAuthKey()
  if (!expected) {
    return false
  }
  return readAuthKey(request) === expected
}
