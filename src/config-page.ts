// ---------------------------------------------------------------------------
// config-page.ts
// First-launch config form rendered into #app on the phone-side WebView.
// We DON'T initialise the glasses page container until the user has saved a
// valid config — that way we never push anything to the glasses with stale or
// missing credentials.
//
// Style: minimal inline CSS, dark theme aligned with the Even Hub design
// guidelines (`--color-bg #111`, `--color-surface #1A1A1A`, accent #FEF991).
// Inputs and buttons sized big enough for tactile use on a phone screen.
// ---------------------------------------------------------------------------

import { setConfig, validateConfig, type PluginConfig } from './config'

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
  <h1>Spotify G2</h1>
  <p class="subtitle">
    Enter the URL and API key of your moodify backend.
    Don't have one? Deploy your own at
    <a href="https://github.com/yannrapaport/moodify" target="_blank" rel="noreferrer">github.com/yannrapaport/moodify</a>.
  </p>

  <form id="cfg-form" autocomplete="off">
    <div class="field">
      <label for="cfg-url">Moodify URL</label>
      <input id="cfg-url" name="url" type="text"
             inputmode="url" autocapitalize="none" autocorrect="off"
             placeholder="https://moodify.example.com" required />
    </div>

    <div class="field" style="margin-top: 16px;">
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
    Tip: to reset the config later, on the glasses' Now Playing page do three
    quick double-taps within 3 seconds.
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
    const urlInput = document.getElementById('cfg-url') as HTMLInputElement
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

      const moodifyUrl = urlInput.value.trim().replace(/\/+$/, '')
      const apiKey = keyInput.value.trim()

      if (!moodifyUrl || !apiKey) {
        setStatus('error', 'Both fields are required.')
        return
      }

      const candidate: PluginConfig = { moodifyUrl, apiKey }

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

    // Focus the URL field for quick entry on the phone keyboard.
    setTimeout(() => urlInput.focus(), 50)
  })
}
