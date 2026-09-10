import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"

import { isHobbySafeCronSchedule } from "./hobbyCronSchedule"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..")

describe("isHobbySafeCronSchedule", () => {
  it("accepts once-per-day expressions", () => {
    assert.equal(isHobbySafeCronSchedule("0 2 * * *"), true)
    assert.equal(isHobbySafeCronSchedule("30 14 * * 1"), true)
  })

  it("rejects more-than-daily expressions blocked on Hobby", () => {
    assert.equal(isHobbySafeCronSchedule("* * * * *"), false)
    assert.equal(isHobbySafeCronSchedule("0 * * * *"), false)
    assert.equal(isHobbySafeCronSchedule("*/10 * * * *"), false)
    assert.equal(isHobbySafeCronSchedule("0 */6 * * *"), false)
    assert.equal(isHobbySafeCronSchedule("1,15 * * * *"), false)
  })
})

describe("vercel.json crons", () => {
  it("schedules every listed cron at most once per day", () => {
    const vercel = JSON.parse(readFileSync(join(repoRoot, "vercel.json"), "utf8")) as {
      crons: Array<{ path: string; schedule: string }>
    }
    const paths = vercel.crons.map((cron) => cron.path)
    for (const path of [
      "/api/cron/dispatch-jobs",
      "/api/cron/dispatch-lifecycle-events",
      "/api/cron/expire-stale-quotes",
      "/api/cron/vendor-reply-timeouts",
    ]) {
      assert.equal(paths.includes(path), true, `missing cron path ${path}`)
    }
    for (const cron of vercel.crons) {
      assert.equal(
        isHobbySafeCronSchedule(cron.schedule),
        true,
        `${cron.path} schedule ${cron.schedule} is not Hobby-safe`,
      )
    }
  })
})
