import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { drainDueJobs, type DrainCounts } from "./drainDueJobs"

const counts = (claimed: number, succeeded = claimed, failed = 0): DrainCounts => ({
  claimed,
  succeeded,
  failed,
})

describe("drainDueJobs", () => {
  it("stops after a round that claims nothing", async () => {
    let workerCalls = 0
    let localCalls = 0
    const result = await drainDueJobs({} as never, {
      invokeWorker: async () => {
        workerCalls += 1
        return counts(0)
      },
      processBatch: async () => {
        localCalls += 1
        return counts(0)
      },
    })
    assert.deepEqual(result, counts(0, 0, 0))
    assert.equal(workerCalls, 1)
    assert.equal(localCalls, 1)
  })

  it("loops so chained jobs enqueued by a handler are drained in the same request", async () => {
    const localClaims = [2, 1, 0]
    let localCalls = 0
    const result = await drainDueJobs({} as never, {
      invokeWorker: async () => counts(0),
      processBatch: async () => {
        const claimed = localClaims[localCalls] ?? 0
        localCalls += 1
        return counts(claimed)
      },
    })
    assert.equal(localCalls, 3)
    assert.equal(result.claimed, 3)
    assert.equal(result.succeeded, 3)
  })

  it("caps rounds so a poison job cannot loop forever", async () => {
    let localCalls = 0
    const result = await drainDueJobs({} as never, {
      maxRounds: 3,
      invokeWorker: async () => counts(0),
      processBatch: async () => {
        localCalls += 1
        return counts(1)
      },
    })
    assert.equal(localCalls, 3)
    assert.equal(result.claimed, 3)
  })

  it("skips the Edge worker when draining a filtered job type (OTP hot path)", async () => {
    let workerCalls = 0
    let localCalls = 0
    const result = await drainDueJobs({} as never, {
      jobTypes: ["send_quotes"],
      invokeWorker: async () => {
        workerCalls += 1
        return counts(9)
      },
      processBatch: async (_supabase, options) => {
        assert.deepEqual(options?.jobTypes, ["send_quotes"])
        localCalls += 1
        return localCalls === 1 ? counts(1) : counts(0)
      },
    })
    assert.equal(workerCalls, 0)
    assert.equal(result.claimed, 1)
  })

  it("falls through to the local batch when the worker is unavailable", async () => {
    let localCalls = 0
    const result = await drainDueJobs({} as never, {
      invokeWorker: async () => {
        throw new Error("Edge not deployed")
      },
      processBatch: async () => {
        localCalls += 1
        return localCalls === 1 ? counts(1, 1, 0) : counts(0)
      },
    })
    assert.equal(result.claimed, 1)
    assert.equal(result.succeeded, 1)
  })
})
