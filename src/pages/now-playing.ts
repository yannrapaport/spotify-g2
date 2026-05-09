// ---------------------------------------------------------------------------
// pages/now-playing.ts
//
// Layout A — "Album Hero":
//   - Image container (144x144) on the left for the album cover
//   - Text container on the right (408x272) for title / artist / album / hints
//
// On error / empty states we drop the image container entirely so the text
// can take the full width.
//
// Inputs (mapped through `dispatch`):
//   - press        -> play / pause then immediate refetch
//   - swipe up     -> like current track then refetch
//   - swipe down   -> switch to the menu page
//   - double press -> request system exit dialog
// ---------------------------------------------------------------------------

import {
  CreateStartUpPageContainer,
  RebuildPageContainer,
  StartUpPageCreateResult,
  TextContainerProperty,
  TextContainerUpgrade,
  ImageContainerProperty,
  OsEventTypeList,
  getBridge,
} from '../bridge'
import type { EvenHubEvent } from '../bridge'
import * as moodify from '../moodify-client'
import {
  MoodifyAuthError,
  NoDeviceError,
  SpotifyNotConnectedError,
} from '../moodify-client'
import {
  getNowPlaying as readState,
  setCurrentPage,
  setErrorMessage,
  setNowPlaying,
  setNoDevice,
  getNoDevice,
} from '../state'
import type { NowPlaying } from '../types'
import { mountMenu } from './menu'
import { renderCover, invalidateCoverCache } from '../cover'
import {
  renderGauge,
  invalidateGaugeCache,
  GAUGE_CONTAINER_ID,
  GAUGE_CONTAINER_NAME,
  GAUGE_W,
  GAUGE_H,
} from '../gauge'
import { clearConfig } from '../config'

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

const TEXT_CONTAINER_ID = 1
const TEXT_CONTAINER_NAME = 'now_playing'
const TIME_CONTAINER_ID = 12
const TIME_CONTAINER_NAME = 'progress_time'
const COVER_CONTAINER_ID = 10
const COVER_CONTAINER_NAME = 'cover'
const NOW_PLAYING_POLL_MS = 2000
const PROGRESS_TICK_MS = 200
const DIM_AFTER_MS = 5000

// Max chars before truncation — keeps text within the 408×228 container so
// swipe-down is never swallowed by the host as a "scroll text" gesture.
const MAX_TITLE = 26
const MAX_ARTISTS = 28
const MAX_ALBUM = 24

// Glyph picks. `▶` renders fine on LVGL (validated). `❚❚` does NOT.
// Tested fallbacks via simulator screenshot — `||` (two ASCII pipes) renders
// reliably and reads well at the size the title row uses.
const PLAY_GLYPH = '▶'
const PAUSE_GLYPH = '||'

// Layout:
//   x=0    cover 144×144
//   x=160  main text 408×228 (isEventCapture)
//   x=160  time text 90×22 at y=254 (e.g. "1:23 / 4:12")
//   x=256  gauge image 288×20 at y=255
//
// Text height capped at 228 so content never overflows — overflow makes the
// host swallow swipe-down as a text-scroll gesture instead of firing our handler.
function fullLayout(content: string): {
  textObject: TextContainerProperty[]
  imageObject: ImageContainerProperty[]
  containerTotalNum: number
} {
  return {
    containerTotalNum: 4,
    textObject: [
      new TextContainerProperty({
        containerID: TEXT_CONTAINER_ID,
        containerName: TEXT_CONTAINER_NAME,
        xPosition: 160,
        yPosition: 0,
        width: 408,
        height: 228,
        borderWidth: 0,
        borderRadius: 0,
        paddingLength: 4,
        content,
        isEventCapture: 1,
      }),
      new TextContainerProperty({
        containerID: TIME_CONTAINER_ID,
        containerName: TIME_CONTAINER_NAME,
        xPosition: 160,
        yPosition: 254,
        width: 90,
        height: 22,
        borderWidth: 0,
        paddingLength: 0,
        content: '',
        isEventCapture: 0,
      }),
    ],
    imageObject: [
      new ImageContainerProperty({
        containerID: COVER_CONTAINER_ID,
        containerName: COVER_CONTAINER_NAME,
        xPosition: 0,
        yPosition: 0,
        width: 144,
        height: 144,
      }),
      new ImageContainerProperty({
        containerID: GAUGE_CONTAINER_ID,
        containerName: GAUGE_CONTAINER_NAME,
        xPosition: 256,
        yPosition: 255,
        width: GAUGE_W,
        height: GAUGE_H,
      }),
    ],
  }
}

function textOnlyLayout(content: string): {
  textObject: TextContainerProperty[]
  imageObject: undefined
  containerTotalNum: number
} {
  return {
    containerTotalNum: 1,
    textObject: [
      new TextContainerProperty({
        containerID: TEXT_CONTAINER_ID,
        containerName: TEXT_CONTAINER_NAME,
        xPosition: 0,
        yPosition: 0,
        width: 576,
        height: 288,
        borderWidth: 1,
        borderColor: 5,
        borderRadius: 2,
        paddingLength: 8,
        content,
        isEventCapture: 1,
      }),
    ],
    imageObject: undefined,
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** "1:05" / "15:23" — minutes:seconds, two-digit seconds. */
function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s < 10 ? '0' : ''}${s}`
}

function trunc(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

/** Time string for the dedicated time container: "1:23 / 4:12" */
function formatTimeLabel(np: NowPlaying): string {
  if (np.progressMs == null || np.durationMs == null || np.durationMs <= 0) return ''
  return `${formatTime(np.progressMs)}/${formatTime(np.durationMs)}`
}

function formatNowPlaying(np: NowPlaying | null): string {
  if (!np || !np.track) {
    return [
      '',
      '   Nothing playing',
      '',
      '(·) play  (▲) like  (▼) menu  (··) exit',
    ].join('\n')
  }

  const t = np.track
  const status = np.isPlaying ? PLAY_GLYPH : PAUSE_GLYPH
  const liked = t.isLiked ? ' ♥' : ''

  return [
    `${status} ${trunc(t.name, MAX_TITLE)}${liked}`,
    '',
    trunc(t.artists.join(', '), MAX_ARTISTS),
    trunc(t.albumName, MAX_ALBUM),
    '',
    '(·) play  (▲) like  (▼) menu  (··) exit',
  ].join('\n')
}

function formatNoDevice(): string {
  return [
    '',
    '   Open Spotify on phone first',
    '',
    '(·) retry              (··) exit',
  ].join('\n')
}

function formatError(message: string): string {
  return [
    '',
    '   ' + message,
    '',
    '(·) retry              (··) exit',
  ].join('\n')
}

async function paintText(content: string): Promise<void> {
  const bridge = await getBridge()
  await bridge.textContainerUpgrade(
    new TextContainerUpgrade({
      containerID: TEXT_CONTAINER_ID,
      containerName: TEXT_CONTAINER_NAME,
      content,
      contentOffset: 0,
      contentLength: content.length,
    })
  )
}

async function paintTime(label: string): Promise<void> {
  const bridge = await getBridge()
  await bridge.textContainerUpgrade(
    new TextContainerUpgrade({
      containerID: TIME_CONTAINER_ID,
      containerName: TIME_CONTAINER_NAME,
      content: label,
      contentOffset: 0,
      contentLength: label.length,
    })
  )
}

async function renderFromState(): Promise<void> {
  const np = readState()
  if (getNoDevice()) {
    await paintText(formatNoDevice())
    return
  }
  await paintText(formatNowPlaying(np))
  if (np) {
    void paintTime(formatTimeLabel(np))
    if (np.progressMs != null && np.durationMs != null && np.durationMs > 0) {
      void renderGauge(np.progressMs / np.durationMs)
    }
  }
  if (np?.track?.coverUrl) {
    void renderCover(np.track.id, np.track.coverUrl)
  }
}

// ---------------------------------------------------------------------------
// Screen dim — blanks the display after DIM_AFTER_MS of no gesture.
// Any ring/touchpad input wakes back to now-playing.
// ---------------------------------------------------------------------------

let isDimmed = false
let dimTimeout: ReturnType<typeof setTimeout> | null = null

function resetDimTimer(): void {
  if (dimTimeout !== null) clearTimeout(dimTimeout)
  dimTimeout = setTimeout(() => { void dimScreen() }, DIM_AFTER_MS)
}

function cancelDimTimer(): void {
  if (dimTimeout !== null) { clearTimeout(dimTimeout); dimTimeout = null }
}

async function dimScreen(): Promise<void> {
  isDimmed = true
  stopPolling()
  cancelDimTimer()
  const bridge = await getBridge()
  await bridge.rebuildPageContainer(new RebuildPageContainer({
    containerTotalNum: 1,
    textObject: [new TextContainerProperty({
      containerID: TEXT_CONTAINER_ID,
      containerName: TEXT_CONTAINER_NAME,
      xPosition: 0,
      yPosition: 0,
      width: 576,
      height: 288,
      borderWidth: 0,
      paddingLength: 0,
      content: '',
      isEventCapture: 1,
    })],
  }))
}

// ---------------------------------------------------------------------------
// Progress ticker — smooths the bar between network polls.
//
// Every PROGRESS_TICK_MS we increment the in-memory progressMs (when playing)
// by PROGRESS_TICK_MS, and re-paint the text container. The next network poll
// resets us to ground truth.
// ---------------------------------------------------------------------------

let progressTimer: ReturnType<typeof setInterval> | null = null
let lastPaintedSeparator: string | null = null

function startProgressTicker(): void {
  if (progressTimer !== null) return
  progressTimer = setInterval(() => {
    const np = readState()
    if (!np || !np.isPlaying || np.progressMs == null || np.durationMs == null) {
      return
    }
    np.progressMs = Math.min(np.durationMs, np.progressMs + PROGRESS_TICK_MS)
    setNowPlaying(np)
    if (getNoDevice()) return
    // Gauge: skips internally when fill width hasn't moved.
    void renderGauge(np.progressMs / np.durationMs)
    // Time label: repaint only when the string changes (~1x/s).
    const label = formatTimeLabel(np)
    if (label === lastPaintedSeparator) return
    lastPaintedSeparator = label
    void paintTime(label)
  }, PROGRESS_TICK_MS)
}

function stopProgressTicker(): void {
  if (progressTimer !== null) {
    clearInterval(progressTimer)
    progressTimer = null
  }
  lastPaintedSeparator = null
}

// ---------------------------------------------------------------------------
// Polling
// ---------------------------------------------------------------------------

let pollTimer: ReturnType<typeof setInterval> | null = null
let inFlightAbort: AbortController | null = null

async function fetchAndRender(): Promise<void> {
  // Cancel any in-flight request before starting a new one.
  inFlightAbort?.abort()
  const ac = new AbortController()
  inFlightAbort = ac

  try {
    const np = await moodify.getNowPlaying(ac.signal)
    if (ac.signal.aborted) return
    setNowPlaying(np)
    setErrorMessage(null)
    // Reset the ticker's diff cache so the new ground truth re-paints once.
    lastPaintedSeparator = null
    // If state went from "had a track" to "no track", we keep the full layout
    // but text indicates nothing playing. To avoid stale cover, we don't
    // re-paint the image (the container will hold its last bytes — acceptable
    // for the momentary gap between tracks).
    await renderFromState()
  } catch (err) {
    if (ac.signal.aborted) return
    if (err instanceof SpotifyNotConnectedError) {
      setErrorMessage('Connect Spotify on phone')
      await mountTextOnly('Connect Spotify on phone')
    } else if (err instanceof MoodifyAuthError) {
      setErrorMessage('Auth error — check API key')
      await mountTextOnly('Auth error - check key')
    } else {
      console.warn('[now-playing] fetch failed:', err)
      // Keep the previous state on transient errors; only paint if no prior state.
      if (!readState()) {
        await mountTextOnly('Backend unreachable')
      }
    }
  } finally {
    if (inFlightAbort === ac) inFlightAbort = null
  }
}

function startPolling(): void {
  if (pollTimer !== null) return
  pollTimer = setInterval(() => {
    void fetchAndRender()
  }, NOW_PLAYING_POLL_MS)
  startProgressTicker()
}

function stopPolling(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  inFlightAbort?.abort()
  inFlightAbort = null
  stopProgressTicker()
  cancelDimTimer()
}

// ---------------------------------------------------------------------------
// Mounting
// ---------------------------------------------------------------------------

let booted = false

/**
 * Mount the full Layout A (cover + text). On first call uses createStartUp,
 * subsequent calls use rebuild. After rebuild, the cover container is empty
 * again — we invalidate the cache so the next renderCover() will repush.
 */
export async function mountNowPlaying(): Promise<void> {
  const bridge = await getBridge()
  const layout = fullLayout(formatNowPlaying(readState()))

  if (!booted) {
    const result = await bridge.createStartUpPageContainer(
      new CreateStartUpPageContainer(layout)
    )
    if (result === StartUpPageCreateResult.success) {
      booted = true
    } else {
      console.warn(
        '[now-playing] createStartUpPageContainer returned',
        result,
        '— falling back to rebuild'
      )
      await bridge.rebuildPageContainer(new RebuildPageContainer(layout))
      booted = true
    }
  } else {
    await bridge.rebuildPageContainer(new RebuildPageContainer(layout))
  }

  isDimmed = false
  invalidateCoverCache()
  invalidateGaugeCache()
  setCurrentPage('now-playing')
  startPolling()
  resetDimTimer()
  void fetchAndRender()
}

/**
 * Mount the text-only variant (no cover). Used for error / empty states.
 */
async function mountTextOnly(message: string): Promise<void> {
  const bridge = await getBridge()
  const layout = textOnlyLayout(formatError(message))
  if (!booted) {
    const result = await bridge.createStartUpPageContainer(
      new CreateStartUpPageContainer({
        containerTotalNum: layout.containerTotalNum,
        textObject: layout.textObject,
      })
    )
    if (result !== StartUpPageCreateResult.success) {
      await bridge.rebuildPageContainer(
        new RebuildPageContainer({
          containerTotalNum: layout.containerTotalNum,
          textObject: layout.textObject,
        })
      )
    }
    booted = true
  } else {
    await bridge.rebuildPageContainer(
      new RebuildPageContainer({
        containerTotalNum: layout.containerTotalNum,
        textObject: layout.textObject,
      })
    )
  }
  invalidateCoverCache()
  invalidateGaugeCache()
  setCurrentPage('now-playing')
}

// ---------------------------------------------------------------------------
// Lifecycle (called by main.ts on system events)
// ---------------------------------------------------------------------------

export function onForegroundEnter(): void {
  isDimmed = false
  startPolling()
  resetDimTimer()
  void fetchAndRender()
}

export function onForegroundExit(): void {
  stopPolling() // also cancels dim timer
}

export function onShutdown(): void {
  stopPolling()
}

// ---------------------------------------------------------------------------
// Input handling
// ---------------------------------------------------------------------------

/**
 * Dispatch an EvenHubEvent for the now-playing page.
 *
 * Notes on event shape:
 * - On a text container, single click arrives either as a sysEvent with
 *   eventSource set but eventType missing (zero-value protobuf elision), or
 *   as a textEvent with eventType=CLICK_EVENT (=0).
 * - Swipe gestures arrive as textEvent with eventType 1/2.
 * - Double click arrives as sysEvent with eventType=DOUBLE_CLICK_EVENT (=3).
 */
// Secret reset gesture: 3 double-taps within 3 seconds on the now-playing
// page clears the runtime config and shuts down the plugin. The user
// re-launches and lands on the config form again. The threshold is high
// enough not to fire by accident from a single user double-tapping to exit.
const RESET_GESTURE_TAPS = 3
const RESET_GESTURE_WINDOW_MS = 3000
let doubleTapTimestamps: number[] = []

async function recordDoubleTapForReset(): Promise<boolean> {
  const now = Date.now()
  doubleTapTimestamps = [
    ...doubleTapTimestamps.filter((t) => now - t < RESET_GESTURE_WINDOW_MS),
    now,
  ]
  if (doubleTapTimestamps.length < RESET_GESTURE_TAPS) return false
  doubleTapTimestamps = []
  console.warn('[now-playing] reset gesture detected — clearing config')
  await clearConfig()
  return true
}

export async function dispatchNowPlaying(event: EvenHubEvent): Promise<void> {
  // Any gesture wakes the screen if dimmed.
  if (isDimmed) {
    isDimmed = false
    await mountNowPlaying()
    return
  }
  resetDimTimer()

  // Double-press always lives on sysEvent
  const sys = event.sysEvent
  if (sys) {
    const t = sys.eventType ?? 0
    if (t === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      const bridge = await getBridge()
      const triggered = await recordDoubleTapForReset()
      // Either way we exit the page container; on the next launch the
      // plugin will see no config and render the config form again.
      await bridge.shutDownPageContainer(triggered ? 0 : 1)
      return
    }
    // Treat sysEvent with a source but no eventType as a single click on the
    // text container (some firmwares omit the zero-valued eventType).
    const hasSource = sys.eventSource !== undefined && sys.eventSource !== 0
    if (sys.eventType === undefined && hasSource) {
      await handlePress()
      return
    }
    if (t === OsEventTypeList.CLICK_EVENT && hasSource) {
      await handlePress()
      return
    }
  }

  const text = event.textEvent
  if (text) {
    const t = text.eventType ?? 0
    if (t === OsEventTypeList.CLICK_EVENT) {
      await handlePress()
    } else if (t === OsEventTypeList.SCROLL_TOP_EVENT) {
      await handleSwipeUp()
    } else if (t === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
      await handleSwipeDown()
    } else if (t === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      const bridge = await getBridge()
      const triggered = await recordDoubleTapForReset()
      await bridge.shutDownPageContainer(triggered ? 0 : 1)
    }
  }
}

async function handlePress(): Promise<void> {
  try {
    await moodify.playPause()
    setNoDevice(false)
    await fetchAndRender()
  } catch (err) {
    if (err instanceof NoDeviceError) {
      // Show "Open Spotify on phone first" until the user retries successfully.
      setNoDevice(true)
      await paintText(formatNoDevice())
      return
    }
    console.warn('[now-playing] play/pause failed:', err)
  }
}

async function handleSwipeUp(): Promise<void> {
  try {
    await moodify.like()
    await fetchAndRender()
  } catch (err) {
    console.warn('[now-playing] like failed:', err)
  }
}

async function handleSwipeDown(): Promise<void> {
  stopPolling()
  await mountMenu()
}
