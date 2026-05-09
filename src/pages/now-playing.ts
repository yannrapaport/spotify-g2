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
import { clearConfig } from '../config'

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

const TEXT_CONTAINER_ID = 1
const TEXT_CONTAINER_NAME = 'now_playing'
const COVER_CONTAINER_ID = 10
const COVER_CONTAINER_NAME = 'cover'
const NOW_PLAYING_POLL_MS = 2000
// Local "ticker" period for progress-bar smoothing between network polls.
const PROGRESS_TICK_MS = 200
// Number of segments in the progress bar.
const PROGRESS_BAR_SEGMENTS = 12

// Glyph picks. `▶` renders fine on LVGL (validated). `❚❚` does NOT.
// Tested fallbacks via simulator screenshot — `||` (two ASCII pipes) renders
// reliably and reads well at the size the title row uses.
const PLAY_GLYPH = '▶'
const PAUSE_GLYPH = '||'

// Two layout variants: full (cover + text), or text-only (errors / empty).
function fullLayout(content: string): {
  textObject: TextContainerProperty[]
  imageObject: ImageContainerProperty[]
  containerTotalNum: number
} {
  return {
    containerTotalNum: 2,
    textObject: [
      new TextContainerProperty({
        containerID: TEXT_CONTAINER_ID,
        containerName: TEXT_CONTAINER_NAME,
        xPosition: 160,
        yPosition: 8,
        width: 408,
        height: 272,
        borderWidth: 0,
        borderRadius: 0,
        paddingLength: 4,
        content,
        isEventCapture: 1,
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

/** "▰▰▰▰▰▱▱▱▱▱▱▱" — fixed-width progress bar with PROGRESS_BAR_SEGMENTS slots. */
function formatProgressBar(progressMs: number, durationMs: number): string {
  if (durationMs <= 0) return '▱'.repeat(PROGRESS_BAR_SEGMENTS)
  const ratio = Math.max(0, Math.min(1, progressMs / durationMs))
  const filled = Math.round(ratio * PROGRESS_BAR_SEGMENTS)
  return '▰'.repeat(filled) + '▱'.repeat(PROGRESS_BAR_SEGMENTS - filled)
}

function progressLine(np: NowPlaying): string | null {
  if (np.progressMs == null || np.durationMs == null || np.durationMs <= 0) {
    return null
  }
  const bar = formatProgressBar(np.progressMs, np.durationMs)
  return `${formatTime(np.progressMs)} ${bar} ${formatTime(np.durationMs)}`
}

function formatNowPlaying(np: NowPlaying | null): string {
  if (!np || !np.track) {
    return [
      '',
      '   Nothing playing',
      '',
      '──────────────────',
      '(·) play   (▲) like',
      '(▼) menu   (··) exit',
    ].join('\n')
  }

  const t = np.track
  const status = np.isPlaying ? PLAY_GLYPH : PAUSE_GLYPH
  const liked = t.isLiked ? ' ♥' : ''
  const artistsLine = t.artists.join(', ')

  // Either a progress line (when we have ms data) or the classic separator.
  const separator = progressLine(np) ?? '──────────────────'

  return [
    `${status} ${t.name}${liked}`,
    '',
    artistsLine,
    t.albumName,
    '',
    separator,
    '(·) play   (▲) like',
    '(▼) menu   (··) exit',
  ].join('\n')
}

function formatNoDevice(): string {
  return [
    '',
    '   Open Spotify',
    '   on phone first',
    '',
    '──────────────────',
    '(·) retry   (··) exit',
  ].join('\n')
}

function formatError(message: string): string {
  return [
    '',
    '   ' + message,
    '',
    '──────────────────',
    '(·) retry   (··) exit',
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

async function renderFromState(): Promise<void> {
  const np = readState()
  if (getNoDevice()) {
    await paintText(formatNoDevice())
    return
  }
  await paintText(formatNowPlaying(np))
  if (np?.track?.coverUrl) {
    void renderCover(np.track.id, np.track.coverUrl)
  }
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
    // Optimization: only repaint when the visible separator (bar/time) changes.
    const sep = progressLine(np)
    if (sep === lastPaintedSeparator) return
    lastPaintedSeparator = sep
    if (getNoDevice()) return
    void paintText(formatNowPlaying(np))
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

  invalidateCoverCache()
  setCurrentPage('now-playing')
  startPolling()
  // Force a fresh fetch on mount so the user sees current state immediately.
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
  setCurrentPage('now-playing')
}

// ---------------------------------------------------------------------------
// Lifecycle (called by main.ts on system events)
// ---------------------------------------------------------------------------

export function onForegroundEnter(): void {
  startPolling()
  void fetchAndRender()
}

export function onForegroundExit(): void {
  stopPolling()
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
