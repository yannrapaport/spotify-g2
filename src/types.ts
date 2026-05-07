// ---------------------------------------------------------------------------
// types.ts
// Domain types shared across the plugin.
// ---------------------------------------------------------------------------

export interface Track {
  id: string
  name: string
  artists: string[]
  albumName: string
  isLiked: boolean
  coverUrl: string | null
}

export interface NowPlaying {
  isPlaying: boolean
  track: Track | null
  /** ms elapsed in the current track (null when nothing is playing). */
  progressMs: number | null
  /** total ms of the current track (null when nothing is playing). */
  durationMs: number | null
}

export interface Lyrics {
  plainLyrics: string | null
  syncedLyrics: string | null
}

export interface Playlist {
  id: string
  name: string
  uri: string
  trackCount: number
}

export type PageId = 'now-playing' | 'menu' | 'lyrics' | 'playlists'
