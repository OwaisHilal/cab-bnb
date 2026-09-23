import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { SupabaseClient } from "@supabase/supabase-js"

import { assignDriverToBooking, isBookingAssignable, type ResolvedVendorBooking } from "./assignDriverToBooking"

const baseBooking: ResolvedVendorBooking = {
  bookingId: "booking-1",
  vendorId: "vendor-1",
  status: "vendor_confirmed",
  lockType: "token_99",
  paymentStatus: "token_paid",
  vehicleTypeId: 1,
}

describe("isBookingAssignable", () => {
  it("is assignable for active vendor-confirming statuses", () => {
    assert.equal(isBookingAssignable({ ...baseBooking, status: "vendor_confirming" }), true)
    assert.equal(isBookingAssignable({ ...baseBooking, status: "vendor_confirmed" }), true)
    assert.equal(isBookingAssignable({ ...baseBooking, status: "driver_attach_pending" }), true)
  })

  it("is not assignable once a driver is already attached or later", () => {
    assert.equal(isBookingAssignable({ ...baseBooking, status: "driver_attached" }), false)
    assert.equal(isBookingAssignable({ ...baseBooking, status: "ready_for_pickup" }), false)
    assert.equal(isBookingAssignable({ ...baseBooking, status: "in_trip" }), false)
    assert.equal(isBookingAssignable({ ...baseBooking, status: "completed" }), false)
  })

  it("is not assignable once fully paid, regardless of status", () => {
    assert.equal(isBookingAssignable({ ...baseBooking, status: "vendor_confirmed", paymentStatus: "fully_paid" }), false)
  })
})

// ---------------------------------------------------------------------------
// Minimal in-memory Supabase fake, scoped to the exact query shapes used by
// assignDriverToBooking.ts (select/insert/update/upsert with .eq/.neq/.in
// filters, .maybeSingle(), and driver_vehicle_links -> vehicles embedding).
// Not a general-purpose Supabase mock — just enough to unit-test the real
// upsert/attach/conflict logic without a live database.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>

interface FakeTables {
  bookings: Row[]
  drivers: Row[]
  vehicles: Row[]
  driver_vehicle_links: Row[]
  driver_detail_submissions: Row[]
  job_queue: Row[]
}

type FilterOp = "eq" | "neq" | "in"

const applyFilters = (rows: Row[], filters: Array<{ op: FilterOp; col: string; val: unknown }>): Row[] =>
  rows.filter((row) =>
    filters.every((f) => {
      if (f.op === "eq") return row[f.col] === f.val
      if (f.op === "neq") return row[f.col] !== f.val
      if (f.op === "in") return Array.isArray(f.val) && (f.val as unknown[]).includes(row[f.col])
      return true
    }),
  )

let autoId = 0
const nextId = (prefix: string): string => `${prefix}-${(autoId += 1)}`

class FakeQueryBuilder implements PromiseLike<{ data: unknown; error: null }> {
  private mode: "select" | "insert" | "update" | "upsert" = "select"
  private filters: Array<{ op: FilterOp; col: string; val: unknown }> = []
  private patch: Row | null = null
  private writeRow: Row | null = null
  private single = false
  private selectAfterWrite = false

  constructor(
    private db: FakeTables,
    private table: keyof FakeTables,
  ) {}

  select(): this {
    this.selectAfterWrite = true
    return this
  }

  eq(col: string, val: unknown): this {
    this.filters.push({ op: "eq", col, val })
    return this
  }

  neq(col: string, val: unknown): this {
    this.filters.push({ op: "neq", col, val })
    return this
  }

  in(col: string, vals: unknown[]): this {
    this.filters.push({ op: "in", col, val: vals })
    return this
  }

  ilike(): this {
    return this
  }

  order(): this {
    return this
  }

  limit(): this {
    return this
  }

  maybeSingle(): this {
    this.single = true
    return this
  }

  insert(row: Row): this {
    this.mode = "insert"
    this.writeRow = { id: nextId(this.table), ...row }
    return this
  }

  update(patch: Row): this {
    this.mode = "update"
    this.patch = patch
    return this
  }

  upsert(row: Row): this {
    this.mode = "upsert"
    this.writeRow = row
    return this
  }

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected)
  }

  private embed(rows: Row[]): Row[] {
    if (this.table !== "driver_vehicle_links") return rows
    return rows.map((row) => ({
      ...row,
      vehicles: this.db.vehicles.find((v) => v.id === row.vehicle_id) ?? null,
    }))
  }

  private execute(): { data: unknown; error: null } {
    const table = this.db[this.table]

    if (this.mode === "insert") {
      table.push(this.writeRow as Row)
      const row = this.embed([this.writeRow as Row])[0]
      const data = this.selectAfterWrite ? row : null
      return { data: this.single ? data : data ? [data] : null, error: null }
    }

    if (this.mode === "upsert") {
      const conflictCols = ["driver_id", "vehicle_id"]
      const existingIndex = table.findIndex((row) => conflictCols.every((c) => row[c] === (this.writeRow as Row)[c]))
      if (existingIndex >= 0) table[existingIndex] = { ...table[existingIndex], ...this.writeRow }
      else table.push({ ...(this.writeRow as Row) })
      return { data: null, error: null }
    }

    if (this.mode === "update") {
      const matches = applyFilters(table, this.filters)
      matches.forEach((row) => Object.assign(row, this.patch))
      const embedded = this.embed(matches)
      const data = this.selectAfterWrite ? embedded : null
      return { data: this.single ? (data ? (data[0] ?? null) : null) : data, error: null }
    }

    const matches = this.embed(applyFilters(table, this.filters))
    return { data: this.single ? (matches[0] ?? null) : matches, error: null }
  }
}

const createFakeSupabase = (db: FakeTables) =>
  ({
    from(table: keyof FakeTables) {
      return new FakeQueryBuilder(db, table)
    },
  }) as unknown as SupabaseClient

const emptyDb = (): FakeTables => ({
  bookings: [],
  drivers: [],
  vehicles: [],
  driver_vehicle_links: [],
  driver_detail_submissions: [],
  job_queue: [],
})

/** Seeds the one `bookings` row attachBooking's status-guarded update needs. */
const seedBookingRow = (db: FakeTables, booking: ResolvedVendorBooking, dbStatus = "vendor_confirmed"): void => {
  db.bookings.push({ id: booking.bookingId, status: dbStatus })
}

describe("assignDriverToBooking — existing mode", () => {
  it("attaches the saved driver's primary vehicle, preserving photo-bearing IDs", async () => {
    const db = emptyDb()
    seedBookingRow(db, baseBooking)
    db.drivers.push({ id: "driver-bilal", vendor_id: "vendor-1", full_name: "Bilal Ahmed", phone_e164: "+919876500001", status: "active" })
    db.vehicles.push({ id: "vehicle-dzire", vendor_id: "vendor-1", registration_number: "JK01NO1234", model: "Dzire" })
    db.driver_vehicle_links.push({ driver_id: "driver-bilal", vehicle_id: "vehicle-dzire", is_primary: true })
    const supabase = createFakeSupabase(db)

    const result = await assignDriverToBooking(
      supabase,
      baseBooking,
      { mode: "existing", driverId: "driver-bilal" },
      { rawMessageText: "EXISTING_DRIVER: driver-bilal" },
    )

    assert.deepEqual(result, { ok: true })
    const updatedBooking = db.bookings.find((b) => b.id === baseBooking.bookingId)
    assert.equal(updatedBooking?.status, "driver_attached")
    assert.equal(updatedBooking?.driver_id, "driver-bilal")
    assert.equal(updatedBooking?.vehicle_id, "vehicle-dzire")
    const submission = db.driver_detail_submissions[0]
    assert.equal(submission?.parsed_driver_name, "Bilal Ahmed")
    assert.equal(submission?.parsed_vehicle_number, "JK01NO1234")
    assert.equal(db.job_queue[0]?.job_type, "send_balance_payment")
  })

  it("preserves the driver/vehicle photo URLs by keeping the saved IDs instead of re-typing details", async () => {
    // lib/whatsapp/sendBalancePaymentLink.ts resolves the driver/car media
    // card purely from `bookings.driver_id` / `bookings.vehicle_id` (via an
    // embedded `drivers(photo_url)` / `vehicles(stock_photo_url)` select) —
    // so preserving those FK IDs through "existing" mode, rather than
    // re-creating rows from typed text, is what keeps a saved photo intact.
    const db = emptyDb()
    seedBookingRow(db, baseBooking)
    db.drivers.push({
      id: "driver-bilal",
      vendor_id: "vendor-1",
      full_name: "Bilal Ahmed",
      phone_e164: "+919876500001",
      status: "active",
      photo_url: "demo/drivers/bilal-ahmed.png",
    })
    db.vehicles.push({
      id: "vehicle-dzire",
      vendor_id: "vendor-1",
      registration_number: "JK01NO1234",
      model: "Dzire",
      stock_photo_url: "fleet/sedan.png",
    })
    db.driver_vehicle_links.push({ driver_id: "driver-bilal", vehicle_id: "vehicle-dzire", is_primary: true })
    const supabase = createFakeSupabase(db)

    const result = await assignDriverToBooking(
      supabase,
      baseBooking,
      { mode: "existing", driverId: "driver-bilal" },
      { rawMessageText: "EXISTING_DRIVER: driver-bilal" },
    )

    assert.deepEqual(result, { ok: true })
    const updatedBooking = db.bookings.find((b) => b.id === baseBooking.bookingId)
    const linkedDriver = db.drivers.find((d) => d.id === updatedBooking?.driver_id)
    const linkedVehicle = db.vehicles.find((v) => v.id === updatedBooking?.vehicle_id)
    assert.equal(linkedDriver?.photo_url, "demo/drivers/bilal-ahmed.png")
    assert.equal(linkedVehicle?.stock_photo_url, "fleet/sedan.png")
  })

  it("returns driver_not_found when the driver id does not belong to this vendor", async () => {
    const db = emptyDb()
    seedBookingRow(db, baseBooking)
    db.drivers.push({ id: "driver-other-vendor", vendor_id: "vendor-2", full_name: "Someone Else", phone_e164: "+919000000000", status: "active" })
    const supabase = createFakeSupabase(db)

    const result = await assignDriverToBooking(
      supabase,
      baseBooking,
      { mode: "existing", driverId: "driver-other-vendor" },
      { rawMessageText: "x" },
    )

    assert.deepEqual(result, { ok: false, reason: "driver_not_found" })
  })

  it("returns inactive_driver for a saved driver that is no longer active", async () => {
    const db = emptyDb()
    seedBookingRow(db, baseBooking)
    db.drivers.push({ id: "driver-inactive", vendor_id: "vendor-1", full_name: "Old Driver", phone_e164: "+919000000001", status: "inactive" })
    const supabase = createFakeSupabase(db)

    const result = await assignDriverToBooking(
      supabase,
      baseBooking,
      { mode: "existing", driverId: "driver-inactive" },
      { rawMessageText: "x" },
    )

    assert.deepEqual(result, { ok: false, reason: "inactive_driver" })
  })

  it("returns vehicle_required when the driver has no primary vehicle on file", async () => {
    const db = emptyDb()
    seedBookingRow(db, baseBooking)
    db.drivers.push({ id: "driver-no-vehicle", vendor_id: "vendor-1", full_name: "New Driver", phone_e164: "+919000000002", status: "active" })
    const supabase = createFakeSupabase(db)

    const result = await assignDriverToBooking(
      supabase,
      baseBooking,
      { mode: "existing", driverId: "driver-no-vehicle" },
      { rawMessageText: "x" },
    )

    assert.deepEqual(result, { ok: false, reason: "vehicle_required" })
  })

  it("returns vehicle_required when the requested vehicleId is not linked to this driver", async () => {
    const db = emptyDb()
    seedBookingRow(db, baseBooking)
    db.drivers.push({ id: "driver-bilal", vendor_id: "vendor-1", full_name: "Bilal Ahmed", phone_e164: "+919876500001", status: "active" })
    db.vehicles.push({ id: "vehicle-other", vendor_id: "vendor-1", registration_number: "JK01ZZ9999", model: "Etios" })
    const supabase = createFakeSupabase(db)

    const result = await assignDriverToBooking(
      supabase,
      baseBooking,
      { mode: "existing", driverId: "driver-bilal", vehicleId: "vehicle-other" },
      { rawMessageText: "x" },
    )

    assert.deepEqual(result, { ok: false, reason: "vehicle_required" })
  })

  it("short-circuits on booking_not_assignable without reading drivers at all", async () => {
    const db = emptyDb()
    const supabase = createFakeSupabase(db)
    const attached: ResolvedVendorBooking = { ...baseBooking, status: "driver_attached" }

    const result = await assignDriverToBooking(
      supabase,
      attached,
      { mode: "existing", driverId: "does-not-matter" },
      { rawMessageText: "x" },
    )

    assert.deepEqual(result, { ok: false, reason: "booking_not_assignable" })
    assert.equal(db.drivers.length, 0)
  })
})

describe("assignDriverToBooking — manual mode", () => {
  it("creates a new driver + vehicle and links them as primary", async () => {
    const db = emptyDb()
    seedBookingRow(db, baseBooking)
    const supabase = createFakeSupabase(db)

    const result = await assignDriverToBooking(
      supabase,
      baseBooking,
      { mode: "manual", driverName: "Bilal Ahmed", driverPhone: "9876500001", vehicleNumber: "JK01AB1234", vehicleModel: "Swift Dzire" },
      { rawMessageText: "DRIVER: Bilal Ahmed | 9876500001 | JK01AB1234 | Swift Dzire" },
    )

    assert.deepEqual(result, { ok: true })
    assert.equal(db.drivers.length, 1)
    assert.equal(db.vehicles.length, 1)
    assert.equal(db.vehicles[0]?.registration_number, "JK01AB1234")
    assert.equal(db.driver_vehicle_links[0]?.is_primary, true)
    const updatedBooking = db.bookings.find((b) => b.id === baseBooking.bookingId)
    assert.equal(updatedBooking?.status, "driver_attached")
  })

  it("reuses the saved driver at the same phone when the typed name matches (case/whitespace-insensitive), without renaming", async () => {
    const db = emptyDb()
    seedBookingRow(db, baseBooking)
    db.drivers.push({ id: "driver-bilal", vendor_id: "vendor-1", full_name: "Bilal Ahmed", phone_e164: "+919876500001", phone_last10: "9876500001", status: "active" })
    const supabase = createFakeSupabase(db)

    const result = await assignDriverToBooking(
      supabase,
      baseBooking,
      { mode: "manual", driverName: "  bilal   ahmed  ", driverPhone: "9876500001", vehicleNumber: "jk01 ab 1234", vehicleModel: "Swift Dzire" },
      { rawMessageText: "x" },
    )

    assert.deepEqual(result, { ok: true })
    assert.equal(db.drivers.length, 1, "must not create a second driver row for the same phone")
    assert.equal(db.drivers[0]?.full_name, "Bilal Ahmed", "must not overwrite the saved driver's name")
    assert.equal(db.vehicles[0]?.registration_number, "JK01AB1234", "vehicle number is normalized before storage")
  })

  it("returns existing_driver_name_mismatch and does not rename the saved driver when the typed name differs", async () => {
    const db = emptyDb()
    seedBookingRow(db, baseBooking)
    db.drivers.push({ id: "driver-bilal", vendor_id: "vendor-1", full_name: "Bilal Ahmed", phone_e164: "+919876500001", phone_last10: "9876500001", status: "active" })
    const supabase = createFakeSupabase(db)

    const result = await assignDriverToBooking(
      supabase,
      baseBooking,
      { mode: "manual", driverName: "Someone Else", driverPhone: "9876500001", vehicleNumber: "JK01AB1234", vehicleModel: "Swift Dzire" },
      { rawMessageText: "x" },
    )

    assert.deepEqual(result, {
      ok: false,
      reason: "existing_driver_name_mismatch",
      existingDriver: { driverId: "driver-bilal", fullName: "Bilal Ahmed", phoneE164: "+919876500001" },
    })
    assert.equal(db.drivers.length, 1)
    assert.equal(db.drivers[0]?.full_name, "Bilal Ahmed", "the saved driver's name must be untouched")
    assert.equal(db.bookings.find((b) => b.id === baseBooking.bookingId)?.status, "vendor_confirmed", "booking must not be attached on conflict")
  })

  it("enqueues send_confirmation_card (not send_balance_payment) for non token_99 lock types", async () => {
    const db = emptyDb()
    const fullLockBooking: ResolvedVendorBooking = { ...baseBooking, lockType: "full", bookingId: "booking-2" }
    seedBookingRow(db, fullLockBooking)
    const supabase = createFakeSupabase(db)

    const result = await assignDriverToBooking(
      supabase,
      fullLockBooking,
      { mode: "manual", driverName: "New Driver", driverPhone: "9000000009", vehicleNumber: "JK01CD5678", vehicleModel: "Etios" },
      { rawMessageText: "x" },
    )

    assert.deepEqual(result, { ok: true })
    assert.equal(db.job_queue[0]?.job_type, "send_confirmation_card")
  })
})
