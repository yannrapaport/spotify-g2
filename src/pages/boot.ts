// ---------------------------------------------------------------------------
// pages/boot.ts
// First screen rendered on the glasses at app startup, BEFORE we know whether
// the user has saved a config. Claims the startup page container so the host
// has an active input target (isEventCapture: 1) from t=0 — without this the
// host would have no container to route touchpad / R1 events to during the
// config form on the phone.
//
// Two states:
//   - "configure"  → first launch: "Configure on phone"
//   - "connecting" → config exists, app is doing its first poll
//
// Both layouts are single-text, full-canvas, isEventCapture=1.
// ---------------------------------------------------------------------------

import {
  CreateStartUpPageContainer,
  RebuildPageContainer,
  StartUpPageCreateResult,
  TextContainerProperty,
  getBridge,
} from '../bridge'

const BOOT_TEXT_ID = 1
const BOOT_TEXT_NAME = 'boot'

function bootLayout(content: string): {
  containerTotalNum: number
  textObject: TextContainerProperty[]
} {
  return {
    containerTotalNum: 1,
    textObject: [
      new TextContainerProperty({
        containerID: BOOT_TEXT_ID,
        containerName: BOOT_TEXT_NAME,
        xPosition: 0,
        yPosition: 0,
        width: 576,
        height: 288,
        borderWidth: 1,
        borderColor: 5,
        borderRadius: 2,
        paddingLength: 8,
        content,
        isEventCapture: 1,
      }),
    ],
  }
}

const MESSAGES = {
  configure: 'Moodify Remote\n\nConfigure on phone\nto get started.',
  connecting: 'Moodify Remote\n\nConnecting…',
} as const

export type BootState = keyof typeof MESSAGES

/**
 * Create the startup page container with the boot screen layout. Must be
 * called exactly once per app launch (the SDK's startup container is
 * one-shot). On HMR reload in dev, falls back to rebuild via the standard
 * `!== 0` check.
 */
export async function mountBootScreen(state: BootState): Promise<void> {
  const bridge = await getBridge()
  const layout = bootLayout(MESSAGES[state])
  const result = await bridge.createStartUpPageContainer(
    new CreateStartUpPageContainer(layout),
  )
  if (result !== StartUpPageCreateResult.success) {
    // HMR (or any retry) — the startup container is already created.
    await bridge.rebuildPageContainer(new RebuildPageContainer(layout))
  }
}

/** Update the boot screen text without recreating the container. */
export async function updateBootScreen(state: BootState): Promise<void> {
  const bridge = await getBridge()
  await bridge.rebuildPageContainer(
    new RebuildPageContainer(bootLayout(MESSAGES[state])),
  )
}
