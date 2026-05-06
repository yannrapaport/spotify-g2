// ---------------------------------------------------------------------------
// main.ts
// Entry point — boots the bridge, mounts the now-playing page as the root
// container, and routes incoming events to the page that's currently mounted.
// ---------------------------------------------------------------------------

import { getBridge, OsEventTypeList } from './bridge'
import type { EvenHubEvent } from './bridge'
import { getCurrentPage } from './state'
import {
  dispatchNowPlaying,
  mountNowPlaying,
  onForegroundEnter,
  onForegroundExit,
  onShutdown,
} from './pages/now-playing'
import { dispatchMenu } from './pages/menu'
import { dispatchLyrics } from './pages/lyrics'

async function startApp(): Promise<void> {
  const bridge = await getBridge()

  // Boot the page container (the page module handles the HMR fallback).
  await mountNowPlaying()

  // Subscribe to the firehose. Each event is routed to the active page,
  // EXCEPT lifecycle sysEvents (foreground/background/exit) which we always
  // handle here — regardless of the active page.
  const unsubscribe = bridge.onEvenHubEvent((event: EvenHubEvent) => {
    const sys = event.sysEvent
    if (sys) {
      // Use ?? 0 because protobuf elides zero-valued enums (CLICK_EVENT = 0
      // would otherwise come through as undefined).
      const t = sys.eventType ?? 0
      switch (t) {
        case OsEventTypeList.FOREGROUND_ENTER_EVENT:
          onForegroundEnter()
          return
        case OsEventTypeList.FOREGROUND_EXIT_EVENT:
          onForegroundExit()
          return
        case OsEventTypeList.ABNORMAL_EXIT_EVENT:
        case OsEventTypeList.SYSTEM_EXIT_EVENT:
          onShutdown()
          unsubscribe()
          return
        default:
          break
      }
    }

    // Fall through to the page dispatcher for non-lifecycle events.
    routeEvent(event).catch((err) => {
      console.error('[main] dispatch error:', err)
    })
  })
}

async function routeEvent(event: EvenHubEvent): Promise<void> {
  const page = getCurrentPage()
  if (page === 'now-playing') {
    await dispatchNowPlaying(event)
  } else if (page === 'menu') {
    await dispatchMenu(event)
  } else if (page === 'lyrics') {
    await dispatchLyrics(event)
  }
}

startApp().catch((err) => {
  console.error('[Spotify G2] Fatal error:', err)
})
