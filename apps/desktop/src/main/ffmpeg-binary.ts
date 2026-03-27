import { access } from "node:fs/promises";
import { resolve, join } from "node:path";
import { app } from "electron";

const FFMPEG_VENDOR_DIRECTORY = "ffmpeg";
const FFMPEG_PATH_ENV_NAMES = ["EVE_FFMPEG_PATH", "FFMPEG_PATH", "FFMPEG"] as const;

let cachedFfmpegPath: string | null | undefined;

const getExecutableFileName = () => (process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");

const getOverridePath = (): string | null => {
  for (const envName of FFMPEG_PATH_ENV_NAMES) {
    const value = process.env[envName]?.trim();
    if (value) {
      return resolve(value);
    }
  }
  return null;
};

const getBaseDirectoryCandidates = (): string[] => {
  return [
    resolve(process.resourcesPath, "vendor", FFMPEG_VENDOR_DIRECTORY),
    resolve(app.getAppPath(), "vendor", FFMPEG_VENDOR_DIRECTORY),
    resolve(app.getAppPath(), "..", "vendor", FFMPEG_VENDOR_DIRECTORY),
    resolve(import.meta.dirname, "../../vendor", FFMPEG_VENDOR_DIRECTORY),
    resolve(import.meta.dirname, "../../../vendor", FFMPEG_VENDOR_DIRECTORY),
    resolve(process.cwd(), "apps/desktop/vendor", FFMPEG_VENDOR_DIRECTORY),
    resolve(process.cwd(), "vendor", FFMPEG_VENDOR_DIRECTORY)
  ];
};

const getTargetDirectoryCandidates = (): string[] => {
  const candidates = [`${process.platform}-${process.arch}`];
  if (process.platform === "darwin" && process.arch === "arm64") {
    candidates.push("darwin-x64");
  }
  if (process.platform === "win32" && process.arch === "arm64") {
    candidates.push("win32-x64");
  }
  candidates.push(process.platform);
  return Array.from(new Set(candidates));
};

const getBinaryCandidates = (): string[] => {
  const candidateSet = new Set<string>();
  const overridePath = getOverridePath();
  const executableFileName = getExecutableFileName();
  if (overridePath) {
    candidateSet.add(overridePath);
  }
  for (const baseDirectory of getBaseDirectoryCandidates()) {
    for (const targetDirectory of getTargetDirectoryCandidates()) {
      candidateSet.add(join(baseDirectory, targetDirectory, executableFileName));
    }
    candidateSet.add(join(baseDirectory, executableFileName));
  }
  return Array.from(candidateSet);
};

export const resolveBundledFfmpegPath = async (): Promise<string | null> => {
  if (cachedFfmpegPath !== undefined) {
    return cachedFfmpegPath;
  }
  for (const candidatePath of getBinaryCandidates()) {
    try {
      await access(candidatePath);
      cachedFfmpegPath = candidatePath;
      return candidatePath;
    } catch {
      continue;
    }
  }
  cachedFfmpegPath = null;
  return null;
};
