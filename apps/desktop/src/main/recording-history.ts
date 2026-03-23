import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import type { RecordingHistoryItem } from "@eve/shared";

interface RecordingMetadata {
  audio_path?: unknown;
  created_at?: unknown;
  input_device?: unknown;
  segment_start_time?: unknown;
  status?: unknown;
  text?: unknown;
}

const AUDIO_EXTENSIONS = new Set([".flac", ".wav"]);

interface RecordingCandidate {
  audioPath: string;
  folderPath: string;
  id: string;
  inputDevice: string | null;
  startedAt: string;
  status: string;
  textPreview: string;
}

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const toText = (value: unknown): string => {
  return typeof value === "string" ? value : "";
};

const listFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        return listFiles(fullPath);
      }
      if (entry.isFile()) {
        return [fullPath];
      }
      return [];
    })
  );
  return nested.flat();
};

const inferStartedAtFromName = (filePath: string): string => {
  const match = basename(filePath).match(/(\d{8})_(\d{6})/);
  if (!match) {
    return "";
  }
  const [, date, time] = match;
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}`;
};

const inferStartedAtFromStat = async (filePath: string): Promise<string> => {
  try {
    const fileStat = await stat(filePath);
    return fileStat.birthtime.toISOString();
  } catch {
    return "";
  }
};

const createCandidateFromAudio = async (audioPath: string): Promise<RecordingCandidate> => {
  return {
    audioPath,
    folderPath: dirname(audioPath),
    id: audioPath,
    inputDevice: null,
    startedAt: inferStartedAtFromName(audioPath) || (await inferStartedAtFromStat(audioPath)),
    status: "audio_only",
    textPreview: ""
  };
};

const mergeMetadata = (
  candidate: RecordingCandidate,
  payload: RecordingMetadata
): RecordingCandidate => {
  const audioPath = toText(payload.audio_path) || candidate.audioPath;
  return {
    audioPath,
    folderPath: dirname(audioPath),
    id: audioPath,
    inputDevice: toText(payload.input_device) || candidate.inputDevice,
    startedAt:
      toText(payload.segment_start_time) ||
      toText(payload.created_at) ||
      candidate.startedAt,
    status: toText(payload.status) || candidate.status,
    textPreview: toText(payload.text).trim() || candidate.textPreview
  };
};

const candidateKeyForPath = (filePath: string): string => {
  return filePath.slice(0, Math.max(0, filePath.length - extname(filePath).length));
};

const listHistoryDirectories = (directories: string[]): string[] => {
  return [...new Set(directories.map((directory) => resolve(directory)).filter(Boolean))];
};

export const listRecentRecordings = async (directories: string[]): Promise<RecordingHistoryItem[]> => {
  const roots = listHistoryDirectories(directories);
  const candidates = new Map<string, RecordingCandidate>();

  for (const root of roots) {
    try {
      const files = await listFiles(root);
      for (const filePath of files) {
        const extension = extname(filePath).toLowerCase();
        if (AUDIO_EXTENSIONS.has(extension)) {
          const key = candidateKeyForPath(filePath);
          candidates.set(key, await createCandidateFromAudio(filePath));
          continue;
        }
        if (extension !== ".json") {
          continue;
        }
        try {
          const raw = JSON.parse(await readFile(filePath, "utf-8")) as unknown;
          if (!isObject(raw)) {
            continue;
          }
          const payload = raw as RecordingMetadata;
          const metadataAudioPath = toText(payload.audio_path);
          const key = metadataAudioPath ? candidateKeyForPath(metadataAudioPath) : candidateKeyForPath(filePath);
          const existing =
            candidates.get(key) ??
            (metadataAudioPath
              ? await createCandidateFromAudio(metadataAudioPath)
              : null);
          if (!existing) {
            continue;
          }
          candidates.set(key, mergeMetadata(existing, payload));
        } catch {
          continue;
        }
      }
    } catch {
      continue;
    }
  }

  return [...candidates.values()]
    .filter((item) => Boolean(item.audioPath) && Boolean(item.startedAt))
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
};
