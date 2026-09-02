import "server-only"
import { NextResponse, type NextRequest } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server"
import { getExpectedAuthKey, isAuthorized } from "./auth"
import { bulkFail } from "./envelope"

export function jsonMsg91(body: unknown, status = 200) {
  return NextResponse.json(body, { status })
}

export function unauthorizedResponse() {
  return jsonMsg91(bulkFail("Unauthorized"), 401)
}

export async function withMsg91Sim(
  request: NextRequest,
  handler: (supabase: SupabaseClient) => Promise<NextResponse>,
): Promise<NextResponse> {
  if (!getExpectedAuthKey()) {
    return jsonMsg91(bulkFail("MSG91 simulator authkey is not configured"), 500)
  }
  if (!isAuthorized(request)) {
    return unauthorizedResponse()
  }

  let supabase: SupabaseClient
  try {
    supabase = getSupabaseServiceRoleClient()
  } catch (error) {
    return jsonMsg91(
      bulkFail(error instanceof Error ? error.message : "Supabase is not configured"),
      500,
    )
  }

  try {
    return await handler(supabase)
  } catch (error) {
    return jsonMsg91(
      bulkFail(error instanceof Error ? error.message : "Internal simulator error"),
      500,
    )
  }
}

export async function readOptionalJson(request: NextRequest): Promise<unknown> {
  const text = await request.text()
  if (!text.trim()) {
    return {}
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}
