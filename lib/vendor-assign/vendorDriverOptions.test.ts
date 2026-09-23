import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { SupabaseClient } from "@supabase/supabase-js"

import { loadVendorDriverOptions, sortVendorDriverOptionsByPreferredVehicleType, type VendorDriverOption } from "./vendorDriverOptions"

/**
 * Chainable thenable stub: every `.select/.eq/.order/.limit` call returns
 * `this` so the real query-building code compiles/runs unchanged; the
 * actual filtering is assumed already applied by Postgres in production,
 * so the stub just resolves with whatever rows the test seeds — this file
 * is testing the *mapping* logic (embedding, availability booleans,
 * search text, preference sort), not Postgres's own filtering.
 */
const createFakeDriversClient = (result: { data: unknown; error: { code?: string; message: string } | null }) => {
  const builder = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    limit: () => builder,
    then: (
      onfulfilled?: ((value: typeof result) => unknown) | null,
      onrejected?: ((reason: unknown) => unknown) | null,
    ) => Promise.resolve(result).then(onfulfilled, onrejected),
  }
  return { from: () => builder } as unknown as SupabaseClient
}

describe("loadVendorDriverOptions", () => {
  it("maps embedded primary vehicle + photo availability booleans, and builds searchText", async () => {
    const supabase = createFakeDriversClient({
      data: [
        {
          id: "driver-bilal",
          full_name: "Bilal Ahmed",
          phone_last10: "9876500001",
          photo_url: "https://example.com/bilal.jpg",
          driver_vehicle_links: [
            {
              vehicle_id: "vehicle-dzire",
              is_primary: true,
              vehicles: {
                id: "vehicle-dzire",
                registration_number: "JK01NO1234",
                model: "Dzire",
                vehicle_type_id: 1,
                stock_photo_url: null,
              },
            },
          ],
        },
        {
          id: "driver-no-vehicle",
          full_name: "New Driver",
          phone_last10: "9000000002",
          photo_url: null,
          driver_vehicle_links: [],
        },
      ],
      error: null,
    })

    const options = await loadVendorDriverOptions(supabase, "vendor-1")

    assert.equal(options.length, 2)
    const bilal = options.find((o) => o.driverId === "driver-bilal") as VendorDriverOption
    assert.equal(bilal.hasDriverPhoto, true)
    assert.equal(bilal.hasVehiclePhoto, false)
    assert.equal(bilal.primaryVehicleId, "vehicle-dzire")
    assert.equal(bilal.registrationNumber, "JK01NO1234")
    assert.equal(bilal.searchText, "bilal ahmed 9876500001 jk01no1234 dzire")

    const noVehicle = options.find((o) => o.driverId === "driver-no-vehicle") as VendorDriverOption
    assert.equal(noVehicle.primaryVehicleId, null)
    assert.equal(noVehicle.hasDriverPhoto, false)
    assert.equal(noVehicle.hasVehiclePhoto, false)
  })

  it("returns an empty roster (not a throw) when the fleet tables don't exist yet", async () => {
    const supabase = createFakeDriversClient({ data: null, error: { code: "42P01", message: "relation does not exist" } })
    const options = await loadVendorDriverOptions(supabase, "vendor-1")
    assert.deepEqual(options, [])
  })

  it("throws for a real query error that isn't a missing-fleet-tables error", async () => {
    const supabase = createFakeDriversClient({ data: null, error: { message: "connection reset" } })
    await assert.rejects(() => loadVendorDriverOptions(supabase, "vendor-1"), /Failed to load vendor drivers/)
  })
})

describe("sortVendorDriverOptionsByPreferredVehicleType", () => {
  const makeOption = (driverId: string, vehicleTypeId: number | null): VendorDriverOption => ({
    driverId,
    fullName: driverId,
    phoneLast10: "",
    hasDriverPhoto: false,
    primaryVehicleId: null,
    registrationNumber: null,
    model: null,
    vehicleTypeId,
    hasVehiclePhoto: false,
    searchText: "",
  })

  it("moves matching-vehicle-type drivers first while preserving alphabetical order within each group", () => {
    const options = [makeOption("adil", 2), makeOption("bilal", 1), makeOption("imran", 1), makeOption("rashid", 2)]
    const sorted = sortVendorDriverOptionsByPreferredVehicleType(options, 1)
    assert.deepEqual(
      sorted.map((o) => o.driverId),
      ["bilal", "imran", "adil", "rashid"],
    )
  })

  it("is a no-op when no preferred vehicle type is given", () => {
    const options = [makeOption("adil", 2), makeOption("bilal", 1)]
    const sorted = sortVendorDriverOptionsByPreferredVehicleType(options, null)
    assert.deepEqual(sorted, options)
  })
})
