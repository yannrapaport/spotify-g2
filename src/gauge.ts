// ---------------------------------------------------------------------------
// gauge.ts
// True graphical progress gauge — a 400x20 image container painted at every
// progress-ticker tick. Uses the same pipeline as cover.ts: draw on an
// OffscreenCanvas, encode PNG, push via bridge.updateImageRawData (the host
// re-quantizes to gray4 itself).
//
// Skips the work when the visible fill width hasn't moved by at least 1 px,
// so a 200ms ticker on a 4-min track only produces ~1 update every ~600ms.
// ---------------------------------------------------------------------------

import { ImageRawDataUpdate, getBridge } from './bridge'

export const GAUGE_CONTAINER_ID = 11
export const GAUGE_CONTAINER_NAME = 'gauge'
// Image containers are capped at 288×144 by the SDK — the 288 width is what
// drives this gauge's resolution. Going wider would cause the host to reject
// the layout entirely (validation: "image container size … exceeds maximum
// 288x144").
export const GAUGE_W = 288
export const GAUGE_H = 20

let lastFillPx = -1

/** Reset the cache. Call after rebuildPageContainer (the image container is empty again). */
export function invalidateGaugeCache(): void {
  lastFillPx = -1
}

/** Paint the gauge for the given ratio (0..1). No-op if the fill width hasn't changed. */
export async function renderGauge(ratio: number): Promise<void> {
  const r = Math.max(0, Math.min(1, ratio))
  const fillPx = Math.round(r * (GAUGE_W - 2)) // -2 to leave the 1px border visible
  if (fillPx === lastFillPx) return
  lastFillPx = fillPx

  const canvas = new OffscreenCanvas(GAUGE_W, GAUGE_H)
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  // Background — dark fill so the empty portion of the gauge reads as "empty"
  // after the host's gray4 quantization (low luminance → near-black).
  ctx.fillStyle = 'rgb(40,40,40)'
  ctx.fillRect(0, 0, GAUGE_W, GAUGE_H)

  // Border — mid-grey 1px outline so the unfilled portion is still visible
  // even on the device's pure-greyscale display.
  ctx.fillStyle = 'rgb(180,180,180)'
  ctx.fillRect(0, 0, GAUGE_W, 1)
  ctx.fillRect(0, GAUGE_H - 1, GAUGE_W, 1)
  ctx.fillRect(0, 0, 1, GAUGE_H)
  ctx.fillRect(GAUGE_W - 1, 0, 1, GAUGE_H)

  // Filled portion — pure white → near-white after gray4 quantization.
  if (fillPx > 0) {
    ctx.fillStyle = 'rgb(255,255,255)'
    ctx.fillRect(1, 1, fillPx, GAUGE_H - 2)
  }

  let pngBlob: Blob
  try {
    pngBlob = await canvas.convertToBlob({ type: 'image/png' })
  } catch (err) {
    console.warn('[gauge] PNG encode failed:', err)
    return
  }
  const bytes = new Uint8Array(await pngBlob.arrayBuffer())

  try {
    const bridge = await getBridge()
    await bridge.updateImageRawData(
      new ImageRawDataUpdate({
        containerID: GAUGE_CONTAINER_ID,
        containerName: GAUGE_CONTAINER_NAME,
        imageData: Array.from(bytes),
      })
    )
  } catch (err) {
    console.warn('[gauge] updateImageRawData failed:', err)
  }
}
