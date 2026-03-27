import { createWriteStream, existsSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { app } from "electron";
import decompress from "decompress";
import decompressTarbz2 from "decompress-tarbz2";
import { execa } from "execa";
import { resolveBundledFfmpegPath } from "./ffmpeg-binary";

export interface EngineAssetStatus {
  downloadMessage: string;
  downloadProgress: number | null;
  downloading: boolean;
  ffmpegAvailable: boolean;
  senseVoiceReady: boolean;
  vadReady: boolean;
}

type StatusListener = (status: EngineAssetStatus) => void;

const ASR_MODEL = {
  directory: "sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25",
  url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25.tar.bz2"
} as const;

const VAD = {
  file: "silero_vad.onnx",
  url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx"
} as const;

const INITIAL_STATUS: EngineAssetStatus = {
  downloadMessage: "",
  downloadProgress: null,
  downloading: false,
  ffmpegAvailable: false,
  senseVoiceReady: false,
  vadReady: false
};

export class ModelManager {
  private readonly baseDirectory = join(app.getPath("userData"), "models");
  private readonly listeners = new Set<StatusListener>();
  private readonly status: EngineAssetStatus = { ...INITIAL_STATUS };
  private ffmpegChecked = false;
  private pendingEnsure: Promise<void> | null = null;

  constructor() {
    this.refreshInstalledState();
  }

  getStatus(): EngineAssetStatus {
    return { ...this.status };
  }

  getSenseVoiceDirectory(): string {
    return join(this.baseDirectory, ASR_MODEL.directory);
  }

  getSenseVoiceTokensPath(): string {
    return join(this.getSenseVoiceDirectory(), "tokens.txt");
  }

  getSenseVoiceModelPath(): string {
    return join(this.getSenseVoiceDirectory(), "model.int8.onnx");
  }

  getVadModelPath(): string {
    return join(this.baseDirectory, VAD.file);
  }

  onStatus(listener: StatusListener): () => void {
    this.listeners.add(listener);
    listener(this.getStatus());
    return () => {
      this.listeners.delete(listener);
    };
  }

  async ensureRuntimeAssets(): Promise<void> {
    if (this.pendingEnsure) {
      return this.pendingEnsure;
    }
    this.pendingEnsure = this.ensureRuntimeAssetsInternal().finally(() => {
      this.pendingEnsure = null;
      this.refreshInstalledState();
    });
    return this.pendingEnsure;
  }

  async requireFfmpeg(): Promise<void> {
    const available = await this.ensureFfmpegAvailable();
    if (!available) {
      throw new Error(
        "ffmpeg is required for FLAC output and non-WAV transcription. Run `bun run --cwd apps/desktop setup:ffmpeg` and restart eve."
      );
    }
  }

  private async ensureRuntimeAssetsInternal(): Promise<void> {
    await mkdir(this.baseDirectory, { recursive: true });
    await this.ensureFfmpegAvailable();
    if (!this.status.senseVoiceReady) {
      await this.downloadAndExtractSenseVoice();
    }
    if (!this.status.vadReady) {
      await this.downloadFile(VAD.url, this.getVadModelPath(), "Downloading VAD model");
    }
  }

  private refreshInstalledState(): void {
    this.patchStatus({
      senseVoiceReady: this.hasAsrModelFiles(),
      vadReady: existsSync(this.getVadModelPath())
    });
  }

  private async ensureFfmpegAvailable(): Promise<boolean> {
    if (this.ffmpegChecked) {
      return this.status.ffmpegAvailable;
    }
    this.ffmpegChecked = true;
    try {
      const ffmpegPath = await resolveBundledFfmpegPath();
      await execa(ffmpegPath ?? "ffmpeg", ["-version"]);
      this.patchStatus({ ffmpegAvailable: true });
      return true;
    } catch {
      this.patchStatus({ ffmpegAvailable: false });
      return false;
    }
  }

  private async downloadAndExtractSenseVoice(): Promise<void> {
    const archivePath = join(tmpdir(), `${ASR_MODEL.directory}-${Date.now()}.tar.bz2`);
    const extractDirectory = join(tmpdir(), `${ASR_MODEL.directory}-${Date.now()}`);
    await this.downloadFile(ASR_MODEL.url, archivePath, "Downloading Qwen3 ASR model");
    this.patchStatus({
      downloadMessage: "Extracting Qwen3 ASR model…",
      downloadProgress: null,
      downloading: true
    });
    await mkdir(extractDirectory, { recursive: true });
    await decompress(archivePath, extractDirectory, {
      plugins: [decompressTarbz2()]
    });
    const extractedModelDirectory = join(extractDirectory, ASR_MODEL.directory);
    await rm(this.getSenseVoiceDirectory(), { force: true, recursive: true });
    await mkdir(this.baseDirectory, { recursive: true });
    await rename(extractedModelDirectory, this.getSenseVoiceDirectory());
    await rm(archivePath, { force: true });
    await rm(extractDirectory, { force: true, recursive: true });
    this.patchStatus({
      downloadMessage: "",
      downloadProgress: null,
      downloading: false,
      senseVoiceReady: true
    });
  }

  private hasAsrModelFiles(): boolean {
    const directory = this.getSenseVoiceDirectory();
    const tokensPath = join(directory, "tokens.txt");
    const senseVoiceModel = join(directory, "model.int8.onnx");
    const qwen3Files = [
      join(directory, "conv_frontend.onnx"),
      join(directory, "encoder.int8.onnx"),
      join(directory, "decoder.int8.onnx"),
      join(directory, "tokenizer", "vocab.json"),
      join(directory, "tokenizer", "merges.txt"),
      join(directory, "tokenizer", "tokenizer_config.json")
    ];
    const transducerFiles = [
      join(directory, "encoder.int8.onnx"),
      join(directory, "decoder.int8.onnx"),
      join(directory, "joiner.int8.onnx")
    ];
    const fireRedFiles = [join(directory, "encoder.int8.onnx"), join(directory, "decoder.int8.onnx")];
    return (
      (existsSync(tokensPath) && existsSync(senseVoiceModel)) ||
      qwen3Files.every((file) => existsSync(file)) ||
      (existsSync(tokensPath) && transducerFiles.every((file) => existsSync(file))) ||
      fireRedFiles.every((file) => existsSync(file))
    );
  }

  private async downloadFile(url: string, outputPath: string, label: string): Promise<void> {
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok || !response.body) {
      throw new Error(`Failed to download ${label.toLowerCase()}: ${response.statusText}`);
    }
    this.patchStatus({
      downloadMessage: `${label}…`,
      downloadProgress: 0,
      downloading: true
    });
    const total = Number(response.headers.get("content-length") ?? 0);
    const reader = response.body.getReader();
    const stream = createWriteStream(outputPath);
    let downloaded = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        stream.write(Buffer.from(value));
        downloaded += value.length;
        this.patchStatus({
          downloadProgress: total > 0 ? Math.round((downloaded / total) * 100) : null
        });
      }
    } finally {
      await new Promise<void>((resolve, reject) => {
        stream.end((error?: Error | null) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
    this.patchStatus({
      downloadMessage: "",
      downloadProgress: null,
      downloading: false
    });
  }

  private patchStatus(patch: Partial<EngineAssetStatus>): void {
    Object.assign(this.status, patch);
    for (const listener of this.listeners) {
      listener(this.getStatus());
    }
  }
}
