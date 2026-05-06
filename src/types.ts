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
}

export interface Lyrics {
  plainLyrics: string | null
  syncedLyrics: string | null
}

export type PageId = 'now-playing' | 'menu' | 'lyrics'
