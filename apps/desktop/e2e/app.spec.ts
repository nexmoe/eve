import { join } from "node:path";
import type { Page } from "@playwright/test";
import { DEFAULT_SETTINGS, type AppSettings } from "@eve/shared";
import { expect, test } from "./fixtures";

test("shows the main desktop controls", async ({ launchApp }) => {
  const { app, page } = await launchApp();

  await expect(page.getByRole("button", { name: /Start recording|开始录音|Stop|停止/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /History|历史/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /General|通用/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Input|输入/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Transcribe|转写/ })).toBeVisible();

  const snapshot = await page.evaluate(() => window.eve.bootstrap());
  expect(snapshot.engineReady).toBe(true);
  expect(snapshot.permission.state).toBe("authorized");

  await app.close();
});

test("can start and stop a recording session", async ({ launchApp }) => {
  const { app, page } = await launchApp();

  await ensureIdle(page);
  await page.getByRole("button", { name: /Start recording|开始录音/ }).click();
  await expect(page.getByRole("button", { name: /Stop|停止/ })).toBeVisible();
  await expect.poll(async () => (await page.evaluate(() => window.eve.bootstrap())).status.recording).toBe(true);

  await page.getByRole("button", { name: /Stop|停止/ }).click();
  await expect(page.getByRole("button", { name: /Start recording|开始录音/ })).toBeVisible();
  await expect.poll(async () => (await page.evaluate(() => window.eve.bootstrap())).status.recording).toBe(false);

  await app.close();
});

test("keeps speech activity on when realtime transcription is disabled", async ({ launchApp }) => {
  const { app, page } = await launchApp();

  await page.getByRole("tab", { name: /Transcribe|转写/ }).click();
  const realtimeAsrSwitch = page.locator('[role="switch"]').first();
  await realtimeAsrSwitch.click();

  await ensureIdle(page);
  await page.getByRole("button", { name: /Start recording|开始录音/ }).click();
  await expect.poll(async () => (await page.evaluate(() => window.eve.bootstrap())).status.inSpeech).toBe(true);

  await page.getByRole("button", { name: /Stop|停止/ }).click();
  await app.close();
});

test("persists general settings across relaunch", async ({ launchApp }) => {
  let context = await launchApp();
  let switchLocator = await openLaunchAtLoginSwitch(context.page);
  const initialState = await switchLocator.getAttribute("aria-checked");
  const nextState = initialState === "true" ? "false" : "true";

  await switchLocator.click();
  await expect(switchLocator).toHaveAttribute("aria-checked", nextState);
  await context.app.close();

  context = await launchApp();
  switchLocator = await openLaunchAtLoginSwitch(context.page);
  await expect(switchLocator).toHaveAttribute("aria-checked", nextState);
  await context.app.close();
});

test("persists every setting field across relaunch", async ({ launchApp, storeDir }) => {
  let context = await launchApp();
  const expectedSettings = buildCustomSettings(storeDir);

  await context.page.evaluate(async (settings: AppSettings) => {
    await window.eve.saveSettings(settings);
  }, expectedSettings);

  await expect
    .poll(async () => (await context.page.evaluate(() => window.eve.bootstrap())).settings)
    .toEqual(expectedSettings);

  await context.app.close();

  context = await launchApp();
  await expect
    .poll(async () => (await context.page.evaluate(() => window.eve.bootstrap())).settings)
    .toEqual(expectedSettings);
  await context.app.close();
});

async function openLaunchAtLoginSwitch(page: Page) {
  await page.getByRole("tab", { name: /General|通用/ }).click();
  const switchLocator = page.getByTestId("launch-at-login-field").locator('[role="switch"]');
  await expect(switchLocator).toBeVisible();
  return switchLocator;
}

async function ensureIdle(page: Page) {
  const stopButton = page.getByRole("button", { name: /Stop|停止/ });
  if (await stopButton.isVisible()) {
    await stopButton.click();
  }
  await expect(page.getByRole("button", { name: /Start recording|开始录音/ })).toBeVisible();
}

function buildCustomSettings(storeDir: string): AppSettings {
  return {
    desktop: {
      ...DEFAULT_SETTINGS.desktop,
      language: "en-US",
      launchAtLogin: false,
      startRecordingOnLaunch: false,
      theme: "light"
    },
    recording: {
      ...DEFAULT_SETTINGS.recording,
      audioFormat: "wav",
      asrLanguage: "ja",
      autoSwitchConfirmations: 3,
      autoSwitchDevice: false,
      device: "usb-mic",
      disableAsr: true,
      excludeDeviceKeywords: "bluetooth,continuity",
      outputDir: join(storeDir, "recordings-out"),
      segmentMinutes: 90
    },
    transcribe: {
      ...DEFAULT_SETTINGS.transcribe,
      watch: true
    }
  };
}
