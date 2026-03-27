import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import log from "electron-log/main";
import {
  DEFAULT_SETTINGS,
  DEFAULT_STATUS,
  type AppSettings,
  type DeviceInfo,
  type RecorderStatusSnapshot
} from "@eve/shared";
import {
  WavWriter,
  buildWaveformBins,
  createSenseVoiceRecognizer,
  createSherpaVad,
  decodeSegment,
  downsampleTo16k,
  ensureWavInput,
  rms,
  rmsToDb,
  transcodeWavToFlac,
  transcribeAudioFile,
  writeJsonAtomic
} from "./audio-utils";
import { ModelManager } from "./model-manager";

interface AudioChunkPayload {
  deviceId: string;
  deviceLabel: string;
  rms: number;
  sampleRate: number;
  samples: Float32Array;
}

interface RecordingSegment {
  audioPath: string;
  createdAt: string;
  deviceLabel: string;
  jsonPath: string;
  startedAt: Date;
  texts: string[];
  wavPath: string;
  writer: WavWriter;
}

type StatusListener = (status: RecorderStatusSnapshot) => void;

const HISTORY_LIMIT = 5;
const AUDIO_EXTENSIONS = new Set([".flac", ".wav"]);
const AUDIO_QUEUE_ASR_BACKPRESSURE_THRESHOLD = 6;
const AUDIO_QUEUE_ASR_RESUME_THRESHOLD = 2;
const DIAGNOSTIC_LOG_INTERVAL_MS = 15_000;
const TRANSCRIBE_LIMIT = 0;

export class DesktopEngine {
  private readonly modelManager = new ModelManager();
  private readonly onStatus: StatusListener;
  private readonly pendingAudioChunks: AudioChunkPayload[] = [];
  private readonly queueIdleWaiters = new Set<() => void>();
  private devices: DeviceInfo[] = [];
  private settings: AppSettings = DEFAULT_SETTINGS;
  private status: RecorderStatusSnapshot = {
    ...DEFAULT_STATUS,
    ...this.modelManager.getStatus()
  };
  private processingAudioQueue = false;
  private recognizer: ReturnType<typeof createSenseVoiceRecognizer> | null = null;
  private segment: RecordingSegment | null = null;
  private recordingStartedAt = 0;
  private skippedAsrChunks = 0;
  private asrBackpressureActive = false;
  private lastDiagnosticLogAt = 0;
  private vad: ReturnType<typeof createSherpaVad> | null = null;
  private vadRemainder = new Float32Array(0);

  constructor(onStatus: StatusListener) {
    this.onStatus = onStatus;
    this.modelManager.onStatus((assetStatus) => {
      this.patchStatus(assetStatus);
    });
  }

  applySettings(settings: AppSettings): void {
    this.settings = settings;
    this.patchStatus({
      asrEnabled: !settings.recording.disableAsr,
      autoSwitchEnabled: settings.recording.autoSwitchDevice
    });
  }

  getDevices(): DeviceInfo[] {
    return this.devices;
  }

  getReady(): boolean {
    return this.status.senseVoiceReady && this.status.vadReady && !this.status.downloading;
  }

  getStatus(): RecorderStatusSnapshot {
    return { ...this.status };
  }

  updateDevices(devices: DeviceInfo[]): void {
    this.devices = devices;
  }

  reportCaptureError(error: string): void {
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
    await this.modelManager.ensureRuntimeAssets();
    if (this.settings.recording.audioFormat === "flac") {
      await this.modelManager.requireFfmpeg();
    }
    if (!this.settings.recording.disableAsr) {
      this.recognizer ??= createSenseVoiceRecognizer(
        this.modelManager.getSenseVoiceDirectory(),
        this.settings.recording.asrLanguage
      );
    }
    this.vad = createSherpaVad(this.modelManager.getVadModelPath());
    this.vadRemainder = new Float32Array(0);
    this.pendingAudioChunks.length = 0;
    this.skippedAsrChunks = 0;
    this.asrBackpressureActive = false;
    this.lastDiagnosticLogAt = 0;
    this.recordingStartedAt = Date.now();
    this.segment = await this.openSegment();
    this.logDiagnostics("recording-started");
    this.patchStatus({
      asrEnabled: !this.settings.recording.disableAsr,
      asrHistory: [],
      asrPreview: "",
      error: null,
      inSpeech: false,
      recording: true,
      statusMessage: "Recording with Qwen3 ASR.",
      waveformBins: DEFAULT_STATUS.waveformBins
    });
  }

  async stopRecording(): Promise<void> {
    if (!this.status.recording) {
      return;
    }
    await this.waitForPendingAudio();
    this.flushVad();
    await this.closeSegment();
    this.vad = null;
    this.segment = null;
    this.recordingStartedAt = 0;
    this.logDiagnostics("recording-stopped", { force: true });
    this.patchStatus({
      elapsed: "00:00:00",
      inSpeech: false,
      recording: false,
      statusMessage: "Recording stopped."
    });
  }

  async pushAudioChunk(payload: AudioChunkPayload): Promise<void> {
    if (!this.status.recording || !this.segment) {
      return;
    }
    this.pendingAudioChunks.push(payload);
    this.scheduleAudioQueueDrain();
  }

  private scheduleAudioQueueDrain(): void {
    if (this.processingAudioQueue) {
      return;
    }
    this.processingAudioQueue = true;
    void this.drainAudioQueue();
  }

  private async drainAudioQueue(): Promise<void> {
    try {
      while (this.pendingAudioChunks.length > 0) {
        const payload = this.pendingAudioChunks.shift();
        if (!payload) {
          continue;
        }
        try {
          await this.processAudioChunk(payload);
        } catch (error) {
          log.error("[eve][engine] failed to process audio chunk", error);
          this.reportCaptureError(error instanceof Error ? error.message : "Audio processing failed.");
          this.pendingAudioChunks.length = 0;
          break;
        }
      }
    } finally {
      this.processingAudioQueue = false;
      if (this.pendingAudioChunks.length > 0) {
        this.scheduleAudioQueueDrain();
        return;
      }
      for (const resolve of this.queueIdleWaiters) {
        resolve();
      }
      this.queueIdleWaiters.clear();
    }
  }

  private async processAudioChunk(payload: AudioChunkPayload): Promise<void> {
    if (!this.status.recording || !this.segment) {
      return;
    }
    if (this.shouldRotateSegment()) {
      await this.rotateSegment(payload.deviceLabel);
    }
    const samples = downsampleTo16k(payload.samples, payload.sampleRate);
    await this.segment.writer.append(samples);
    this.patchStatus({
      db: rmsToDb(payload.rms),
      deviceLabel: payload.deviceLabel || this.segment.deviceLabel,
      elapsed: this.elapsedLabel(),
      levelRatio: payload.rms,
      rms: payload.rms,
      waveformBins: buildWaveformBins(samples)
    });
    if (!this.settings.recording.disableAsr && this.shouldThrottleAsr()) {
      this.skippedAsrChunks += 1;
      this.logDiagnostics("audio-backpressure");
      return;
    }
    this.consumeVadSamples(samples, { decodeSegments: !this.settings.recording.disableAsr });
  }

  async runTranscribe(inputDirectory: string): Promise<void> {
    await this.modelManager.ensureRuntimeAssets();
    const recognizer =
      this.recognizer ??
      createSenseVoiceRecognizer(
        this.modelManager.getSenseVoiceDirectory(),
        this.settings.recording.asrLanguage
      );
    this.recognizer = recognizer;
    const files = await this.collectAudioFiles(resolve(inputDirectory));
    let processed = 0;
    for (const audioPath of files) {
      if (TRANSCRIBE_LIMIT > 0 && processed >= TRANSCRIBE_LIMIT) {
        break;
      }
      if (extname(audioPath).toLowerCase() !== ".wav") {
        await this.modelManager.requireFfmpeg();
      }
      const jsonPath = `${audioPath.slice(0, -extname(audioPath).length)}.json`;
      const result = await transcribeAudioFile(recognizer, audioPath);
      const text = result.text.trim();
      await writeJsonAtomic(jsonPath, {
        audio_file: basename(audioPath),
        audio_path: audioPath,
        backend: "sherpa-onnx",
        created_at: new Date().toISOString(),
        language: result.lang || null,
        model: "Qwen3 ASR",
        status: "ok",
        text
      });
      processed += 1;
    }
    this.patchStatus({
      statusMessage: `Transcribed ${processed} recording${processed === 1 ? "" : "s"}.`
    });
  }

  private async collectAudioFiles(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = await Promise.all(
      entries.map(async (entry) => {
        const fullPath = join(directory, entry.name);
        if (entry.isDirectory()) {
          return this.collectAudioFiles(fullPath);
        }
        if (entry.isFile() && AUDIO_EXTENSIONS.has(extname(fullPath).toLowerCase())) {
          return [fullPath];
        }
        return [];
      })
    );
    return files.flat().sort();
  }

  private consumeVadSamples(
    samples: Float32Array,
    { decodeSegments }: { decodeSegments: boolean }
  ): void {
    if (!this.vad) {
      return;
    }
    const combined = new Float32Array(this.vadRemainder.length + samples.length);
    combined.set(this.vadRemainder);
    combined.set(samples, this.vadRemainder.length);
    const windowSize = this.vad.config.sileroVad.windowSize;
    let offset = 0;
    while (offset + windowSize <= combined.length) {
      this.vad.acceptWaveform(combined.subarray(offset, offset + windowSize));
      offset += windowSize;
      this.patchStatus({ inSpeech: this.vad.isDetected() });
      this.drainVadSegments({ decodeSegments });
    }
    this.vadRemainder = combined.subarray(offset);
  }

  private drainVadSegments({
    decodeSegments
  }: {
    decodeSegments: boolean;
  }): void {
    if (!this.vad) {
      return;
    }
    while (!this.vad.isEmpty()) {
      const vadSegment = this.vad.front(false);
      this.vad.pop();
      if (!decodeSegments || !this.recognizer || !this.segment) {
        continue;
      }
      const result = decodeSegment(this.recognizer, vadSegment.samples);
      const text = result.text.trim();
      if (!text) {
        continue;
      }
      const history = this.status.asrPreview
        ? [this.status.asrPreview, ...this.status.asrHistory]
        : [...this.status.asrHistory];
      this.segment.texts.push(text);
      this.patchStatus({
        asrHistory: history.slice(0, HISTORY_LIMIT),
        asrPreview: text,
        statusMessage: "Speech recognized."
      });
    }
  }

  private flushVad(): void {
    if (!this.vad) {
      return;
    }
    if (this.vadRemainder.length > 0) {
      const padded = new Float32Array(this.vad.config.sileroVad.windowSize);
      padded.set(this.vadRemainder);
      this.vad.acceptWaveform(padded);
      this.vadRemainder = new Float32Array(0);
    }
    this.vad.flush();
    this.drainVadSegments({ decodeSegments: !this.settings.recording.disableAsr });
  }

  private shouldRotateSegment(): boolean {
    if (!this.segment) {
      return false;
    }
    return Date.now() - this.segment.startedAt.getTime() >= this.settings.recording.segmentMinutes * 60_000;
  }

  private async rotateSegment(deviceLabel: string): Promise<void> {
    await this.closeSegment();
    this.segment = await this.openSegment(deviceLabel);
    this.patchStatus({
      asrPreview: "",
      statusMessage: "Started a new recording segment."
    });
  }

  private async openSegment(deviceLabel?: string): Promise<RecordingSegment> {
    const now = new Date();
    const outputDirectory = resolve(
      this.settings.recording.outputDir,
      this.formatSegmentDirectoryName(now)
    );
    await mkdir(outputDirectory, { recursive: true });
    const baseName = this.formatSegmentName(now);
    const wavPath = join(outputDirectory, `${baseName}.wav`);
    return {
      audioPath: wavPath,
      createdAt: now.toISOString(),
      deviceLabel: deviceLabel || this.status.deviceLabel || "default",
      jsonPath: join(outputDirectory, `${baseName}.json`),
      startedAt: now,
      texts: [],
      wavPath,
      writer: new WavWriter(wavPath)
    };
  }

  private async closeSegment(): Promise<void> {
    if (!this.segment) {
      return;
    }
    const current = this.segment;
    this.segment = null;
    await current.writer.close();
    let finalAudioPath = current.wavPath;
    if (this.settings.recording.audioFormat === "flac") {
      finalAudioPath = current.wavPath.replace(/\.wav$/i, ".flac");
      await transcodeWavToFlac(current.wavPath, finalAudioPath);
      await rm(current.wavPath, { force: true });
    }
    await writeJsonAtomic(current.jsonPath, {
      audio_file: basename(finalAudioPath),
      audio_path: finalAudioPath,
      backend: "sherpa-onnx",
      created_at: current.createdAt,
      input_device: current.deviceLabel,
      model: "Qwen3 ASR",
      segment_start_time: current.startedAt.toISOString(),
      status: "ok",
      text: current.texts.join(" ").trim()
    });
  }

  private shouldThrottleAsr(): boolean {
    const backlog = this.pendingAudioChunks.length;
    if (!this.asrBackpressureActive && backlog >= AUDIO_QUEUE_ASR_BACKPRESSURE_THRESHOLD) {
      this.asrBackpressureActive = true;
      this.logDiagnostics("asr-backpressure-enabled", { force: true });
    } else if (this.asrBackpressureActive && backlog <= AUDIO_QUEUE_ASR_RESUME_THRESHOLD) {
      this.asrBackpressureActive = false;
      this.logDiagnostics("asr-backpressure-cleared", { force: true });
    }
    return this.asrBackpressureActive;
  }

  private async waitForPendingAudio(): Promise<void> {
    if (!this.processingAudioQueue && this.pendingAudioChunks.length === 0) {
      return;
    }
    await new Promise<void>((resolve) => {
      this.queueIdleWaiters.add(resolve);
    });
  }

  private elapsedLabel(): string {
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - this.recordingStartedAt) / 1000));
    const hours = Math.floor(elapsedSeconds / 3600).toString().padStart(2, "0");
    const minutes = Math.floor((elapsedSeconds % 3600) / 60).toString().padStart(2, "0");
    const seconds = (elapsedSeconds % 60).toString().padStart(2, "0");
    return `${hours}:${minutes}:${seconds}`;
  }

  private formatSegmentName(value: Date): string {
    const stamp = `${value.getFullYear()}${`${value.getMonth() + 1}`.padStart(2, "0")}${`${value.getDate()}`.padStart(2, "0")}_${`${value.getHours()}`.padStart(2, "0")}${`${value.getMinutes()}`.padStart(2, "0")}${`${value.getSeconds()}`.padStart(2, "0")}`;
    return `eve_${stamp}`;
  }

  private formatSegmentDirectoryName(value: Date): string {
    return `${value.getFullYear()}${`${value.getMonth() + 1}`.padStart(2, "0")}${`${value.getDate()}`.padStart(2, "0")}`;
  }

  private patchStatus(patch: Partial<RecorderStatusSnapshot>): void {
    this.status = {
      ...this.status,
      ...patch
    };
    this.onStatus(this.getStatus());
  }

  private logDiagnostics(reason: string, { force = false }: { force?: boolean } = {}): void {
    const now = Date.now();
    if (!force && now - this.lastDiagnosticLogAt < DIAGNOSTIC_LOG_INTERVAL_MS) {
      return;
    }
    this.lastDiagnosticLogAt = now;
    const memory = process.memoryUsage();
    log.info(
      [
        `[eve][engine] ${reason}`,
        `rss=${Math.round(memory.rss / 1024 / 1024)}MB`,
        `heapUsed=${Math.round(memory.heapUsed / 1024 / 1024)}MB`,
        `external=${Math.round(memory.external / 1024 / 1024)}MB`,
        `queue=${this.pendingAudioChunks.length}`,
        `skippedAsr=${this.skippedAsrChunks}`,
        `recording=${this.status.recording}`
      ].join(" ")
    );
  }
}
