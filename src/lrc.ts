// ---------------------------------------------------------------------------
// lrc.ts
//
// Tiny LRC parser. LRC format:
//
//   [mm:ss.xx]Some lyric line
//   [mm:ss.xx][mm:ss.xx]Same line at two different times
//   [00:12.34]              <-- empty payload, still a valid synced beat
//
// We accept 2 or 3 fractional digits (the spec is loose). Lines without a
// valid `[mm:ss.xx]` prefix are skipped (LRClib sometimes prepends `[ar:...]`
// metadata tags). Output is sorted ascending by timeMs.
// ---------------------------------------------------------------------------

export interface LrcLine {
  timeMs: number
  text: string
}

// Match a single timestamp tag at the very start (or chained right after another).
// Allows 2 or 3 fractional digits, and a 1-or-2-digit minutes field.
const TAG_RE = /^\[(\d{1,3}):(\d{2})\.(\d{2,3})\]/

export function parseLrc(syncedLyrics: string): LrcLine[] {
  if (!syncedLyrics) return []

  const out: LrcLine[] = []

  for (const rawLine of syncedLyrics.split(/\r?\n/)) {
    let rest = rawLine
    const tags: number[] = []

    // Pull every leading [mm:ss.xx] tag off the front.
    while (true) {
      const m = TAG_RE.exec(rest)
      if (!m) break
      const minutes = parseInt(m[1], 10)
      const seconds = parseInt(m[2], 10)
      const fracStr = m[3]
      // Normalize to ms regardless of 2 or 3 digit fractional precision.
      const frac = parseInt(fracStr, 10)
      const fracMs = fracStr.length === 3 ? frac : frac * 10
      const timeMs = (minutes * 60 + seconds) * 1000 + fracMs
      tags.push(timeMs)
      rest = rest.slice(m[0].length)
    }

    if (tags.length === 0) continue

    const text = rest.trim()
    for (const t of tags) {
      out.push({ timeMs: t, text })
    }
  }

  out.sort((a, b) => a.timeMs - b.timeMs)
  return out
}

/**
 * Find the index of the lyric line currently active at `currentMs`.
 *
 * Returns -1 if `currentMs` is before the first line. Binary search.
 */
export function findCurrentLineIndex(lines: LrcLine[], currentMs: number): number {
  if (lines.length === 0) return -1
  if (currentMs < lines[0].timeMs) return -1

  let lo = 0
  let hi = lines.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1 // upper mid to avoid infinite loop
    if (lines[mid].timeMs <= currentMs) {
      lo = mid
    } else {
      hi = mid - 1
    }
  }
  return lo
}
