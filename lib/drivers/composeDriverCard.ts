import "server-only"

import fs from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import sharp from "sharp"

const DRIVER_CARD_BUCKET = "driver-cards"
export const CARD_WIDTH = 800
export const CARD_HEIGHT = 418
const PORTRAIT_SIZE = 220
const PORTRAIT_MARGIN_RIGHT = 236
const PORTRAIT_MARGIN_TOP = 99
const JPEG_QUALITY = 82
const PLACEHOLDER_BACKGROUND = { r: 232, g: 220, b: 196 }

const DEMO_DRIVER_PHOTOS: Record<string, string> = {
  "bilal ahmed": "bilal-ahmed.png",
  "rashid khan": "rashid-khan.png",
  "imran dar": "imran-dar.png",
  "adil mir": "adil-mir.png",
}

/**
 * Resolves a path against `public/`, accepting it with or without a
 * leading slash or a `public/` prefix (so `drivers.photo_url` /
 * `vehicles.stock_photo_url` values written either way both resolve —
 * see docs/msg91-whatsapp-integration.md §3.6). Rejects `..` traversal
 * and OS-absolute paths (e.g. a Windows drive letter) so a bad DB value
 * can never read outside `public/`.
 */
export const loadLocalFile = async (relativePath: string): Promise<Buffer | null> => {
  const scoped = relativePath.replace(/^[/\\]+/, "").replace(/^public[/\\]+/, "")
  if (!scoped || scoped.includes("..") || path.isAbsolute(scoped)) {
    return null
  }
  try {
    return await fs.readFile(path.join(process.cwd(), "public", scoped))
  } catch {
    return null
  }
}

const loadRemoteBuffer = async (url: string, fetchImpl: typeof fetch): Promise<Buffer | null> => {
  try {
    const response = await fetchImpl(url)
    if (!response.ok) return null
    return Buffer.from(await response.arrayBuffer())
  } catch {
    return null
  }
}

/**
 * Confirms a buffer actually decodes as an image before it's handed to a
 * `sharp()` pipeline. A remote URL can return an HTML error page (or a
 * local file can be truncated/corrupt) — without this check that garbage
 * would throw deep inside `composeDriverCardJpeg` and abort the whole
 * card instead of falling back gracefully.
 */
const isDecodableImage = async (buffer: Buffer): Promise<boolean> => {
  try {
    await sharp(buffer).metadata()
    return true
  } catch {
    return false
  }
}

const resolveDriverPhoto = async (
  input: { photoUrl?: string | null; driverName: string },
  fetchImpl: typeof fetch,
): Promise<Buffer | null> => {
  const url = input.photoUrl?.trim()
  if (url?.startsWith("http://") || url?.startsWith("https://")) {
    const remote = await loadRemoteBuffer(url, fetchImpl)
    if (remote && (await isDecodableImage(remote))) return remote
  } else if (url) {
    const local = await loadLocalFile(url)
    if (local && (await isDecodableImage(local))) return local
  }

  const fileName = DEMO_DRIVER_PHOTOS[input.driverName.trim().toLowerCase()]
  if (fileName) {
    const demo = await loadLocalFile(path.posix.join("demo/drivers", fileName))
    if (demo && (await isDecodableImage(demo))) return demo
  }
  return null
}

const resolveCarStock = async (
  input: { stockPhotoUrl?: string | null; vehicleCode?: string | null },
  fetchImpl: typeof fetch,
): Promise<Buffer> => {
  const url = input.stockPhotoUrl?.trim()
  if (url?.startsWith("http://") || url?.startsWith("https://")) {
    const remote = await loadRemoteBuffer(url, fetchImpl)
    if (remote && (await isDecodableImage(remote))) return remote
  } else if (url) {
    const local = await loadLocalFile(url)
    if (local && (await isDecodableImage(local))) return local
  }

  const code = (input.vehicleCode?.trim() || "sedan").toLowerCase()
  const local = await loadLocalFile(path.posix.join("fleet", `${code}.png`))
  if (local && (await isDecodableImage(local))) return local

  return sharp({
    create: {
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      channels: 3,
      background: PLACEHOLDER_BACKGROUND,
    },
  })
    .jpeg()
    .toBuffer()
}

export const composeDriverCardJpeg = async (
  input: {
    driverName: string
    photoUrl?: string | null
    stockPhotoUrl?: string | null
    vehicleCode?: string | null
  },
  fetchImpl: typeof fetch = fetch,
): Promise<Buffer> => {
  const car = await resolveCarStock(
    { stockPhotoUrl: input.stockPhotoUrl, vehicleCode: input.vehicleCode },
    fetchImpl,
  )
  const driver = await resolveDriverPhoto(
    { photoUrl: input.photoUrl, driverName: input.driverName },
    fetchImpl,
  )

  const base = sharp(car).autoOrient().resize(CARD_WIDTH, CARD_HEIGHT, { fit: "cover" })
  if (!driver) {
    return base.jpeg({ quality: JPEG_QUALITY }).toBuffer()
  }

  const portrait = await sharp(driver)
    .autoOrient()
    .resize(PORTRAIT_SIZE, PORTRAIT_SIZE, { fit: "cover" })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer()

  return base
    .composite([{ input: portrait, left: CARD_WIDTH - PORTRAIT_MARGIN_RIGHT, top: PORTRAIT_MARGIN_TOP }])
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer()
}

export const uploadDriverCardJpeg = async (
  supabase: SupabaseClient,
  jpeg: Buffer,
): Promise<string | null> => {
  const objectPath = `${randomUUID()}.jpg`
  const { error } = await supabase.storage.from(DRIVER_CARD_BUCKET).upload(objectPath, jpeg, {
    contentType: "image/jpeg",
    upsert: false,
  })
  if (error) {
    console.error("[driver-card] upload failed", error.message)
    return null
  }
  const { data } = supabase.storage.from(DRIVER_CARD_BUCKET).getPublicUrl(objectPath)
  return data.publicUrl || null
}

export const composeAndUploadDriverCard = async (
  supabase: SupabaseClient,
  input: {
    driverName: string
    photoUrl?: string | null
    stockPhotoUrl?: string | null
    vehicleCode?: string | null
  },
): Promise<string | null> => {
  try {
    const jpeg = await composeDriverCardJpeg(input)
    return await uploadDriverCardJpeg(supabase, jpeg)
  } catch (error) {
    console.error("[driver-card] compose failed", error)
    return null
  }
}
