// ---------------------------------------------------------------------------
// pages/lyrics.ts
//
// Full-screen text container that shows the lyrics for the currently playing
// track (fetched from moodify -> LRClib). Single press returns to now-playing,
// double press triggers system exit. Up/down swipes are handled by the SDK
// text widget itself (auto-scroll), so we don't intercept them here.
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
import { mountNowPlaying } from './now-playing'

const CONTAINER_ID = 3
const CONTAINER_NAME = 'lyrics'

function lyricsContainer(content: string): TextContainerProperty {
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

function header(track: { name: string; artists: string[] }): string {
  const artist = track.artists.join(', ')
  return `${track.name} - ${artist}\n──────────────────────`
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

export async function mountLyrics(): Promise<void> {
  const bridge = await getBridge()

  const np = getNowPlaying()
  const track = np?.track

  // Paint with a placeholder first so the user sees something while we fetch.
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

  if (!track) return

  let body: string
  try {
    const lyrics = await moodify.getLyrics(track.name, track.artists[0] ?? '')
    body = lyrics.plainLyrics ?? 'No lyrics available'
  } catch (err) {
    console.warn('[lyrics] fetch failed:', err)
    body = 'Lyrics unavailable'
  }

  await paint(`${header(track)}\n${body}`)
}

export async function dispatchLyrics(event: EvenHubEvent): Promise<void> {
  // Double-press -> system exit dialog
  const sys = event.sysEvent
  if (sys) {
    const t = sys.eventType ?? 0
    if (t === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      const bridge = await getBridge()
      await bridge.shutDownPageContainer(1)
      return
    }
    const hasSource = sys.eventSource !== undefined && sys.eventSource !== 0
    if (sys.eventType === undefined && hasSource) {
      await mountNowPlaying()
      return
    }
    if (t === OsEventTypeList.CLICK_EVENT && hasSource) {
      await mountNowPlaying()
      return
    }
  }

  const text = event.textEvent
  if (text) {
    const t = text.eventType ?? 0
    if (t === OsEventTypeList.CLICK_EVENT) {
      await mountNowPlaying()
    } else if (t === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      const bridge = await getBridge()
      await bridge.shutDownPageContainer(1)
    }
    // Up/down swipes are auto-scrolled by the SDK on text containers.
  }
}
