// ---------------------------------------------------------------------------
// pages/now-playing.ts
//
// Main screen — one big text container that shows the currently playing track.
// Polls `/api/g2/now-playing` every NOW_PLAYING_POLL_MS while the page is in
// the foreground; pauses while in the background.
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
  OsEventTypeList,
  getBridge,
} from '../bridge'
import type { EvenHubEvent } from '../bridge'
import * as moodify from '../moodify-client'
import {
  MoodifyAuthError,
  SpotifyNotConnectedError,
} from '../moodify-client'
import {
  getNowPlaying as readState,
  setCurrentPage,
  setErrorMessage,
  setNowPlaying,
} from '../state'
import type { NowPlaying } from '../types'
import { mountMenu } from './menu'

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

const CONTAINER_ID = 1
const CONTAINER_NAME = 'now_playing'
const NOW_PLAYING_POLL_MS = 5000

function nowPlayingContainer(content: string): TextContainerProperty {
  return new TextContainerProperty({
    containerID: CONTAINER_ID,
    containerName: CONTAINER_NAME,
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
  })
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function formatNowPlaying(np: NowPlaying | null): string {
  if (!np || !np.track) {
    return [
      '',
      '   Nothing playing',
      '',
      '',
      '',
      'press: play  swipe-up: like',
      'swipe-down: menu',
    ].join('\n')
  }

  const t = np.track
  const status = np.isPlaying ? '▶' : '❚❚'
  const liked = t.isLiked ? ' ♥' : ''
  const artistsLine = t.artists.join(', ')

  return [
    `${status} ${t.name}${liked}`,
    '',
    artistsLine,
    t.albumName,
    '',
    'press: play/pause   swipe-up: like',
    'swipe-down: menu    double: exit',
  ].join('\n')
}

function formatError(message: string): string {
  return [
    '',
    '   ' + message,
    '',
    '',
    'press: retry',
  ].join('\n')
}

async function paint(content: string): Promise<void> {
  const bridge = await getBridge()
  await bridge.textContainerUpgrade(
    new TextContainerUpgrade({
      containerID: CONTAINER_ID,
      containerName: CONTAINER_NAME,
      content,
      contentOffset: 0,
      contentLength: content.length,
    })
  )
}

async function render(): Promise<void> {
  await paint(formatNowPlaying(readState()))
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
    await render()
  } catch (err) {
    if (ac.signal.aborted) return
    if (err instanceof SpotifyNotConnectedError) {
      setErrorMessage('Connect Spotify on phone')
      await paint(formatError('Connect Spotify on phone'))
    } else if (err instanceof MoodifyAuthError) {
      setErrorMessage('Auth error — check API key')
      await paint(formatError('Auth error - check key'))
    } else {
      console.warn('[now-playing] fetch failed:', err)
      // Keep the previous state on transient errors; only paint if no prior state.
      if (!readState()) {
        await paint(formatError('Backend unreachable'))
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
}

function stopPolling(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  inFlightAbort?.abort()
  inFlightAbort = null
}

// ---------------------------------------------------------------------------
// Mounting
// ---------------------------------------------------------------------------

let booted = false

/**
 * Boot the page on first call (createStartUpPageContainer); rebuild on every
 * subsequent call. If the host returns anything other than `success` on
 * createStartUp (HMR case: host kept the old container), fall back to
 * rebuildPageContainer.
 */
export async function mountNowPlaying(): Promise<void> {
  const bridge = await getBridge()
  const props = [nowPlayingContainer(formatNowPlaying(readState()))]

  if (!booted) {
    const result = await bridge.createStartUpPageContainer(
      new CreateStartUpPageContainer({
        containerTotalNum: 1,
        textObject: props,
      })
    )
    if (result === StartUpPageCreateResult.success) {
      booted = true
    } else {
      console.warn(
        '[now-playing] createStartUpPageContainer returned',
        result,
        '— falling back to rebuild'
      )
      await bridge.rebuildPageContainer(
        new RebuildPageContainer({
          containerTotalNum: 1,
          textObject: props,
        })
      )
      booted = true
    }
  } else {
    await bridge.rebuildPageContainer(
      new RebuildPageContainer({
        containerTotalNum: 1,
        textObject: props,
      })
    )
  }

  setCurrentPage('now-playing')
  startPolling()
  // Force a fresh fetch on mount so the user sees current state immediately.
  void fetchAndRender()
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
export async function dispatchNowPlaying(event: EvenHubEvent): Promise<void> {
  // Double-press always lives on sysEvent
  const sys = event.sysEvent
  if (sys) {
    const t = sys.eventType ?? 0
    if (t === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      const bridge = await getBridge()
      await bridge.shutDownPageContainer(1)
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
      await bridge.shutDownPageContainer(1)
    }
  }
}

async function handlePress(): Promise<void> {
  try {
    await moodify.playPause()
    await fetchAndRender()
  } catch (err) {
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
