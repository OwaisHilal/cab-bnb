import assert from "node:assert/strict"
import { describe, it } from "node:test"
import sharp from "sharp"

import { CARD_HEIGHT, CARD_WIDTH, composeDriverCardJpeg, loadLocalFile } from "./composeDriverCard"

const tinyPng = (color: { r: number; g: number; b: number }): Promise<Buffer> =>
  sharp({ create: { width: 40, height: 40, channels: 3, background: color } })
    .png()
    .toBuffer()

const fetchReturning = (body: Buffer | string, status = 200): typeof fetch =>
  (async () => new Response(body, { status })) as unknown as typeof fetch

describe("loadLocalFile", () => {
  it("reads an existing public asset regardless of leading slash or public/ prefix", async () => {
    const direct = await loadLocalFile("vercel.svg")
    const leadingSlash = await loadLocalFile("/vercel.svg")
    const publicPrefixed = await loadLocalFile("public/vercel.svg")

    assert.ok(direct && direct.length > 0)
    assert.deepEqual(leadingSlash, direct)
    assert.deepEqual(publicPrefixed, direct)
  })

  it("rejects path traversal", async () => {
    assert.equal(await loadLocalFile("../secrets.txt"), null)
    assert.equal(await loadLocalFile("demo/../../secrets.txt"), null)
  })

  it("returns null for a missing file without throwing", async () => {
    assert.equal(await loadLocalFile("does-not-exist.png"), null)
  })
})

describe("composeDriverCardJpeg", () => {
  it("composites a driver portrait onto the car card when both images resolve over HTTPS", async () => {
    const carPng = await tinyPng({ r: 10, g: 20, b: 30 })
    const driverPng = await tinyPng({ r: 200, g: 200, b: 200 })
    const requestedUrls: string[] = []

    const fetchImpl = (async (input: string | URL) => {
      const url = String(input)
      requestedUrls.push(url)
      return new Response(url.includes("driver") ? driverPng : carPng, { status: 200 })
    }) as unknown as typeof fetch

    const jpeg = await composeDriverCardJpeg(
      {
        driverName: "Imran Dar",
        photoUrl: "https://example.com/driver-photo.png",
        stockPhotoUrl: "https://example.com/car-stock.png",
        vehicleCode: "sedan",
      },
      fetchImpl,
    )

    const metadata = await sharp(jpeg).metadata()
    assert.equal(metadata.format, "jpeg")
    assert.equal(metadata.width, CARD_WIDTH)
    assert.equal(metadata.height, CARD_HEIGHT)
    assert.deepEqual(
      requestedUrls.slice().sort(),
      ["https://example.com/car-stock.png", "https://example.com/driver-photo.png"].sort(),
    )
  })

  it("returns a car-only card when no driver photo resolves", async () => {
    const carPng = await tinyPng({ r: 5, g: 5, b: 5 })

    const jpeg = await composeDriverCardJpeg(
      {
        driverName: "Someone Not In Demo Roster",
        photoUrl: null,
        stockPhotoUrl: "https://example.com/car-stock.png",
        vehicleCode: "suv",
      },
      fetchReturning(carPng),
    )

    const metadata = await sharp(jpeg).metadata()
    assert.equal(metadata.format, "jpeg")
    assert.equal(metadata.width, CARD_WIDTH)
    assert.equal(metadata.height, CARD_HEIGHT)
  })

  it("falls back to a neutral placeholder card when the remote car stock fetch fails", async () => {
    const jpeg = await composeDriverCardJpeg(
      {
        driverName: "Someone Not In Demo Roster",
        photoUrl: null,
        stockPhotoUrl: "https://example.com/missing-car.png",
        vehicleCode: "unknown-code",
      },
      fetchReturning("not found", 404),
    )

    const metadata = await sharp(jpeg).metadata()
    assert.equal(metadata.format, "jpeg")
    assert.equal(metadata.width, CARD_WIDTH)
    assert.equal(metadata.height, CARD_HEIGHT)
  })

  it("falls back to a placeholder when the remote response is not a decodable image", async () => {
    const jpeg = await composeDriverCardJpeg(
      {
        driverName: "Someone Not In Demo Roster",
        photoUrl: null,
        stockPhotoUrl: "https://example.com/car.png",
        vehicleCode: "sedan",
      },
      fetchReturning("<html>not an image</html>"),
    )

    const metadata = await sharp(jpeg).metadata()
    assert.equal(metadata.format, "jpeg")
    assert.equal(metadata.width, CARD_WIDTH)
    assert.equal(metadata.height, CARD_HEIGHT)
  })
})
