import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type AppSettings } from "@eve/shared";

vi.mock("electron", () => ({
  nativeTheme: {
    themeSource: "system"
  }
}));

describe("desktop store settings", () => {
  let storeDir = "";

  beforeEach(() => {
    storeDir = mkdtempSync(join(tmpdir(), "eve-store-test-"));
    process.env.EVE_STORE_DIR = storeDir;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.EVE_STORE_DIR;
    rmSync(storeDir, { force: true, recursive: true });
  });

  it("persists every settings field and updates derived state", async () => {
    const { nativeTheme } = await import("electron");
    const { applyTheme, getIdleStatus, getSettings, setSettings } = await import("./store");
    const expectedSettings = buildExpectedSettings(storeDir);

    expect(getSettings()).toEqual(DEFAULT_SETTINGS);

    const savedSettings = setSettings(expectedSettings);
    expect(savedSettings).toEqual(expectedSettings);
    expect(getSettings()).toEqual(expectedSettings);

    applyTheme("light");
    expect(nativeTheme.themeSource).toBe("light");

    expect(getIdleStatus()).toMatchObject({
      asrEnabled: false,
      autoSwitchEnabled: false,
      deviceLabel: expectedSettings.recording.device
    });
  });
});

function buildExpectedSettings(storeDir: string): AppSettings {
  return {
    desktop: {
      hideWindowOnClose: true,
      language: "en-US",
      launchAtLogin: false,
      startRecordingOnLaunch: false,
      theme: "light"
    },
    recording: {
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
      watch: true
    }
  };
}
