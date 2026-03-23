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
const VALID_DTYPES = ["auto", "float16", "float32"] as const;
type ValidDtype = (typeof VALID_DTYPES)[number];

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

const normalizeDtype = (value: unknown, fallback: ValidDtype): ValidDtype => {
  return typeof value === "string" && VALID_DTYPES.includes(value as ValidDtype)
    ? (value as ValidDtype)
    : fallback;
};

const mergeSharedAsrSettings = (settings: AppSettings): AppSettings => {
  return {
    ...settings,
    transcribe: {
      ...settings.transcribe,
      asrDevice: settings.recording.asrDevice,
      asrDtype: settings.recording.asrDtype,
      asrLanguage: settings.recording.asrLanguage,
      asrMaxBatchSize: settings.recording.asrMaxBatchSize,
      asrMaxNewTokens: settings.recording.asrMaxNewTokens,
      asrModel: settings.recording.asrModel,
      asrPreload: settings.recording.asrPreload,
      inputDir: settings.recording.outputDir
    }
  };
};

export const getSettings = (): AppSettings => {
  const stored = desktopStore.get("settings");
  return mergeSharedAsrSettings({
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
      asrDevice: normalizeString(
        stored?.recording?.asrDevice,
        DEFAULT_SETTINGS.recording.asrDevice
      ),
      asrDtype: normalizeDtype(
        stored?.recording?.asrDtype,
        DEFAULT_SETTINGS.recording.asrDtype
      ),
      asrLanguage: normalizeString(
        stored?.recording?.asrLanguage,
        DEFAULT_SETTINGS.recording.asrLanguage
      ),
      asrMaxBatchSize: normalizeNumber(
        stored?.recording?.asrMaxBatchSize,
        DEFAULT_SETTINGS.recording.asrMaxBatchSize
      ),
      asrMaxNewTokens: normalizeNumber(
        stored?.recording?.asrMaxNewTokens,
        DEFAULT_SETTINGS.recording.asrMaxNewTokens
      ),
      asrModel: normalizeString(
        stored?.recording?.asrModel,
        DEFAULT_SETTINGS.recording.asrModel
      ),
      asrPreload: normalizeBoolean(
        stored?.recording?.asrPreload,
        DEFAULT_SETTINGS.recording.asrPreload
      ),
      autoSwitchConfirmations: normalizeNumber(
        stored?.recording?.autoSwitchConfirmations,
        DEFAULT_SETTINGS.recording.autoSwitchConfirmations
      ),
      autoSwitchCooldownSeconds: normalizeNumber(
        stored?.recording?.autoSwitchCooldownSeconds,
        DEFAULT_SETTINGS.recording.autoSwitchCooldownSeconds
      ),
      autoSwitchDevice: normalizeBoolean(
        stored?.recording?.autoSwitchDevice,
        DEFAULT_SETTINGS.recording.autoSwitchDevice
      ),
      autoSwitchMaxCandidatesPerScan: normalizeNumber(
        stored?.recording?.autoSwitchMaxCandidatesPerScan,
        DEFAULT_SETTINGS.recording.autoSwitchMaxCandidatesPerScan
      ),
      autoSwitchMinRatio: normalizeNumber(
        stored?.recording?.autoSwitchMinRatio,
        DEFAULT_SETTINGS.recording.autoSwitchMinRatio
      ),
      autoSwitchMinRms: normalizeNumber(
        stored?.recording?.autoSwitchMinRms,
        DEFAULT_SETTINGS.recording.autoSwitchMinRms
      ),
      autoSwitchProbeSeconds: normalizeNumber(
        stored?.recording?.autoSwitchProbeSeconds,
        DEFAULT_SETTINGS.recording.autoSwitchProbeSeconds
      ),
      autoSwitchScanSeconds: normalizeNumber(
        stored?.recording?.autoSwitchScanSeconds,
        DEFAULT_SETTINGS.recording.autoSwitchScanSeconds
      ),
      consoleFeedback: normalizeBoolean(
        stored?.recording?.consoleFeedback,
        DEFAULT_SETTINGS.recording.consoleFeedback
      ),
      consoleFeedbackHz: normalizeNumber(
        stored?.recording?.consoleFeedbackHz,
        DEFAULT_SETTINGS.recording.consoleFeedbackHz
      ),
      device: normalizeString(
        stored?.recording?.device,
        DEFAULT_SETTINGS.recording.device
      ),
      deviceCheckSeconds: normalizeNumber(
        stored?.recording?.deviceCheckSeconds,
        DEFAULT_SETTINGS.recording.deviceCheckSeconds
      ),
      deviceRetrySeconds: normalizeNumber(
        stored?.recording?.deviceRetrySeconds,
        DEFAULT_SETTINGS.recording.deviceRetrySeconds
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
      asrDevice: normalizeString(
        stored?.transcribe?.asrDevice,
        DEFAULT_SETTINGS.transcribe.asrDevice
      ),
      asrDtype: normalizeDtype(
        stored?.transcribe?.asrDtype,
        DEFAULT_SETTINGS.transcribe.asrDtype
      ),
      asrLanguage: normalizeString(
        stored?.transcribe?.asrLanguage,
        DEFAULT_SETTINGS.transcribe.asrLanguage
      ),
      asrMaxBatchSize: normalizeNumber(
        stored?.transcribe?.asrMaxBatchSize,
        DEFAULT_SETTINGS.transcribe.asrMaxBatchSize
      ),
      asrMaxNewTokens: normalizeNumber(
        stored?.transcribe?.asrMaxNewTokens,
        DEFAULT_SETTINGS.transcribe.asrMaxNewTokens
      ),
      asrModel: normalizeString(
        stored?.transcribe?.asrModel,
        DEFAULT_SETTINGS.transcribe.asrModel
      ),
      asrPreload: normalizeBoolean(
        stored?.transcribe?.asrPreload,
        DEFAULT_SETTINGS.transcribe.asrPreload
      ),
      force: normalizeBoolean(
        stored?.transcribe?.force,
        DEFAULT_SETTINGS.transcribe.force
      ),
      inputDir: normalizeString(
        stored?.transcribe?.inputDir,
        DEFAULT_SETTINGS.transcribe.inputDir
      ),
      limit: normalizeNumber(
        stored?.transcribe?.limit,
        DEFAULT_SETTINGS.transcribe.limit
      ),
      pollSeconds: normalizeNumber(
        stored?.transcribe?.pollSeconds,
        DEFAULT_SETTINGS.transcribe.pollSeconds
      ),
      prefix: normalizeString(
        stored?.transcribe?.prefix,
        DEFAULT_SETTINGS.transcribe.prefix
      ),
      settleSeconds: normalizeNumber(
        stored?.transcribe?.settleSeconds,
        DEFAULT_SETTINGS.transcribe.settleSeconds
      ),
      watch: normalizeBoolean(
        stored?.transcribe?.watch,
        DEFAULT_SETTINGS.transcribe.watch
      )
    }
  });
};

export const setSettings = (settings: AppSettings): AppSettings => {
  const normalizedSettings = mergeSharedAsrSettings(settings);
  desktopStore.set("settings", {
    ...normalizedSettings,
    desktop: {
      ...normalizedSettings.desktop,
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
