// ---------------------------------------------------------------------------
// state.ts
// Tiny in-memory store. The current page owns its own polling/handlers; this
// module just tracks which page is currently mounted on the glasses, and the
// last NowPlaying snapshot we got from moodify (so the menu page can render
// a "current track" hint without re-fetching).
// ---------------------------------------------------------------------------

import type { NowPlaying, PageId } from './types'

interface AppState {
  currentPage: PageId
  nowPlaying: NowPlaying | null
  errorMessage: string | null
  /** Set when the backend reports `no_device` — UI surfaces a hint. */
  noDevice: boolean
}

const state: AppState = {
  currentPage: 'now-playing',
  nowPlaying: null,
  errorMessage: null,
  noDevice: false,
}

export function getCurrentPage(): PageId {
  return state.currentPage
}

export function setCurrentPage(page: PageId): void {
  state.currentPage = page
}

export function getNowPlaying(): NowPlaying | null {
  return state.nowPlaying
}

export function setNowPlaying(np: NowPlaying | null): void {
  state.nowPlaying = np
}

export function getErrorMessage(): string | null {
  return state.errorMessage
}

export function setErrorMessage(msg: string | null): void {
  state.errorMessage = msg
}

export function getNoDevice(): boolean {
  return state.noDevice
}

export function setNoDevice(v: boolean): void {
  state.noDevice = v
}
