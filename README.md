# spotify-g2

Spotify control for Even Realities G2 smart glasses (and the R1 ring).

The plugin runs in the Even Hub WebView, talks to the **moodify** backend over
HTTPS, and lets you control playback from the touchpad / ring without taking
your phone out.

## Setup

```bash
npm install
cp .env.example .env
# edit .env and fill in VITE_MOODIFY_URL + VITE_MOODIFY_API_KEY
```

The plugin does **no** OAuth. Spotify is already linked server-side in moodify.

## Dev

```bash
npm run dev                                       # Vite dev server on :5173
npx evenhub-simulator http://localhost:5173       # Desktop simulator
```

For automation / pixel-accurate font measurement, see
`everything-evenhub:simulator-automation` and
`everything-evenhub:font-measurement`.

## Deploy

Use the `everything-evenhub:build-and-deploy` skill:

```bash
npm run build
npx evenhub pack          # produces .ehpk
```

Then upload the `.ehpk` to the Even Hub developer portal.

## Inputs

| Gesture (touchpad / R1) | Now Playing | Menu |
|---|---|---|
| Single press | Play / Pause | Trigger selected action |
| Double press | Exit dialog | Exit dialog |
| Swipe up | Like current track | Move selection up (SDK) |
| Swipe down | Open menu | Move selection down (SDK) |

Menu items: `Play/Pause`, `Next`, `Prev`, `Like`, `Surprise Me`, `Back`. All
items return to Now Playing after firing.

## Backend contract

Base URL: `${VITE_MOODIFY_URL}` — auth: `Authorization: Bearer ${VITE_MOODIFY_API_KEY}`.

```
GET  /api/g2/now-playing  -> { isPlaying, track | null }
POST /api/g2/play-pause   -> { isPlaying }
POST /api/g2/next         -> { ok: true }
POST /api/g2/prev         -> { ok: true }
POST /api/g2/like         -> { ok: true, trackId }
POST /api/g2/surprise-me  -> { ok: true, track: { name, artists } }
```

Errors: `401` (auth), `503 { error: "spotify_not_connected" }`, `500 { error }`.

## Layout

```
src/
  bridge.ts          # Single SDK wrapper — re-exports SDK pieces + getBridge()
  moodify-client.ts  # Typed REST client (MoodifyAuthError, SpotifyNotConnectedError, MoodifyError)
  pages/
    now-playing.ts   # Main page: text container + 5s polling
    menu.ts          # Action menu: list container
  state.ts           # Current page + last NowPlaying snapshot
  types.ts           # Track, NowPlaying, PageId
  main.ts            # Boot + lifecycle + event router
```

`bridge.ts` is the only file that imports from `@evenrealities/even_hub_sdk`.
Polling is paused on `FOREGROUND_EXIT_EVENT (5)`, resumed on
`FOREGROUND_ENTER_EVENT (4)`, and torn down on `ABNORMAL_EXIT_EVENT (6)` /
`SYSTEM_EXIT_EVENT (7)`.

## Support

If this plugin is useful to you, you can support its development on [Patreon](https://www.patreon.com/yannrapaport). It covers the VPS that runs the moodify demo backend and helps me keep building open-source tools in my spare time.

## License

[MIT](LICENSE) — © Yann Rapaport
