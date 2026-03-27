import { existsSync } from "node:fs";
import { open, rename, rm, writeFile } from "node:fs/promises";
import { extname, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { execa } from "execa";
import { createRequire } from "node:module";
import { resolveBundledFfmpegPath } from "./ffmpeg-binary";

const resolveSherpaModulePath = () => {
  const candidateEntries = [
    join(
      process.resourcesPath,
      "vendor",
      "sherpa-runtime",
      "sherpa-onnx-node",
      "package.json"
    ),
    join(process.cwd(), ".generated", "sherpa-runtime", "sherpa-onnx-node", "package.json"),
    join(import.meta.dirname, "../../.generated", "sherpa-runtime", "sherpa-onnx-node", "package.json")
  ];
  for (const entry of candidateEntries) {
    if (existsSync(entry)) {
      return join(dirname(entry), "sherpa-onnx.js");
    }
  }
  return "sherpa-onnx-node";
};

type RecognitionResult = {
  emotion: string;
  event: string;
  lang: string;
  text: string;
  timestamps: number[];
  tokens: string[];
};

type OfflineRecognizer = {
  createStream(): {
    acceptWaveform(wave: { sampleRate: number; samples: Float32Array }): void;
  };
  decode(stream: unknown): void;
  getResult(stream: unknown): RecognitionResult;
};

type VadSegment = {
  samples: Float32Array;
  start: number;
};

type VadRecognizer = {
  config: { sileroVad: { windowSize: number }; sampleRate: number };
  acceptWaveform(samples: Float32Array): void;
  flush(): void;
  front(enableExternalBuffer?: boolean): VadSegment;
  isDetected(): boolean;
  isEmpty(): boolean;
  pop(): void;
};

type SherpaOnnx = {
  OfflineRecognizer: new (config: Record<string, unknown>) => OfflineRecognizer;
  Vad: new (config: Record<string, unknown>, bufferSizeInSeconds: number) => VadRecognizer;
  readWave(filename: string): { sampleRate: number; samples: Float32Array };
};

let sherpaOnnxCache: SherpaOnnx | null = null;

const sherpaOnnx = (): SherpaOnnx => {
  sherpaOnnxCache ??= createRequire(import.meta.url)(resolveSherpaModulePath()) as SherpaOnnx;
  return sherpaOnnxCache;
};

export const TARGET_SAMPLE_RATE = 16_000;
export const VAD_WINDOW_SIZE = 512;

const firstExisting = (paths: string[]) => paths.find((path) => existsSync(path)) ?? null;
const resolveFfmpegCommand = async (): Promise<string> => {
  return (await resolveBundledFfmpegPath()) ?? "ffmpeg";
};

export const createSenseVoiceRecognizer = (modelDirectory: string, language?: string) => {
  const onnx = sherpaOnnx();
  const tokensPath = join(modelDirectory, "tokens.txt");
  const tokenizerDirectory = join(modelDirectory, "tokenizer");
  const senseVoiceModel = firstExisting([
    join(modelDirectory, "model.int8.onnx"),
    join(modelDirectory, "model.onnx")
  ]);
  const convFrontend = firstExisting([
    join(modelDirectory, "conv_frontend.onnx"),
    join(modelDirectory, "conv-frontend.onnx")
  ]);
  const encoder = firstExisting([
    join(modelDirectory, "encoder.int8.onnx"),
    join(modelDirectory, "encoder.onnx")
  ]);
  const decoder = firstExisting([
    join(modelDirectory, "decoder.int8.onnx"),
    join(modelDirectory, "decoder.onnx")
  ]);
  const joiner = firstExisting([
    join(modelDirectory, "joiner.int8.onnx"),
    join(modelDirectory, "joiner.onnx")
  ]);

  if (senseVoiceModel && existsSync(tokensPath)) {
    return new onnx.OfflineRecognizer({
      featConfig: { featureDim: 80, sampleRate: TARGET_SAMPLE_RATE },
      modelConfig: {
        debug: 0,
        numThreads: 2,
        provider: "cpu",
        senseVoice: {
          language: language && language !== "auto" ? language : undefined,
          model: senseVoiceModel,
          useInverseTextNormalization: 1
        },
        tokens: tokensPath
      }
    });
  }
  if (convFrontend && encoder && decoder && existsSync(tokenizerDirectory)) {
    return new onnx.OfflineRecognizer({
      featConfig: { featureDim: 128, sampleRate: TARGET_SAMPLE_RATE },
      modelConfig: {
        debug: 0,
        numThreads: 2,
        provider: "cpu",
        qwen3Asr: {
          convFrontend,
          decoder,
          encoder,
          tokenizer: tokenizerDirectory
        },
        tokens: ""
      }
    });
  }
  if (encoder && decoder && joiner && existsSync(tokensPath)) {
    return new onnx.OfflineRecognizer({
      featConfig: { featureDim: 80, sampleRate: TARGET_SAMPLE_RATE },
      modelConfig: {
        debug: 0,
        numThreads: 2,
        provider: "cpu",
        tokens: tokensPath,
        transducer: { decoder, encoder, joiner }
      }
    });
  }
  if (encoder && decoder) {
    return new onnx.OfflineRecognizer({
      featConfig: { featureDim: 80, sampleRate: TARGET_SAMPLE_RATE },
      modelConfig: {
        debug: 0,
        fireRedAsr: { decoder, encoder },
        numThreads: 2,
        provider: "cpu"
      }
    });
  }

  throw new Error(`Unsupported ASR model layout in ${modelDirectory}`);
};

export const createSherpaVad = (modelPath: string) => {
  const onnx = sherpaOnnx();
  return new onnx.Vad(
    {
      debug: 0,
      numThreads: 1,
      sampleRate: TARGET_SAMPLE_RATE,
      sileroVad: {
        maxSpeechDuration: 15,
        minSilenceDuration: 0.5,
        minSpeechDuration: 0.25,
        model: modelPath,
        threshold: 0.5,
        windowSize: VAD_WINDOW_SIZE
      }
    },
    60
  );
};

export const decodeSegment = (recognizer: OfflineRecognizer, samples: Float32Array) => {
  const stream = recognizer.createStream();
  stream.acceptWaveform({ sampleRate: TARGET_SAMPLE_RATE, samples });
  recognizer.decode(stream);
  return recognizer.getResult(stream);
};

export const downsampleTo16k = (input: Float32Array, inputRate: number): Float32Array => {
  if (inputRate === TARGET_SAMPLE_RATE) {
    return input;
  }
  const sampleCount = Math.max(1, Math.round((input.length * TARGET_SAMPLE_RATE) / inputRate));
  const output = new Float32Array(sampleCount);
  const ratio = inputRate / TARGET_SAMPLE_RATE;
  for (let index = 0; index < sampleCount; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(input.length, Math.floor((index + 1) * ratio));
    if (end <= start) {
      output[index] = input[start] ?? 0;
      continue;
    }
    let total = 0;
    for (let cursor = start; cursor < end; cursor += 1) {
      total += input[cursor] ?? 0;
    }
    output[index] = total / (end - start);
  }
  return output;
};

export const buildWaveformBins = (samples: Float32Array, size = 48): number[] => {
  const bins = new Array<number>(size).fill(0);
  if (samples.length === 0) {
    return bins;
  }
  const bucketSize = Math.max(1, Math.floor(samples.length / size));
  for (let index = 0; index < size; index += 1) {
    const start = index * bucketSize;
    const end = Math.min(samples.length, start + bucketSize);
    let peak = 0;
    for (let cursor = start; cursor < end; cursor += 1) {
      peak = Math.max(peak, Math.abs(samples[cursor] ?? 0));
    }
    bins[index] = peak;
  }
  return bins;
};

export const rms = (samples: Float32Array): number => {
  if (samples.length === 0) {
    return 0;
  }
  let total = 0;
  for (const sample of samples) {
    total += sample * sample;
  }
  return Math.sqrt(total / samples.length);
};

export const rmsToDb = (value: number): number => {
  if (value <= 0) {
    return -80;
  }
  return Math.max(-80, 20 * Math.log10(value));
};

const createWaveHeader = (dataBytes: number) => {
  const buffer = Buffer.alloc(44);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(TARGET_SAMPLE_RATE, 24);
  buffer.writeUInt32LE(TARGET_SAMPLE_RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataBytes, 40);
  return buffer;
};

const floatTo16BitBuffer = (samples: Float32Array) => {
  const buffer = Buffer.alloc(samples.length * 2);
  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index] ?? 0));
    buffer.writeInt16LE(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, index * 2);
  }
  return buffer;
};

export class WavWriter {
  private readonly path: string;
  private bytesWritten = 0;
  private handlePromise: ReturnType<typeof open>;

  constructor(path: string) {
    this.path = path;
    this.handlePromise = open(path, "w");
  }

  async append(samples: Float32Array): Promise<void> {
    const handle = await this.handlePromise;
    if (this.bytesWritten === 0) {
      await handle.write(createWaveHeader(0), 0, 44, 0);
    }
    const buffer = floatTo16BitBuffer(samples);
    await handle.write(buffer, 0, buffer.length, 44 + this.bytesWritten);
    this.bytesWritten += buffer.length;
  }

  async close(): Promise<void> {
    const handle = await this.handlePromise;
    await handle.write(createWaveHeader(this.bytesWritten), 0, 44, 0);
    await handle.close();
  }

  getPath(): string {
    return this.path;
  }
}

export const transcodeWavToFlac = async (inputPath: string, outputPath: string) => {
  await execa(await resolveFfmpegCommand(), [
    "-y",
    "-i",
    inputPath,
    "-ar",
    String(TARGET_SAMPLE_RATE),
    "-ac",
    "1",
    outputPath
  ]);
};

export const ensureWavInput = async (inputPath: string) => {
  const extension = extname(inputPath).toLowerCase();
  if (extension === ".wav") {
    return { cleanupPath: null, wavPath: inputPath };
  }
  const outputPath = `${tmpdir()}/eve-${Date.now()}.wav`;
  await execa(await resolveFfmpegCommand(), [
    "-y",
    "-i",
    inputPath,
    "-ar",
    String(TARGET_SAMPLE_RATE),
    "-ac",
    "1",
    "-f",
    "wav",
    "-acodec",
    "pcm_s16le",
    outputPath
  ]);
  return { cleanupPath: outputPath, wavPath: outputPath };
};

export const transcribeAudioFile = async (
  recognizer: OfflineRecognizer,
  inputPath: string
) => {
  const { cleanupPath, wavPath } = await ensureWavInput(inputPath);
  try {
    const wave = sherpaOnnx().readWave(wavPath);
    return decodeSegment(recognizer, wave.samples);
  } finally {
    if (cleanupPath) {
      await rm(cleanupPath, { force: true });
    }
  }
};

export const writeJsonAtomic = async (path: string, value: unknown) => {
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rm(path, { force: true });
  await rename(temporaryPath, path);
};
