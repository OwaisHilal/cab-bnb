import "server-only"

import fs from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import sharp from "sharp"

const DRIVER_CARD_BUCKET = "driver-cards"
const CARD_WIDTH = 800
const CARD_HEIGHT = 418

const DEMO_DRIVER_PHOTOS: Record<string, string> = {
  "bilal ahmed": "bilal-ahmed.png",
  "rashid khan": "rashid-khan.png",
  "imran dar": "imran-dar.png",
  "adil mir": "adil-mir.png",
}

const loadLocalFile = async (relativePath: string): Promise<Buffer | null> => {
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

const loadRemoteBuffer = async (url: string): Promise<Buffer | null> => {
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    return Buffer.from(await response.arrayBuffer())
  } catch {
    return null
  }
}

const resolveDriverPhoto = async (input: {
  photoUrl?: string | null
  driverName: string
}): Promise<Buffer | null> => {
  const url = input.photoUrl?.trim()
  if (url?.startsWith("http://") || url?.startsWith("https://")) {
    const remote = await loadRemoteBuffer(url)
    if (remote) return remote
  }
  if (url && !url.startsWith("http")) {
    const local = await loadLocalFile(url.replace(/^\//, ""))
    if (local) return local
  }
  const fileName = DEMO_DRIVER_PHOTOS[input.driverName.trim().toLowerCase()]
  if (fileName) {
    return loadLocalFile(path.join("public/demo/drivers", fileName))
  }
  return null
}

const resolveCarStock = async (input: {
  stockPhotoUrl?: string | null
  vehicleCode?: string | null
}): Promise<Buffer> => {
  const url = input.stockPhotoUrl?.trim()
  if (url?.startsWith("http://") || url?.startsWith("https://")) {
    const remote = await loadRemoteBuffer(url)
    if (remote) return remote
  }
  const code = (input.vehicleCode ?? "sedan").toLowerCase()
  const local = await loadLocalFile(path.join("public/fleet", `${code}.png`))
  if (local) return local
  return sharp({
    create: {
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      channels: 3,
      background: { r: 232, g: 220, b: 196 },
    },
  })
    .jpeg()
    .toBuffer()
}

export const composeDriverCardJpeg = async (input: {
  driverName: string
  photoUrl?: string | null
  stockPhotoUrl?: string | null
  vehicleCode?: string | null
}): Promise<Buffer> => {
  const car = await resolveCarStock({
    stockPhotoUrl: input.stockPhotoUrl,
    vehicleCode: input.vehicleCode,
  })
  const driver = await resolveDriverPhoto({
    photoUrl: input.photoUrl,
    driverName: input.driverName,
  })

  const base = sharp(car).resize(CARD_WIDTH, CARD_HEIGHT, { fit: "cover" })
  if (!driver) {
    return base.jpeg({ quality: 82 }).toBuffer()
  }

  const portrait = await sharp(driver)
    .resize(220, 220, { fit: "cover" })
    .jpeg({ quality: 82 })
    .toBuffer()

  return base
    .composite([{ input: portrait, left: CARD_WIDTH - 236, top: 99 }])
    .jpeg({ quality: 82 })
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
