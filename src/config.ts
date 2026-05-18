// ---------------------------------------------------------------------------
// config.ts
// Runtime config (Moodify API key) — entered by the user on first launch via
// the in-WebView config form. We don't bake credentials into the bundle so the
// .ehpk is safe to distribute via the Even Hub store.
//
// The backend URL is hardcoded to the public Moodify service we ship against:
// the Even Hub store's network whitelist is a static list in app.json, so a
// user-supplied URL wouldn't pass review and wouldn't work at runtime anyway.
// Self-hosters can fork this repo, change MOODIFY_URL + app.json whitelist,
// and ship their own .ehpk.
// ---------------------------------------------------------------------------

import { getBridge } from './bridge'

/** Public Moodify service. Must match the whitelist in app.json. */
export const MOODIFY_URL = 'https://moodify.theproductguy.cloud'

export interface PluginConfig {
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
    const parsed = JSON.parse(raw) as Partial<PluginConfig> & {
      // Legacy: older builds stored both fields. We ignore moodifyUrl on read
      // since the backend URL is now hardcoded.
      moodifyUrl?: string
    }
    if (typeof parsed.apiKey === 'string' && parsed.apiKey.length > 0) {
      return { apiKey: parsed.apiKey }
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
 * Validate the API key by making two HTTP calls:
 *   1. GET /health         — sanity check that the backend is reachable.
 *   2. GET /api/g2/now-playing with the bearer key — verifies the key is
 *      accepted (anything other than 401 means valid; 503
 *      spotify_not_connected is fine — key works, Spotify just isn't linked
 *      yet on the user's account).
 *
 * Returns an error message on failure, or null on success.
 */
export async function validateConfig(c: PluginConfig): Promise<string | null> {
  if (c.apiKey.trim().length < 8) {
    return 'API key looks too short'
  }

  // 1. /health
  try {
    const res = await fetch(`${MOODIFY_URL}/health`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) {
      return `Backend unreachable (HTTP ${res.status})`
    }
  } catch (err) {
    return err instanceof Error
      ? `Cannot reach backend: ${err.message}`
      : 'Cannot reach backend'
  }

  // 2. authenticated probe
  try {
    const res = await fetch(`${MOODIFY_URL}/api/g2/now-playing`, {
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
