export type AudioFormat = "flac" | "wav";

export type AppLanguage = "en-US" | "system" | "zh-CN";

export type ThemeMode = "dark" | "light" | "system";

export interface DesktopSettings {
  hideWindowOnClose: boolean;
  language: AppLanguage;
  launchAtLogin: boolean;
  startRecordingOnLaunch: boolean;
  theme: ThemeMode;
}

export interface RecordingSettings {
  audioFormat: AudioFormat;
  asrDevice: string;
  asrDtype: "auto" | "float16" | "float32";
  asrLanguage: string;
  asrMaxBatchSize: number;
  asrMaxNewTokens: number;
  asrModel: string;
  asrPreload: boolean;
  autoSwitchConfirmations: number;
  autoSwitchCooldownSeconds: number;
  autoSwitchDevice: boolean;
  autoSwitchMaxCandidatesPerScan: number;
  autoSwitchMinRatio: number;
  autoSwitchMinRms: number;
  autoSwitchProbeSeconds: number;
  autoSwitchScanSeconds: number;
  consoleFeedback: boolean;
  consoleFeedbackHz: number;
  device: string;
  deviceCheckSeconds: number;
  deviceRetrySeconds: number;
  disableAsr: boolean;
  excludeDeviceKeywords: string;
  outputDir: string;
  segmentMinutes: number;
}

export interface TranscribeSettings {
  asrDevice: string;
  asrDtype: "auto" | "float16" | "float32";
  asrLanguage: string;
  asrMaxBatchSize: number;
  asrMaxNewTokens: number;
  asrModel: string;
  asrPreload: boolean;
  force: boolean;
  inputDir: string;
  limit: number;
  pollSeconds: number;
  prefix: string;
  settleSeconds: number;
  watch: boolean;
}

export interface AppSettings {
  desktop: DesktopSettings;
  recording: RecordingSettings;
  transcribe: TranscribeSettings;
}

export interface DeviceInfo {
  id: string;
  index: number;
  isDefault: boolean;
  label: string;
}

export type MicrophonePermissionState =
  | "authorized"
  | "denied"
  | "not-determined"
  | "restricted"
  | "unsupported";

export interface MicrophonePermissionStatus {
  message: string;
  state: MicrophonePermissionState;
  supported: boolean;
}

export interface RecorderStatusSnapshot {
  asrEnabled: boolean;
  asrHistory: string[];
  asrPreview: string;
  autoSwitchEnabled: boolean;
  db: number;
  deviceLabel: string;
  elapsed: string;
  error: string | null;
  inSpeech: boolean;
  levelRatio: number;
  recording: boolean;
  rms: number;
  statusMessage: string;
  waveformBins: number[];
}

export interface RecordingHistoryItem {
  audioPath: string;
  folderPath: string;
  id: string;
  inputDevice: string | null;
  startedAt: string;
  status: string;
  textPreview: string;
}

export type SidecarRequest =
  | { id: string; method: "devices.list" }
  | { id: string; method: "recording.start" }
  | { id: string; method: "recording.status" }
  | { id: string; method: "recording.stop" }
  | { id: string; method: "settings.apply"; params: AppSettings }
  | {
      id: string;
      method: "transcribe.run";
      params?: { force?: boolean; inputDir?: string; limit?: number };
    };

export type SidecarResponse =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: string };

export type SidecarEvent =
  | { type: "error"; payload: { message: string } }
  | { type: "exit"; payload: { code: number | null; signal: string | null } }
  | { type: "ready"; payload: { pythonPath: string; scriptPath: string } }
  | { type: "status"; payload: RecorderStatusSnapshot }
  | { type: "transcript-preview"; payload: { history: string[]; preview: string } }
  | { type: "waveform"; payload: { bins: number[]; deviceLabel: string } };

export interface DesktopSnapshot {
  devices: DeviceInfo[];
  history: RecordingHistoryItem[];
  permission: MicrophonePermissionStatus;
  settings: AppSettings;
  sidecarReady: boolean;
  status: RecorderStatusSnapshot;
  windowPinned: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  desktop: {
    hideWindowOnClose: true,
    language: "system",
    launchAtLogin: true,
    startRecordingOnLaunch: true,
    theme: "system"
  },
  recording: {
    audioFormat: "flac",
    asrDevice: "auto",
    asrDtype: "auto",
    asrLanguage: "auto",
    asrMaxBatchSize: 1,
    asrMaxNewTokens: 256,
    asrModel: "Qwen/Qwen3-ASR-0.6B",
    asrPreload: false,
    autoSwitchConfirmations: 2,
    autoSwitchCooldownSeconds: 8,
    autoSwitchDevice: true,
    autoSwitchMaxCandidatesPerScan: 2,
    autoSwitchMinRatio: 1.8,
    autoSwitchMinRms: 0.006,
    autoSwitchProbeSeconds: 0.25,
    autoSwitchScanSeconds: 3,
    consoleFeedback: false,
    consoleFeedbackHz: 12,
    device: "default",
    deviceCheckSeconds: 2,
    deviceRetrySeconds: 2,
    disableAsr: false,
    excludeDeviceKeywords: "iphone,continuity",
    outputDir: "recordings",
    segmentMinutes: 60
  },
  transcribe: {
    asrDevice: "auto",
    asrDtype: "auto",
    asrLanguage: "auto",
    asrMaxBatchSize: 1,
    asrMaxNewTokens: 256,
    asrModel: "Qwen/Qwen3-ASR-0.6B",
    asrPreload: false,
    force: false,
    inputDir: "recordings",
    limit: 0,
    pollSeconds: 2,
    prefix: "eve",
    settleSeconds: 3,
    watch: false
  }
};

export const DEFAULT_STATUS: RecorderStatusSnapshot = {
  asrEnabled: true,
  asrHistory: [],
  asrPreview: "",
  autoSwitchEnabled: true,
  db: -80,
  deviceLabel: "default",
  elapsed: "00:00:00",
  error: null,
  inSpeech: false,
  levelRatio: 0,
  recording: false,
  rms: 0,
  statusMessage: "桌面端已就绪。",
  waveformBins: Array.from({ length: 48 }, () => 0)
};
