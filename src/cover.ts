// ---------------------------------------------------------------------------
// cover.ts
// Album-cover pipeline: fetch a Spotify image URL → downscale to 144x144 →
// re-encode as PNG → push to the image container via updateImageRawData.
//
// Implementation note on imageData format:
//   The SDK accepts raw bytes here, and the doc string suggests a packed
//   4-bit greyscale buffer (2 pixels per byte). Empirically that fails on the
//   simulator with "image format could not be determined": the host-side path
//   (both simulator and, by inference, real device) decodes a standard image
//   format (PNG/JPEG) and does the gray4 quantization itself. So we send a
//   PNG, not a packed nibble buffer. No nibble ordering / bit-direction
//   ambiguity to worry about — the host owns that step.
// ---------------------------------------------------------------------------

import { ImageRawDataUpdate, getBridge } from './bridge'

const COVER_CONTAINER_ID = 10
const COVER_CONTAINER_NAME = 'cover'
const COVER_SIZE = 144

let lastRenderedTrackId: string | null = null
let lastRenderedUrl: string | null = null

/**
 * Reset the cache. Call when the page is re-mounted with a fresh container,
 * so that the next renderCover() actually pushes data even if the track is
 * unchanged (the image container itself was re-created and is currently empty).
 */
export function invalidateCoverCache(): void {
  lastRenderedTrackId = null
  lastRenderedUrl = null
}

/**
 * Fetch a cover URL, downscale to 144x144, quantize luminance to 4 bits,
 * pack two pixels per byte, and push to the image container.
 *
 * Skips the work entirely when called twice in a row with the same trackId.
 */
export async function renderCover(trackId: string, url: string): Promise<void> {
  if (lastRenderedTrackId === trackId && lastRenderedUrl === url) {
    return
  }

  let blob: Blob
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`cover fetch ${res.status}`)
    blob = await res.blob()
  } catch (err) {
    console.warn('[cover] fetch failed:', err)
    return
  }

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(blob)
  } catch (err) {
    console.warn('[cover] decode failed:', err)
    return
  }

  // Downscale to 144x144 onto an OffscreenCanvas; let the browser do the
  // resampling (better than rolling our own).
  const canvas = new OffscreenCanvas(COVER_SIZE, COVER_SIZE)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    console.warn('[cover] no 2d context')
    return
  }
  ctx.drawImage(bitmap, 0, 0, COVER_SIZE, COVER_SIZE)

  // Pre-process the image so the host's gray4 quantization preserves photo
  // detail. The host appears to threshold/quantize aggressively, so feeding
  // it a raw downscaled photo collapses most of the tonal range. Three steps:
  //   1. Luminance (Rec. 601: 0.299 R + 0.587 G + 0.114 B)
  //   2. Auto-contrast (stretch observed min/max → 0/255)
  //   3. Floyd-Steinberg dither to 16 evenly-spaced grey levels
  preprocessForGray4(ctx)

  // The host accepts PNG/JPEG bytes as imageData and does the gray4 conversion
  // itself (verified empirically against the simulator: raw 4-bit packed bytes
  // fail with "image format could not be determined").
  let pngBlob: Blob
  try {
    pngBlob = await canvas.convertToBlob({ type: 'image/png' })
  } catch (err) {
    console.warn('[cover] PNG encode failed:', err)
    return
  }
  const pngBytes = new Uint8Array(await pngBlob.arrayBuffer())

  try {
    const bridge = await getBridge()
    await bridge.updateImageRawData(
      new ImageRawDataUpdate({
        containerID: COVER_CONTAINER_ID,
        containerName: COVER_CONTAINER_NAME,
        imageData: Array.from(pngBytes),
      })
    )
    lastRenderedTrackId = trackId
    lastRenderedUrl = url
  } catch (err) {
    console.warn('[cover] updateImageRawData failed:', err)
  }
}

function preprocessForGray4(ctx: OffscreenCanvasRenderingContext2D): void {
  const imageData = ctx.getImageData(0, 0, COVER_SIZE, COVER_SIZE)
  const rgba = imageData.data
  const N = COVER_SIZE * COVER_SIZE

  // 1. Luminance into a Float32 buffer (need fractional values for diffusion)
  const gray = new Float32Array(N)
  let min = 255
  let max = 0
  for (let i = 0; i < N; i++) {
    const y = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]
    gray[i] = y
    if (y < min) min = y
    if (y > max) max = y
  }

  // 2. Auto-contrast: stretch observed range to full 0–255
  const range = max - min
  if (range > 1) {
    const scale = 255 / range
    for (let i = 0; i < N; i++) {
      gray[i] = (gray[i] - min) * scale
    }
  }

  // 3. Floyd-Steinberg dither to 16 levels (0, 17, 34, …, 255).
  // Quantizing to multiples of 17 means each level lands at the centre of one
  // of the host's gray4 buckets, surviving its quantization step.
  for (let y = 0; y < COVER_SIZE; y++) {
    for (let x = 0; x < COVER_SIZE; x++) {
      const idx = y * COVER_SIZE + x
      const old = gray[idx]
      let n = Math.round(old / 17)
      if (n < 0) n = 0
      else if (n > 15) n = 15
      const newVal = n * 17
      gray[idx] = newVal
      const err = old - newVal
      if (x + 1 < COVER_SIZE) gray[idx + 1] += err * (7 / 16)
      if (y + 1 < COVER_SIZE) {
        if (x > 0) gray[idx + COVER_SIZE - 1] += err * (3 / 16)
        gray[idx + COVER_SIZE] += err * (5 / 16)
        if (x + 1 < COVER_SIZE) gray[idx + COVER_SIZE + 1] += err * (1 / 16)
      }
    }
  }

  // Write back as RGB greyscale (R=G=B=v). Alpha already 255 from drawImage.
  for (let i = 0; i < N; i++) {
    const v = gray[i] < 0 ? 0 : gray[i] > 255 ? 255 : Math.round(gray[i])
    rgba[i * 4] = v
    rgba[i * 4 + 1] = v
    rgba[i * 4 + 2] = v
  }
  ctx.putImageData(imageData, 0, 0)
}
