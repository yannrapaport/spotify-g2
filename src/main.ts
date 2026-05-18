// ---------------------------------------------------------------------------
// main.ts
// Entry point — boots the bridge, mounts a boot screen on the glasses BEFORE
// gating on config so the host has an active event-capture container from
// t=0, then either pivots to now-playing (config exists) or to the in-WebView
// config form (first launch). Once config is saved, mounts now-playing.
//
// Why mount a boot screen first: the Even Hub store reviewer requires an
// active container with `isEventCapture: 1` registered at startup. Without it,
// touchpad / R1 input has nowhere to route during the config phase.
// ---------------------------------------------------------------------------

import { getBridge, OsEventTypeList } from './bridge'
import type { EvenHubEvent } from './bridge'
import { getCurrentPage } from './state'
import { loadConfig } from './config'
import { renderConfigPage } from './config-page'
import { mountBootScreen, updateBootScreen } from './pages/boot'
import {
  dispatchNowPlaying,
  markStartupCreated,
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

  // Reach the host immediately with a placeholder container so input has a
  // target (isEventCapture: 1) before we even check for stored config.
  let cfg = await loadConfig()
  await mountBootScreen(cfg ? 'connecting' : 'configure')
  // The boot screen owns the one-shot startup container — tell now-playing so
  // its first mount uses rebuild instead of retrying createStartUp.
  markStartupCreated()

  // Gate boot on a valid runtime config. On first launch this renders the
  // config form on the phone; the glasses keep showing the "Configure on
  // phone" boot screen until the user saves.
  if (!cfg) {
    cfg = await renderConfigPage()
    await updateBootScreen('connecting')
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
