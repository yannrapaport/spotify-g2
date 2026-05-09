// ---------------------------------------------------------------------------
// pages/lyrics.ts
//
// Two modes:
//  - Synced (LRC):  karaoke-style 5-line view (2 prev / current / 2 next).
//                   Auto-scrolls based on a local progress ticker that's
//                   re-anchored every 2s by an own /now-playing poll.
//  - Plain text:    full-screen scrollable text (legacy behaviour).
//
// Inputs:
//  - Single press  -> back to now-playing
//  - Double press  -> system exit
//  - Up/down swipes are ignored in synced mode (auto-scroll); in plain mode
//    the SDK text widget handles them itself.
// ---------------------------------------------------------------------------

import {
  RebuildPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  OsEventTypeList,
  getBridge,
} from '../bridge'
import type { EvenHubEvent } from '../bridge'
import * as moodify from '../moodify-client'
import { getNowPlaying, setCurrentPage } from '../state'
import type { Lyrics, NowPlaying } from '../types'
import { mountNowPlaying } from './now-playing'
import { parseLrc, findCurrentLineIndex, type LrcLine } from '../lrc'

const CONTAINER_ID = 3
const CONTAINER_NAME = 'lyrics'

const NOW_PLAYING_POLL_MS = 2000
const PROGRESS_TICK_MS = 200

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

function lyricsContainer(content: string): TextContainerProperty {
  return new TextContainerProperty({
    containerID: CONTAINER_ID,
    containerName: CONTAINER_NAME,
    xPosition: 0,
    yPosition: 0,
    width: 576,
    height: 288,
    borderWidth: 0,
    borderRadius: 0,
    paddingLength: 8,
    content,
    isEventCapture: 1,
  })
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

function header(track: { name: string; artists: string[] }): string {
  const artist = track.artists.join(', ')
  return `${track.name} - ${artist}\n──────────────────────`
}

// ---------------------------------------------------------------------------
// Synced renderer — 5 lines (2 prev + current + 2 next).
//
// LVGL has no runtime bold, so we visually emphasise the current line with
// a leading "> " marker. When prev/next slots are empty (e.g. start/end of
// the song), we still print blank lines to keep vertical rhythm stable.
// ---------------------------------------------------------------------------

function renderKaraoke(lines: LrcLine[], currentMs: number): string {
  if (lines.length === 0) return 'No lyrics available'
  const idx = findCurrentLineIndex(lines, currentMs)

  const at = (i: number): string => (i >= 0 && i < lines.length ? lines[i].text : '')

  const prev2 = at(idx - 2)
  const prev1 = at(idx - 1)
  const curr = idx >= 0 ? lines[idx].text : '...'
  const next1 = at(idx + 1)
  const next2 = at(idx + 2)

  return [prev2, prev1, `> ${curr}`, next1, next2].join('\n')
}

// ---------------------------------------------------------------------------
// Page state
// ---------------------------------------------------------------------------

type Mode = 'synced' | 'plain' | 'none' | 'loading'

interface PageState {
  mode: Mode
  track: { name: string; artists: string[]; id: string } | null
  lines: LrcLine[]
  plainText: string | null
  // Live playback state
  progressMs: number
  durationMs: number
  isPlaying: boolean
  // Last rendered line index (synced mode) — used to skip redundant paints
  lastLineIdx: number
}

const page: PageState = {
  mode: 'loading',
  track: null,
  lines: [],
  plainText: null,
  progressMs: 0,
  durationMs: 0,
  isPlaying: false,
  lastLineIdx: -2,
}

let pollTimer: ReturnType<typeof setInterval> | null = null
let tickTimer: ReturnType<typeof setInterval> | null = null
let inFlightAbort: AbortController | null = null
let active = false

function stopTimers(): void {
  if (pollTimer !== null) { clearInterval(pollTimer); pollTimer = null }
  if (tickTimer !== null) { clearInterval(tickTimer); tickTimer = null }
  inFlightAbort?.abort()
  inFlightAbort = null
}

async function pollProgress(): Promise<void> {
  inFlightAbort?.abort()
  const ac = new AbortController()
  inFlightAbort = ac
  try {
    const np: NowPlaying = await moodify.getNowPlaying(ac.signal)
    if (ac.signal.aborted || !active) return
    page.isPlaying = !!np.isPlaying
    if (np.progressMs != null) page.progressMs = np.progressMs
    if (np.durationMs != null) page.durationMs = np.durationMs
    // If the track changed under us, bail to now-playing (it'll re-fetch lyrics).
    if (np.track && page.track && np.track.id && page.track.id && np.track.id !== page.track.id) {
      await mountNowPlaying()
      return
    }
    // Force a render now that we have ground truth.
    page.lastLineIdx = -2
    if (page.mode === 'synced') {
      await paint(renderKaraoke(page.lines, page.progressMs))
    }
  } catch {
    // Silent — the page already shows the last good render.
  } finally {
    if (inFlightAbort === ac) inFlightAbort = null
  }
}

function startTickers(): void {
  if (pollTimer === null) {
    pollTimer = setInterval(() => { void pollProgress() }, NOW_PLAYING_POLL_MS)
  }
  if (tickTimer === null) {
    tickTimer = setInterval(() => {
      if (!active) return
      if (page.mode !== 'synced') return
      if (page.isPlaying) {
        page.progressMs = Math.min(
          page.durationMs > 0 ? page.durationMs : page.progressMs + PROGRESS_TICK_MS,
          page.progressMs + PROGRESS_TICK_MS,
        )
      }
      const idx = findCurrentLineIndex(page.lines, page.progressMs)
      if (idx === page.lastLineIdx) return
      page.lastLineIdx = idx
      void paint(renderKaraoke(page.lines, page.progressMs))
    }, PROGRESS_TICK_MS)
  }
}

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

export async function mountLyrics(): Promise<void> {
  const bridge = await getBridge()

  // Do a fresh now-playing fetch so we always show lyrics for the currently
  // playing track — not stale state from before the user opened the menu.
  let np = getNowPlaying()
  try {
    np = await moodify.getNowPlaying()
  } catch {
    // Non-fatal: fall back to cached state.
  }

  const track = np?.track

  page.track = track ? { name: track.name, artists: track.artists, id: track.id } : null
  page.mode = 'loading'
  page.lines = []
  page.plainText = null
  page.lastLineIdx = -2
  page.progressMs = np?.progressMs ?? 0
  page.durationMs = np?.durationMs ?? 0
  page.isPlaying = !!np?.isPlaying

  const initial = track
    ? `${header(track)}\nLoading lyrics...`
    : 'No track playing.\nDouble press to exit.'

  await bridge.rebuildPageContainer(
    new RebuildPageContainer({
      containerTotalNum: 1,
      textObject: [lyricsContainer(initial)],
    })
  )
  setCurrentPage('lyrics')
  active = true

  if (!track) return

  let lyrics: Lyrics
  try {
    lyrics = await moodify.getLyrics(track.name, track.artists[0] ?? '')
  } catch (err) {
    console.warn('[lyrics] fetch failed:', err)
    page.mode = 'none'
    await paint('Lyrics unavailable')
    startTickers()
    return
  }

  if (lyrics.syncedLyrics) {
    page.lines = parseLrc(lyrics.syncedLyrics)
    if (page.lines.length > 0) {
      page.mode = 'synced'
      await paint(renderKaraoke(page.lines, page.progressMs))
      startTickers()
      return
    }
  }

  if (lyrics.plainLyrics) {
    page.mode = 'plain'
    page.plainText = lyrics.plainLyrics
    await paint(`${header(track)}\n${lyrics.plainLyrics}`)
    startTickers()
    return
  }

  page.mode = 'none'
  await paint('No lyrics available')
  startTickers()
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

async function leaveToNowPlaying(): Promise<void> {
  active = false
  stopTimers()
  await mountNowPlaying()
}

export async function dispatchLyrics(event: EvenHubEvent): Promise<void> {
  // Double-press -> system exit dialog
  const sys = event.sysEvent
  if (sys) {
    const t = sys.eventType ?? 0
    if (t === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      active = false
      stopTimers()
      const bridge = await getBridge()
      await bridge.shutDownPageContainer(1)
      return
    }
    const hasSource = sys.eventSource !== undefined && sys.eventSource !== 0
    if (sys.eventType === undefined && hasSource) {
      await leaveToNowPlaying()
      return
    }
    if (t === OsEventTypeList.CLICK_EVENT && hasSource) {
      await leaveToNowPlaying()
      return
    }
  }

  const text = event.textEvent
  if (text) {
    const t = text.eventType ?? 0
    if (t === OsEventTypeList.CLICK_EVENT) {
      await leaveToNowPlaying()
    } else if (t === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      active = false
      stopTimers()
      const bridge = await getBridge()
      await bridge.shutDownPageContainer(1)
    }
    // In plain mode, the SDK text widget handles up/down auto-scroll.
    // In synced mode we deliberately ignore them.
  }
}
