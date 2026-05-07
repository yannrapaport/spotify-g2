// ---------------------------------------------------------------------------
// pages/playlists.ts
//
// Lists the user's Spotify playlists (up to 20). On selection, transfers
// playback to that playlist's context_uri and bounces back to now-playing.
//
// Inputs:
//  - Single press   -> play selected playlist
//  - Double press   -> system exit
//  - Up/down swipes -> handled internally by the SDK list widget
// ---------------------------------------------------------------------------

import {
  ListContainerProperty,
  ListItemContainerProperty,
  RebuildPageContainer,
  TextContainerProperty,
  OsEventTypeList,
  getBridge,
} from '../bridge'
import type { EvenHubEvent } from '../bridge'
import * as moodify from '../moodify-client'
import { NoDeviceError } from '../moodify-client'
import { setCurrentPage, setNoDevice } from '../state'
import type { Playlist } from '../types'
import { mountNowPlaying } from './now-playing'

const CONTAINER_ID = 4
const CONTAINER_NAME = 'spotify_playlists'

let cachedPlaylists: Playlist[] = []

function listFor(items: string[]): ListContainerProperty {
  return new ListContainerProperty({
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
    isEventCapture: 1,
    itemContainer: new ListItemContainerProperty({
      itemCount: items.length,
      itemWidth: 560,
      isItemSelectBorderEn: 1,
      itemName: items,
    }),
  })
}

function textOnly(content: string): TextContainerProperty {
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

function truncateName(name: string, max = 48): string {
  if (name.length <= max) return name
  return name.slice(0, max - 1) + '…'
}

export async function mountPlaylists(): Promise<void> {
  const bridge = await getBridge()

  // Initial: text "Loading…" — list widget needs >0 items so we use a text
  // container as the placeholder.
  await bridge.rebuildPageContainer(
    new RebuildPageContainer({
      containerTotalNum: 1,
      textObject: [textOnly('Loading playlists...')],
    })
  )
  setCurrentPage('playlists')

  let playlists: Playlist[] = []
  try {
    const res = await moodify.getPlaylists()
    playlists = res.playlists ?? []
  } catch (err) {
    console.warn('[playlists] fetch failed:', err)
    await bridge.rebuildPageContainer(
      new RebuildPageContainer({
        containerTotalNum: 1,
        textObject: [textOnly('Could not load playlists.\nPress to go back.')],
      })
    )
    return
  }

  cachedPlaylists = playlists

  if (playlists.length === 0) {
    await bridge.rebuildPageContainer(
      new RebuildPageContainer({
        containerTotalNum: 1,
        textObject: [textOnly('No playlists found.\nPress to go back.')],
      })
    )
    return
  }

  const items = playlists.map((p) => truncateName(p.name))
  await bridge.rebuildPageContainer(
    new RebuildPageContainer({
      containerTotalNum: 1,
      listObject: [listFor(items)],
    })
  )
}

export async function dispatchPlaylists(event: EvenHubEvent): Promise<void> {
  // Double-press -> system exit
  const sys = event.sysEvent
  if (sys && (sys.eventType ?? 0) === OsEventTypeList.DOUBLE_CLICK_EVENT) {
    const bridge = await getBridge()
    await bridge.shutDownPageContainer(1)
    return
  }

  // If we're in the empty/error text state, any press goes back.
  const text = event.textEvent
  if (text) {
    const t = text.eventType ?? 0
    if (t === OsEventTypeList.CLICK_EVENT) {
      await mountNowPlaying()
      return
    }
    if (t === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      const bridge = await getBridge()
      await bridge.shutDownPageContainer(1)
      return
    }
  }

  const list = event.listEvent
  if (!list) return

  const t = list.eventType ?? 0
  if (t !== OsEventTypeList.CLICK_EVENT) return // up/down auto-handled

  const idx = list.currentSelectItemIndex ?? 0
  const playlist = cachedPlaylists[idx]
  if (!playlist) {
    await mountNowPlaying()
    return
  }

  try {
    await moodify.playContext(playlist.uri)
    setNoDevice(false)
    // Give Spotify a beat to update playback state before we re-fetch
    setTimeout(() => { void mountNowPlaying() }, 500)
  } catch (err) {
    if (err instanceof NoDeviceError) {
      // Surface the no-device hint via now-playing (which knows how to render it).
      setNoDevice(true)
      await mountNowPlaying()
      return
    }
    console.warn('[playlists] play-context failed:', err)
    await mountNowPlaying()
  }
}
