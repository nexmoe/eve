import { nativeTheme } from "electron";
import Store from "electron-store";
import {
  type AppLanguage,
  DEFAULT_SETTINGS,
  DEFAULT_STATUS,
  type AppSettings,
  type RecorderStatusSnapshot,
  type ThemeMode
} from "@eve/shared";

interface WindowState {
  height: number;
  width: number;
}

interface DesktopStoreSchema {
  settings: AppSettings;
  windowState: WindowState;
}

const desktopStore = new Store<DesktopStoreSchema>({
  cwd: process.env.EVE_STORE_DIR,
  defaults: {
    settings: DEFAULT_SETTINGS,
    windowState: {
      height: 620,
      width: 420
    }
  },
  name: "desktop-settings"
});

const normalizeBoolean = (value: unknown, fallback: boolean): boolean => {
  return typeof value === "boolean" ? value : fallback;
};

const normalizeNumber = (value: unknown, fallback: number): number => {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
};

const normalizeString = (value: unknown, fallback: string): string => {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
};

const VALID_THEMES: ThemeMode[] = ["light", "dark", "system"];
const VALID_LANGUAGES: AppLanguage[] = ["system", "zh-CN", "en-US"];
const normalizeTheme = (value: unknown): ThemeMode => {
  return typeof value === "string" && VALID_THEMES.includes(value as ThemeMode)
    ? (value as ThemeMode)
    : DEFAULT_SETTINGS.desktop.theme;
};

const normalizeLanguage = (value: unknown): AppLanguage => {
  return typeof value === "string" && VALID_LANGUAGES.includes(value as AppLanguage)
    ? (value as AppLanguage)
    : DEFAULT_SETTINGS.desktop.language;
};

export const getSettings = (): AppSettings => {
  const stored = desktopStore.get("settings");
  return {
    desktop: {
      hideWindowOnClose: true,
      language: normalizeLanguage(stored?.desktop?.language),
      launchAtLogin: normalizeBoolean(
        stored?.desktop?.launchAtLogin,
        DEFAULT_SETTINGS.desktop.launchAtLogin
      ),
      startRecordingOnLaunch: normalizeBoolean(
        stored?.desktop?.startRecordingOnLaunch,
        DEFAULT_SETTINGS.desktop.startRecordingOnLaunch
      ),
      theme: normalizeTheme(stored?.desktop?.theme)
    },
    recording: {
      audioFormat:
        stored?.recording?.audioFormat === "wav" ? "wav" : "flac",
      asrLanguage: normalizeString(
        stored?.recording?.asrLanguage,
        DEFAULT_SETTINGS.recording.asrLanguage
      ),
      autoSwitchConfirmations: normalizeNumber(
        stored?.recording?.autoSwitchConfirmations,
        DEFAULT_SETTINGS.recording.autoSwitchConfirmations
      ),
      autoSwitchDevice: normalizeBoolean(
        stored?.recording?.autoSwitchDevice,
        DEFAULT_SETTINGS.recording.autoSwitchDevice
      ),
      device: normalizeString(
        stored?.recording?.device,
        DEFAULT_SETTINGS.recording.device
      ),
      disableAsr: normalizeBoolean(
        stored?.recording?.disableAsr,
        DEFAULT_SETTINGS.recording.disableAsr
      ),
      excludeDeviceKeywords: normalizeString(
        stored?.recording?.excludeDeviceKeywords,
        DEFAULT_SETTINGS.recording.excludeDeviceKeywords
      ),
      outputDir: normalizeString(
        stored?.recording?.outputDir,
        DEFAULT_SETTINGS.recording.outputDir
      ),
      segmentMinutes: normalizeNumber(
        stored?.recording?.segmentMinutes,
        DEFAULT_SETTINGS.recording.segmentMinutes
      )
    },
    transcribe: {
      watch: normalizeBoolean(
        stored?.transcribe?.watch,
        DEFAULT_SETTINGS.transcribe.watch
      )
    }
  };
};

export const setSettings = (settings: AppSettings): AppSettings => {
  desktopStore.set("settings", {
    ...settings,
    desktop: {
      ...settings.desktop,
      hideWindowOnClose: true
    }
  });
  return getSettings();
};

export const getWindowState = (): WindowState => {
  const state = desktopStore.get("windowState");
  return {
    height: normalizeNumber(state?.height, 620),
    width: normalizeNumber(state?.width, 420)
  };
};

export const setWindowState = (state: WindowState): void => {
  desktopStore.set("windowState", state);
};

export const applyTheme = (theme: ThemeMode): void => {
  nativeTheme.themeSource = theme;
};

export const getIdleStatus = (): RecorderStatusSnapshot => {
  const settings = getSettings();
  return {
    ...DEFAULT_STATUS,
    asrEnabled: !settings.recording.disableAsr,
    autoSwitchEnabled: settings.recording.autoSwitchDevice,
    deviceLabel: settings.recording.device
  };
};
