import { describe, expect, it, beforeEach, vi } from "vitest";
import { DEFAULT_SETTINGS, DEFAULT_STATUS, type AppSettings } from "@eve/shared";

const modelManagerState = {
  requireFfmpeg: vi.fn(async () => {}),
  ensureRuntimeAssets: vi.fn(async () => {}),
  onStatus: vi.fn<(listener: (status: Partial<typeof DEFAULT_STATUS>) => void) => void>(),
  getSenseVoiceDirectory: vi.fn(() => "/models/sense-voice"),
  getStatus: vi.fn(() => ({
    downloading: false,
    ffmpegAvailable: true,
    senseVoiceReady: true,
    vadReady: true
  })),
  getVadModelPath: vi.fn(() => "/models/vad.onnx")
};

const writerClose = vi.fn<() => Promise<void>>(async () => {});
const writerAppend = vi.fn<(samples: Float32Array) => Promise<void>>(async () => {});
const transcodeWavToFlac = vi.fn<(inputPath: string, outputPath: string) => Promise<void>>(async () => {});
const writeJsonAtomic = vi.fn<(path: string, payload: unknown) => Promise<void>>(async () => {});

vi.mock("electron-log/main", () => ({
  default: { error: vi.fn(), info: vi.fn() }
}));

vi.mock("./audio-utils", () => ({
  WavWriter: class {
    constructor(private readonly path: string) {}
    append = writerAppend;
    close = writerClose;
    getPath() { return this.path; }
  },
  buildWaveformBins: vi.fn(() => DEFAULT_STATUS.waveformBins),
  createSenseVoiceRecognizer: vi.fn(() => ({ decode: vi.fn(), createStream: vi.fn(), getResult: vi.fn() })),
  createSherpaVad: vi.fn(() => ({
    acceptWaveform: vi.fn(),
    config: { sileroVad: { windowSize: 512 } },
    flush: vi.fn(),
    front: vi.fn(),
    isDetected: vi.fn(() => false),
    isEmpty: vi.fn(() => true),
    pop: vi.fn()
  })),
  decodeSegment: vi.fn(() => ({ text: "" })),
  downsampleTo16k: vi.fn((samples: Float32Array) => samples),
  ensureWavInput: vi.fn(async (inputPath: string) => inputPath),
  rms: vi.fn(() => 0),
  rmsToDb: vi.fn(() => -80),
  transcodeWavToFlac,
  transcribeAudioFile: vi.fn(async () => ({ lang: "zh", text: "hello" })),
  writeJsonAtomic
}));

vi.mock("./model-manager", () => ({
  ModelManager: class {
    ensureRuntimeAssets = modelManagerState.ensureRuntimeAssets;
    getSenseVoiceDirectory = modelManagerState.getSenseVoiceDirectory;
    getStatus = modelManagerState.getStatus;
    getVadModelPath = modelManagerState.getVadModelPath;
    onStatus = modelManagerState.onStatus;
    requireFfmpeg = modelManagerState.requireFfmpeg;
  }
}));

describe("DesktopEngine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    modelManagerState.onStatus.mockImplementation(() => {});
  });

  it("skips sidecar JSON creation when realtime transcription is disabled", async () => {
    const { DesktopEngine } = await import("./desktop-engine");
    const engine = new DesktopEngine(() => {});

    await engine.applySettings({
      ...DEFAULT_SETTINGS,
      recording: { ...DEFAULT_SETTINGS.recording, disableAsr: true }
    });

    await engine.startRecording();
    await engine.stopRecording();

    expect(writeJsonAtomic).not.toHaveBeenCalled();
    expect(transcodeWavToFlac).toHaveBeenCalledTimes(1);
  });

  it("rotates the active segment immediately when recording output settings change", async () => {
    const { DesktopEngine } = await import("./desktop-engine");
    const engine = new DesktopEngine(() => {});
    const initial = buildSettings({
      audioFormat: "wav",
      disableAsr: false,
      outputDir: "/tmp/recordings-a"
    });
    const next = buildSettings({
      audioFormat: "flac",
      disableAsr: true,
      outputDir: "/tmp/recordings-b"
    });

    await engine.applySettings(initial);
    await engine.startRecording();
    await engine.applySettings(next);
    await engine.stopRecording();

    expect(modelManagerState.requireFfmpeg).toHaveBeenCalledTimes(1);
    expect(transcodeWavToFlac).toHaveBeenCalledTimes(2);
    expect(writeJsonAtomic).toHaveBeenCalledTimes(1);
    const firstCall = writeJsonAtomic.mock.calls.at(0);
    expect(firstCall).toBeDefined();
    expect(String(firstCall?.[0])).toContain("/tmp/recordings-a/");
  });
});

function buildSettings(
  recording: Partial<AppSettings["recording"]>
): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    recording: {
      ...DEFAULT_SETTINGS.recording,
      ...recording
    }
  };
}
