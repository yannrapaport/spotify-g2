# Privacy Policy — Moodify Remote

*Last updated: 2026-05-09*

## What this app does

Moodify Remote is an Even Realities G2 plugin that controls Spotify playback via a
self-hosted [Moodify](https://github.com/yannrapaport/moodify) backend that **you**
deploy and operate. The app does not collect, store, or transmit any personal data
to the developer.

## Network permission

The app uses the `network` permission exclusively to communicate with the Moodify
backend URL that **you** configure on first launch. All requests go to your own
server. No data is sent to any third party by the app itself.

## Data stored on-device

The app stores two values locally via the Even Hub bridge storage:

- Your Moodify backend URL
- Your Moodify API key

These values never leave your device except to reach the backend URL you provided.

## Spotify data

Spotify data (track name, artist, album art, lyrics) is fetched by your Moodify
backend from Spotify's API and LRClib. The Moodify backend is your responsibility —
refer to [its privacy policy](https://github.com/yannrapaport/moodify) for details.

## Contact

Questions? Open an issue at
[github.com/yannrapaport/spotify-g2](https://github.com/yannrapaport/spotify-g2).
