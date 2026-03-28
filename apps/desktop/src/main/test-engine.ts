import {
  DEFAULT_SETTINGS,
  DEFAULT_STATUS,
  type AppSettings,
  type DeviceInfo,
  type RecorderStatusSnapshot
} from "@eve/shared";

type StatusListener = (status: RecorderStatusSnapshot) => void;

const TEST_DEVICES: DeviceInfo[] = [
  {
    id: "default",
    index: 0,
    isDefault: true,
    label: "MacBook Pro Microphone"
  },
  {
    id: "usb-mic",
    index: 1,
    isDefault: false,
    label: "USB Podcast Mic"
  }
];

export class TestDesktopEngine {
  private readonly onStatus: StatusListener;
  private devices: DeviceInfo[] = TEST_DEVICES;
  private settings: AppSettings = DEFAULT_SETTINGS;
  private status: RecorderStatusSnapshot = {
    ...DEFAULT_STATUS,
    deviceLabel: TEST_DEVICES[0]?.label ?? DEFAULT_STATUS.deviceLabel,
    ffmpegAvailable: true,
    senseVoiceReady: true,
    statusMessage: "E2E desktop engine ready.",
    vadReady: true
  };
  private recordingStartedAt = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(onStatus: StatusListener) {
    this.onStatus = onStatus;
  }

  async applySettings(settings: AppSettings): Promise<void> {
    this.settings = settings;
    this.patchStatus({
      asrEnabled: !settings.recording.disableAsr,
      autoSwitchEnabled: settings.recording.autoSwitchDevice,
      deviceLabel: this.resolveDeviceLabel(settings.recording.device)
    });
  }

  getDevices(): DeviceInfo[] {
    return this.devices;
  }

  getReady(): boolean {
    return true;
  }

  getStatus(): RecorderStatusSnapshot {
    return { ...this.status };
  }

  updateDevices(devices: DeviceInfo[]): void {
    this.devices = devices;
    this.patchStatus({
      deviceLabel: this.resolveDeviceLabel(this.settings.recording.device)
    });
  }

  reportCaptureError(error: string): void {
    this.clearTimer();
    this.patchStatus({
      error,
      recording: false,
      statusMessage: error
    });
  }

  async startRecording(): Promise<void> {
    if (this.status.recording) {
      return;
    }
    this.recordingStartedAt = Date.now();
    this.patchStatus({
      asrEnabled: !this.settings.recording.disableAsr,
      asrHistory: [],
      asrPreview: this.settings.recording.disableAsr ? "" : "Listening for speech in test mode.",
      deviceLabel: this.resolveDeviceLabel(this.settings.recording.device),
      error: null,
      ffmpegAvailable: true,
      inSpeech: true,
      recording: true,
      senseVoiceReady: true,
      statusMessage: "Test recording in progress.",
      vadReady: true
    });
    this.timer = setInterval(() => {
      this.patchStatus({
        elapsed: this.elapsedLabel()
      });
    }, 250);
  }

  async stopRecording(): Promise<void> {
    if (!this.status.recording) {
      return;
    }
    this.clearTimer();
    this.patchStatus({
      asrHistory: this.settings.recording.disableAsr ? [] : ["Playwright test transcript."],
      asrPreview: "",
      elapsed: "00:00:00",
      inSpeech: false,
      recording: false,
      statusMessage: "Test recording stopped."
    });
  }

  async runTranscribe(): Promise<void> {
    this.patchStatus({
      statusMessage: "Test transcription finished."
    });
  }

  async pushAudioChunk(): Promise<void> {}

  private resolveDeviceLabel(deviceId: string): string {
    if (deviceId === "default") {
      return this.devices.find((device) => device.isDefault)?.label ?? DEFAULT_STATUS.deviceLabel;
    }
    return this.devices.find((device) => device.id === deviceId)?.label ?? deviceId;
  }

  private elapsedLabel(): string {
    const totalSeconds = Math.max(0, Math.floor((Date.now() - this.recordingStartedAt) / 1000));
    const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
    const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
    const seconds = String(totalSeconds % 60).padStart(2, "0");
    return `${hours}:${minutes}:${seconds}`;
  }

  private clearTimer(): void {
    if (!this.timer) {
      return;
    }
    clearInterval(this.timer);
    this.timer = null;
  }

  private patchStatus(patch: Partial<RecorderStatusSnapshot>): void {
    this.status = {
      ...this.status,
      ...patch
    };
    this.onStatus({ ...this.status });
  }
}
