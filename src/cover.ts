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
