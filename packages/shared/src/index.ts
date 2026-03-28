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
  asrLanguage: string;
  autoSwitchConfirmations: number;
  autoSwitchDevice: boolean;
  device: string;
  disableAsr: boolean;
  excludeDeviceKeywords: string;
  outputDir: string;
  segmentMinutes: number;
}

export interface TranscribeSettings {
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
  downloadMessage: string;
  downloadProgress: number | null;
  deviceLabel: string;
  elapsed: string;
  error: string | null;
  ffmpegAvailable: boolean;
  inSpeech: boolean;
  levelRatio: number;
  downloading: boolean;
  recording: boolean;
  rms: number;
  senseVoiceReady: boolean;
  statusMessage: string;
  vadReady: boolean;
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

export interface AppInfoSnapshot {
  name: string;
  repositoryUrl: string;
  version: string;
}

export type AutoUpdatePhase =
  | "checking"
  | "downloaded"
  | "downloading"
  | "error"
  | "idle"
  | "unavailable";

export interface AutoUpdateSnapshot {
  currentVersion: string;
  downloadedVersion: string | null;
  downloadedVersionReady: boolean;
  errorMessage: string | null;
  installDeferredUntilIdle: boolean;
  latestVersion: string | null;
  phase: AutoUpdatePhase;
  statusMessage: string;
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
  app: AppInfoSnapshot;
  devices: DeviceInfo[];
  engineReady: boolean;
  history: RecordingHistoryItem[];
  permission: MicrophonePermissionStatus;
  settings: AppSettings;
  status: RecorderStatusSnapshot;
  updater: AutoUpdateSnapshot;
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
    asrLanguage: "auto",
    autoSwitchConfirmations: 2,
    autoSwitchDevice: true,
    device: "default",
    disableAsr: false,
    excludeDeviceKeywords: "iphone,continuity",
    outputDir: "recordings",
    segmentMinutes: 60
  },
  transcribe: {
    watch: false
  }
};

export const DEFAULT_STATUS: RecorderStatusSnapshot = {
  asrEnabled: true,
  asrHistory: [],
  asrPreview: "",
  autoSwitchEnabled: true,
  db: -80,
  downloadMessage: "",
  downloadProgress: null,
  deviceLabel: "default",
  elapsed: "00:00:00",
  error: null,
  ffmpegAvailable: false,
  inSpeech: false,
  levelRatio: 0,
  downloading: false,
  recording: false,
  rms: 0,
  senseVoiceReady: false,
  statusMessage: "桌面端已就绪。",
  vadReady: false,
  waveformBins: Array.from({ length: 48 }, () => 0)
};
