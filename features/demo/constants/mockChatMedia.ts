export const DEMO_CAR_IMAGE_URL =
  "https://images.unsplash.com/photo-1606664515524-ed2f786a0bd6?auto=format&fit=crop&w=800&q=80"

const DEMO_DRIVER_IMAGES: Record<string, string> = {
  "Bilal Ahmed": "/demo/drivers/bilal-ahmed.png",
  "Rashid Khan": "/demo/drivers/rashid-khan.png",
  "Imran Dar": "/demo/drivers/imran-dar.png",
  "Adil Mir": "/demo/drivers/adil-mir.png",
}

export function buildDemoDriverAvatarUrl(driverName: string): string {
  const localImage = DEMO_DRIVER_IMAGES[driverName.trim()]
  if (localImage) return localImage

  return `https://ui-avatars.com/api/?name=${encodeURIComponent(driverName)}&size=160&background=111111&color=ffffff&bold=true`
}

export function buildDemoDriverMedia(driverName: string) {
  return {
    carImageUrl: DEMO_CAR_IMAGE_URL,
    driverImageUrl: buildDemoDriverAvatarUrl(driverName),
  }
}
