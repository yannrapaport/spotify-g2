// ---------------------------------------------------------------------------
// main.ts
// Entry point — boots the bridge, mounts the now-playing page as the root
// container, and routes incoming events to the page that's currently mounted.
//
// First-launch flow: if loadConfig() returns null, render the in-WebView
// config form on the phone and wait for the user to save valid credentials,
// THEN boot the glasses page container. This lets us ship the .ehpk to the
// store without bundling backend credentials.
// ---------------------------------------------------------------------------

import { getBridge, OsEventTypeList } from './bridge'
import type { EvenHubEvent } from './bridge'
import { getCurrentPage } from './state'
import { loadConfig } from './config'
import { renderConfigPage } from './config-page'
import {
  dispatchNowPlaying,
  mountNowPlaying,
  onForegroundEnter,
  onForegroundExit,
  onShutdown,
} from './pages/now-playing'
import { dispatchMenu } from './pages/menu'
import { dispatchLyrics } from './pages/lyrics'
import { dispatchPlaylists } from './pages/playlists'

async function startApp(): Promise<void> {
  const bridge = await getBridge()

  // Gate boot on a valid runtime config. On first launch this renders the
  // config form on the phone and resolves once the user has saved.
  let cfg = await loadConfig()
  if (!cfg) {
    cfg = await renderConfigPage()
  }

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
  } else if (page === 'playlists') {
    await dispatchPlaylists(event)
  }
}

startApp().catch((err) => {
  console.error('[Spotify G2] Fatal error:', err)
})
