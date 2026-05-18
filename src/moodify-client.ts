// ---------------------------------------------------------------------------
// moodify-client.ts
// REST client for the moodify backend (which does the Spotify OAuth dance).
// All Spotify-control logic lives server-side; this plugin just calls
// `/api/g2/*` with a static API key.
//
// All functions return strict types and throw typed errors:
//   - MoodifyAuthError (401)             -> bad/missing API key
//   - SpotifyNotConnectedError (503)     -> user has not linked Spotify yet
//   - MoodifyError                        -> any other backend / network error
// ---------------------------------------------------------------------------

import type { NowPlaying, Lyrics, Playlist } from './types'
import { getConfig, MOODIFY_URL } from './config'

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class MoodifyError extends Error {
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'MoodifyError'
    this.status = status
  }
}

export class MoodifyAuthError extends MoodifyError {
  constructor(message = 'Unauthorized') {
    super(message, 401)
    this.name = 'MoodifyAuthError'
  }
}

export class SpotifyNotConnectedError extends MoodifyError {
  constructor(message = 'spotify_not_connected') {
    super(message, 503)
    this.name = 'SpotifyNotConnectedError'
  }
}

/**
 * Backend reported `no_device` (503): user has no active or available
 * Spotify device. UI should show "Open Spotify on phone first".
 */
export class NoDeviceError extends MoodifyError {
  constructor(message = 'no_device') {
    super(message, 503)
    this.name = 'NoDeviceError'
  }
}

// ---------------------------------------------------------------------------
// Config — pulled from runtime config (entered by the user on first launch).
// getConfig() is guaranteed to be non-null after main.ts has booted; if a
// caller somehow reaches us before then we throw a typed error.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Internal fetch wrapper
// ---------------------------------------------------------------------------

interface RequestOpts {
  method?: 'GET' | 'POST'
  signal?: AbortSignal
  body?: unknown
}

async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const cfg = getConfig()
  if (!cfg) {
    throw new MoodifyError('plugin not configured')
  }
  const url = `${MOODIFY_URL}${path}`
  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.apiKey}`,
    Accept: 'application/json',
  }
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }
  let res: Response
  try {
    res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers,
      signal: opts.signal,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    })
  } catch (err) {
    // Network failure / CORS / DNS / abort
    throw new MoodifyError(
      err instanceof Error ? `network: ${err.message}` : 'network error'
    )
  }

  if (res.status === 401) {
    throw new MoodifyAuthError()
  }

  // Try to parse the body even on errors — the backend returns JSON in 503/500
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    // ignore — leave body null
  }

  if (res.status === 503) {
    const errCode =
      isObject(body) && typeof body.error === 'string' ? body.error : undefined
    if (errCode === 'spotify_not_connected') {
      throw new SpotifyNotConnectedError()
    }
    if (errCode === 'no_device') {
      throw new NoDeviceError()
    }
    throw new MoodifyError(errCode ?? 'service unavailable', 503)
  }

  if (!res.ok) {
    const errCode =
      isObject(body) && typeof body.error === 'string' ? body.error : undefined
    throw new MoodifyError(
      errCode ?? `HTTP ${res.status}`,
      res.status
    )
  }

  return body as T
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

// ---------------------------------------------------------------------------
// Public API — one method per backend endpoint
// ---------------------------------------------------------------------------

export function getNowPlaying(signal?: AbortSignal): Promise<NowPlaying> {
  return request<NowPlaying>('/api/g2/now-playing', { signal })
}

export function playPause(): Promise<{ isPlaying: boolean }> {
  return request<{ isPlaying: boolean }>('/api/g2/play-pause', { method: 'POST' })
}

export function next(): Promise<{ ok: true }> {
  return request<{ ok: true }>('/api/g2/next', { method: 'POST' })
}

export function prev(): Promise<{ ok: true }> {
  return request<{ ok: true }>('/api/g2/prev', { method: 'POST' })
}

export function like(): Promise<{ ok: true; trackId: string }> {
  return request<{ ok: true; trackId: string }>('/api/g2/like', { method: 'POST' })
}

export function surpriseMe(): Promise<{
  ok: true
  track: { name: string; artists: string[] }
}> {
  return request<{ ok: true; track: { name: string; artists: string[] } }>(
    '/api/g2/surprise-me',
    { method: 'POST' }
  )
}

export function getLyrics(trackName: string, artistName: string): Promise<Lyrics> {
  const qs = new URLSearchParams({ trackName, artistName }).toString()
  return request<Lyrics>(`/api/g2/lyrics?${qs}`)
}

export function getPlaylists(): Promise<{ playlists: Playlist[] }> {
  return request<{ playlists: Playlist[] }>('/api/g2/playlists')
}

export function playContext(contextUri: string): Promise<{ ok: true }> {
  return request<{ ok: true }>('/api/g2/play-context', {
    method: 'POST',
    body: { contextUri },
  })
}
