// ---------------------------------------------------------------------------
// pages/menu.ts
//
// Action menu — a list container with one item per Spotify command.
// Up/down swipes are handled internally by the SDK list widget; we only
// react to single press (selection) and double press (system exit).
//
// On selection:
//   - Play/Pause / Next / Prev / Like / Surprise Me -> call moodify, then
//     return to the now-playing page.
//   - Back -> return to the now-playing page without doing anything.
// ---------------------------------------------------------------------------

import {
  ListContainerProperty,
  ListItemContainerProperty,
  RebuildPageContainer,
  OsEventTypeList,
  getBridge,
} from '../bridge'
import type { EvenHubEvent } from '../bridge'

import * as moodify from '../moodify-client'
import { setCurrentPage } from '../state'
import { mountNowPlaying } from './now-playing'
import { mountLyrics } from './lyrics'
import { mountPlaylists } from './playlists'

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

const CONTAINER_ID = 2
const CONTAINER_NAME = 'spotify_menu'

// `♪` (U+266A) renders correctly on LVGL via the simulator — verified.
const MENU_ITEMS = [
  '> Play/Pause',
  '>> Next',
  '<< Prev',
  '+ Like',
  '♪ Lyrics',
  '* Surprise Me',
  '> Playlists',
  '< Back',
] as const

type MenuActionKey =
  | 'play_pause'
  | 'next'
  | 'prev'
  | 'like'
  | 'lyrics'
  | 'surprise'
  | 'playlists'
  | 'back'

const MENU_ACTIONS: readonly MenuActionKey[] = [
  'play_pause',
  'next',
  'prev',
  'like',
  'lyrics',
  'surprise',
  'playlists',
  'back',
] as const

function menuContainer(): ListContainerProperty {
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
      itemCount: MENU_ITEMS.length,
      itemWidth: 560,
      isItemSelectBorderEn: 1,
      itemName: [...MENU_ITEMS],
    }),
  })
}

// ---------------------------------------------------------------------------
// Mounting
// ---------------------------------------------------------------------------

export async function mountMenu(): Promise<void> {
  const bridge = await getBridge()
  await bridge.rebuildPageContainer(
    new RebuildPageContainer({
      containerTotalNum: 1,
      listObject: [menuContainer()],
    })
  )
  setCurrentPage('menu')
}

// ---------------------------------------------------------------------------
// Input handling
// ---------------------------------------------------------------------------

export async function dispatchMenu(event: EvenHubEvent): Promise<void> {
  // Double-press -> system exit dialog (root-page convention)
  const sys = event.sysEvent
  if (sys && (sys.eventType ?? 0) === OsEventTypeList.DOUBLE_CLICK_EVENT) {
    const bridge = await getBridge()
    await bridge.shutDownPageContainer(1)
    return
  }

  // List events carry the currently-selected item index for press / scroll
  const list = event.listEvent
  if (!list) return

  const t = list.eventType ?? 0
  if (t !== OsEventTypeList.CLICK_EVENT) {
    // Up/down scrolls are handled by the host SDK list widget — nothing to do.
    return
  }

  const idx = list.currentSelectItemIndex ?? 0
  const action = MENU_ACTIONS[idx] ?? 'back'
  await runAction(action)
}

async function runAction(action: MenuActionKey): Promise<void> {
  // Pages that own their own lifecycle.
  if (action === 'lyrics') {
    await mountLyrics()
    return
  }
  if (action === 'playlists') {
    await mountPlaylists()
    return
  }

  try {
    switch (action) {
      case 'play_pause':
        await moodify.playPause()
        break
      case 'next':
        await moodify.next()
        break
      case 'prev':
        await moodify.prev()
        break
      case 'like':
        await moodify.like()
        break
      case 'surprise':
        await moodify.surpriseMe()
        break
      case 'back':
        // no-op
        break
    }
  } catch (err) {
    console.warn('[menu] action failed:', action, err)
  }

  await mountNowPlaying()
}
