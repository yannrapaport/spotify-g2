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
}

export interface NowPlaying {
  isPlaying: boolean
  track: Track | null
}

export type PageId = 'now-playing' | 'menu'
