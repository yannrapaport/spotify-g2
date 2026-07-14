// ---------------------------------------------------------------------------
// config-page.ts
// First-launch config form rendered into #app on the phone-side WebView. The
// glasses page container is mounted by main.ts BEFORE this runs, so the user
// sees a "Configure on phone" screen on the G2 while filling this in.
//
// Single field: API key. The backend URL is hardcoded in config.ts and pinned
// in the app.json network whitelist; users get their key from the moodify
// signup page at https://g2.theproductguy.cloud.
// ---------------------------------------------------------------------------

import { setConfig, validateConfig, MOODIFY_URL, type PluginConfig } from './config'

const HTML = `
<style>
  :root {
    --bg: #111111;
    --surface: #1A1A1A;
    --text: #FFFFFF;
    --text-dim: #8A8A8A;
    --input-bg: rgba(255,255,255,0.08);
    --accent: #FEF991;
    --error: #FF6F6F;
    --success: #6FE39A;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0;
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .config-root {
    min-height: 100vh;
    padding: 24px 20px 32px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  h1 {
    font-size: 28px;
    font-weight: 700;
    letter-spacing: -0.02em;
    margin: 12px 0 0;
  }
  p.subtitle {
    color: var(--text-dim);
    font-size: 15px;
    line-height: 1.45;
    margin: 0;
  }
  p.subtitle a { color: var(--accent); text-decoration: none; }
  label {
    display: block;
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-dim);
    margin-bottom: 8px;
  }
  input[type="text"], input[type="password"] {
    width: 100%;
    padding: 14px 16px;
    background: var(--input-bg);
    color: var(--text);
    border: 1px solid transparent;
    border-radius: 12px;
    font-size: 16px;
    font-family: inherit;
    outline: none;
    -webkit-appearance: none;
  }
  input:focus {
    border-color: var(--accent);
  }
  .field { display: flex; flex-direction: column; }
  .actions {
    margin-top: 12px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  button.primary {
    width: 100%;
    padding: 16px;
    background: var(--accent);
    color: #111;
    border: none;
    border-radius: 12px;
    font-size: 17px;
    font-weight: 600;
    letter-spacing: -0.01em;
    cursor: pointer;
    -webkit-appearance: none;
  }
  button.primary[disabled] {
    opacity: 0.5;
    cursor: progress;
  }
  .status {
    min-height: 20px;
    font-size: 14px;
    text-align: center;
  }
  .status.error { color: var(--error); }
  .status.info { color: var(--text-dim); }
  .status.success { color: var(--success); }
  .footer {
    margin-top: 16px;
    font-size: 12px;
    color: var(--text-dim);
    line-height: 1.5;
  }
</style>
<div class="config-root">
  <h1>Moodify Remote</h1>
  <p class="subtitle">
    Get your API key at
    <a id="cfg-signup" href="${MOODIFY_URL}" target="_blank" rel="noreferrer">${MOODIFY_URL.replace(/^https?:\/\//, '')}</a>:
    sign in with Spotify, copy the key, paste it below.
  </p>

  <form id="cfg-form" autocomplete="off">
    <div class="field">
      <label for="cfg-key">API key</label>
      <input id="cfg-key" name="key" type="password"
             autocapitalize="none" autocorrect="off"
             placeholder="paste your API key" required />
    </div>

    <div class="actions">
      <button class="primary" id="cfg-save" type="submit">Save</button>
      <div id="cfg-status" class="status info">&nbsp;</div>
    </div>
  </form>

  <div class="footer">
    Tip: to reset later, on the glasses' Now Playing page do three quick
    double-taps within 3 seconds.
  </div>
</div>
`.trim()

/**
 * Render the config form into #app and resolve when the user has saved a
 * validated config. Replaces the body content; the caller is expected to then
 * proceed with normal boot (mountNowPlaying etc.).
 */
export function renderConfigPage(): Promise<PluginConfig> {
  return new Promise((resolve) => {
    const root = document.getElementById('app') ?? document.body
    root.innerHTML = HTML

    const form = document.getElementById('cfg-form') as HTMLFormElement
    const keyInput = document.getElementById('cfg-key') as HTMLInputElement
    const button = document.getElementById('cfg-save') as HTMLButtonElement
    const status = document.getElementById('cfg-status') as HTMLDivElement

    const setStatus = (
      kind: 'info' | 'error' | 'success',
      message: string
    ): void => {
      status.className = `status ${kind}`
      status.textContent = message
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault()

      const apiKey = keyInput.value.trim()
      if (!apiKey) {
        setStatus('error', 'API key is required.')
        return
      }

      const candidate: PluginConfig = { apiKey }

      button.disabled = true
      setStatus('info', 'Testing connection…')

      const error = await validateConfig(candidate)
      if (error) {
        setStatus('error', error)
        button.disabled = false
        return
      }

      await setConfig(candidate)
      setStatus('success', 'Connected!')

      // Brief pause so the user sees the success state before the page
      // pivots to the glasses-control UI.
      setTimeout(() => resolve(candidate), 500)
    })

    // Focus the API key field for quick paste-from-clipboard.
    setTimeout(() => keyInput.focus(), 50)
  })
}
