// ---------------------------------------------------------------------------
// bridge.ts
// Single SDK wrapper for the Spotify G2 plugin.
// Every other file imports SDK pieces from here, NEVER from
// '@evenrealities/even_hub_sdk' directly.
// ---------------------------------------------------------------------------

import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'

// Re-export the SDK pieces the rest of the app needs as values...
export {
  CreateStartUpPageContainer,
  RebuildPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  ListContainerProperty,
  ListItemContainerProperty,
  ImageContainerProperty,
  ImageRawDataUpdate,
  StartUpPageCreateResult,
  OsEventTypeList,
  EventSourceType,
} from '@evenrealities/even_hub_sdk'

// ...and as types.
export type {
  EvenHubEvent,
  Sys_ItemEvent,
  Text_ItemEvent,
  List_ItemEvent,
} from '@evenrealities/even_hub_sdk'

export type EvenBridge = Awaited<ReturnType<typeof waitForEvenAppBridge>>

let bridgePromise: Promise<EvenBridge> | null = null

/**
 * Returns the singleton bridge instance. Cached after the first call so
 * waitForEvenAppBridge's "ready" handshake only runs once per page.
 */
export function getBridge(): Promise<EvenBridge> {
  if (!bridgePromise) {
    bridgePromise = waitForEvenAppBridge()
  }
  return bridgePromise
}
