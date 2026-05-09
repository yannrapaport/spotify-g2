// ---------------------------------------------------------------------------
// config.ts
// Runtime config (moodify URL + API key) — entered by the user on first
// launch via the in-WebView config form. We don't bake credentials into the
// bundle anymore so the .ehpk is safe to distribute via the Even Hub store.
//
// Investigation findings (Q1/Q2/Q3):
//   Q1 — WebView is touchable. The Even Hub host is a Flutter WebView (Chromium
//        on Android / WKWebView on iOS) running on the phone screen. Plugins
//        can render arbitrary HTML/forms; the design-guidelines skill explicitly
//        documents tokens for "phone-side config / settings / library screens".
//   Q2 — There is NO native plugin-settings field in app.json. The packed
//        manifest only accepts: package_id, edition, name, version,
//        min_app_version, min_sdk_version, entrypoint, permissions,
//        supported_languages. The companion app does not expose a per-plugin
//        settings panel. Persistence must come from `bridge.setLocalStorage` /
//        `bridge.getLocalStorage` (browser localStorage is unreliable across
//        Flutter WebView restarts).
//   Q3 — First launch flow: user installs the .ehpk from the store, taps the
//        plugin tile in Even Hub, the Flutter WebView loads `entrypoint`
//        (index.html). Whatever the page renders is what the user sees. So
//        we render the config form on first launch, then rebuild as the
//        glasses page once config is saved.
//
// Approach chosen: A — in-WebView config UI, persisted via
// bridge.setLocalStorage (with a browser-localStorage fallback for the dev
// simulator where the bridge mock may not implement storage).
// ---------------------------------------------------------------------------

import { getBridge } from './bridge'

export interface PluginConfig {
  moodifyUrl: string
  apiKey: string
}

const STORAGE_KEY = 'spotify-g2-config'

// In-process cache so synchronous callers (moodify-client) can read the config
// without re-issuing an async bridge call on every request. Populated by
// loadConfig() at boot, then mutated by setConfig / clearConfig.
let cached: PluginConfig | null = null

function parseStoredValue(raw: string | null | undefined): PluginConfig | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<PluginConfig>
    if (
      typeof parsed.moodifyUrl === 'string' &&
      typeof parsed.apiKey === 'string' &&
      parsed.moodifyUrl.length > 0 &&
      parsed.apiKey.length > 0
    ) {
      return { moodifyUrl: parsed.moodifyUrl, apiKey: parsed.apiKey }
    }
  } catch {
    // fall through
  }
  return null
}

/**
 * Async: try the bridge first (persistent across Flutter WebView restarts),
 * then fall back to browser localStorage (for the desktop simulator, where the
 * bridge stub may not implement getLocalStorage). Caches the result.
 */
export async function loadConfig(): Promise<PluginConfig | null> {
  // Bridge first.
  try {
    const bridge = await getBridge()
    const raw = await bridge.getLocalStorage(STORAGE_KEY)
    const parsed = parseStoredValue(raw)
    if (parsed) {
      cached = parsed
      return parsed
    }
  } catch {
    // bridge.getLocalStorage may not be implemented in the simulator stub.
  }

  // Browser localStorage fallback.
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const parsed = parseStoredValue(raw)
    if (parsed) {
      cached = parsed
      return parsed
    }
  } catch {
    // localStorage might be unavailable in some sandbox modes.
  }

  return null
}

/** Sync read of the cached config. Returns null until loadConfig() resolves. */
export function getConfig(): PluginConfig | null {
  return cached
}

/**
 * Persist config to both the bridge and browser localStorage, and update the
 * in-process cache. Both writes are best-effort — on the device the bridge
 * write is what counts; on the desktop simulator localStorage is what counts.
 */
export async function setConfig(c: PluginConfig): Promise<void> {
  cached = c
  const json = JSON.stringify(c)

  try {
    const bridge = await getBridge()
    await bridge.setLocalStorage(STORAGE_KEY, json)
  } catch {
    // ignore — fallback below
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, json)
  } catch {
    // ignore
  }
}

/** Clear config from every persistence layer. Used by the secret reset gesture. */
export async function clearConfig(): Promise<void> {
  cached = null

  try {
    const bridge = await getBridge()
    // The SDK's setLocalStorage takes a string; setting "" effectively clears
    // the key for our parser (empty string -> not a valid config object).
    await bridge.setLocalStorage(STORAGE_KEY, '')
  } catch {
    // ignore
  }

  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}

/**
 * Validate a candidate config by making two HTTP calls:
 *   1. GET ${url}/health        — verifies the URL points to a moodify
 *                                 backend (200 + {status:'ok'}).
 *   2. GET ${url}/api/g2/now-playing with the bearer key — verifies the
 *      key is accepted (anything other than 401 means the key is valid;
 *      503 spotify_not_connected is fine — key works, Spotify just isn't
 *      linked yet).
 *
 * Returns an error message on failure, or null on success.
 */
export async function validateConfig(c: PluginConfig): Promise<string | null> {
  const url = c.moodifyUrl.replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(url)) {
    return 'URL must start with http:// or https://'
  }
  if (c.apiKey.trim().length < 8) {
    return 'API key looks too short'
  }

  // 1. /health
  try {
    const res = await fetch(`${url}/health`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) {
      return `Health check failed (HTTP ${res.status})`
    }
    const body = (await res.json().catch(() => null)) as
      | { status?: string }
      | null
    if (!body || body.status !== 'ok') {
      return 'Not a moodify backend (unexpected /health response)'
    }
  } catch (err) {
    return err instanceof Error
      ? `Cannot reach backend: ${err.message}`
      : 'Cannot reach backend'
  }

  // 2. authenticated probe
  try {
    const res = await fetch(`${url}/api/g2/now-playing`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${c.apiKey}`,
        Accept: 'application/json',
      },
    })
    if (res.status === 401) {
      return 'API key rejected (401)'
    }
    // 200, 503 (spotify_not_connected / no_device) and any 5xx other than 401
    // mean the key was accepted — good enough.
  } catch (err) {
    return err instanceof Error
      ? `Auth probe failed: ${err.message}`
      : 'Auth probe failed'
  }

  return null
}
