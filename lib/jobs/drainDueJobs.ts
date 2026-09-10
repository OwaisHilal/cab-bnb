import type { SupabaseClient } from "@supabase/supabase-js"

export const DEFAULT_MAX_DRAIN_ROUNDS = 8

export type DrainCounts = {
  claimed: number
  succeeded: number
  failed: number
}

type ProcessBatch = (
  supabase: SupabaseClient,
  options?: { jobTypes?: string[]; limit?: number },
) => Promise<DrainCounts>

export type DrainDueJobsOptions = {
  jobTypes?: string[]
  limit?: number
  maxRounds?: number
  invokeWorker?: (supabase: SupabaseClient) => Promise<DrainCounts | null>
  processBatch?: ProcessBatch
}

const emptyCounts = (): DrainCounts => ({ claimed: 0, succeeded: 0, failed: 0 })

const addCounts = (left: DrainCounts, right: DrainCounts): DrainCounts => ({
  claimed: left.claimed + right.claimed,
  succeeded: left.succeeded + right.succeeded,
  failed: left.failed + right.failed,
})

const asCounts = (value: unknown): DrainCounts | null => {
  if (!value || typeof value !== "object") return null
  const row = value as Record<string, unknown>
  if (typeof row.claimed !== "number") return null
  return {
    claimed: row.claimed,
    succeeded: typeof row.succeeded === "number" ? row.succeeded : 0,
    failed: typeof row.failed === "number" ? row.failed : 0,
  }
}

export const invokeJobQueueWorker = async (
  supabase: SupabaseClient,
): Promise<DrainCounts | null> => {
  try {
    const { data, error } = await supabase.functions.invoke("job-queue-worker")
    if (error) {
      console.error("[drainDueJobs] job-queue-worker invoke failed", error.message)
      return null
    }
    return asCounts(data)
  } catch (error) {
    console.error(
      "[drainDueJobs] job-queue-worker invoke failed",
      error instanceof Error ? error.message : error,
    )
    return null
  }
}

/**
 * Drains due `job_queue` rows immediately (FIFO among due jobs). Loops so
 * follow-up jobs enqueued by a handler run in the same request instead of
 * waiting for a scheduler. Tries the Edge worker first (full handler set),
 * then the Next.js fallback. Pass `jobTypes` to keep a hot path (OTP)
 * local-only and avoid stealing unrelated jobs.
 */
export const drainDueJobs = async (
  supabase: SupabaseClient,
  options?: DrainDueJobsOptions,
): Promise<DrainCounts> => {
  const maxRounds = options?.maxRounds ?? DEFAULT_MAX_DRAIN_ROUNDS
  const processBatch =
    options?.processBatch ?? (await import("./processDueJobs")).processDueJobs
  const invokeWorker = options?.jobTypes?.length
    ? null
    : (options?.invokeWorker ?? invokeJobQueueWorker)

  let totals = emptyCounts()
  for (let round = 0; round < maxRounds; round += 1) {
    let worker = emptyCounts()
    if (invokeWorker) {
      try {
        worker = (await invokeWorker(supabase)) ?? emptyCounts()
      } catch {
        worker = emptyCounts()
      }
    }
    const local = await processBatch(supabase, {
      jobTypes: options?.jobTypes,
      limit: options?.limit,
    })
    const roundCounts = addCounts(worker, local)
    totals = addCounts(totals, roundCounts)
    if (roundCounts.claimed === 0) break
  }
  return totals
}
