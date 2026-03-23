import { access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { app } from "electron";

const pathExists = async (value: string): Promise<boolean> => {
  try {
    await access(value);
    return true;
  } catch {
    return false;
  }
};

const projectCandidates = (): string[] => {
  return [
    resolve(import.meta.dirname, "../../../.."),
    resolve(import.meta.dirname, "../../.."),
    resolve(process.cwd(), "apps/desktop"),
    resolve(process.cwd())
  ];
};

export const resolveSidecarScriptPath = async (): Promise<string> => {
  const candidates = [
    resolve(process.resourcesPath, "vendor", "eve-sidecar", "sidecar_main.py"),
    resolve(app.getAppPath(), "vendor", "eve-sidecar", "sidecar_main.py"),
    ...projectCandidates().map((base) => resolve(base, "vendor", "eve-sidecar", "sidecar_main.py"))
  ];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  throw new Error("Python sidecar script is unavailable.");
};

export const resolvePythonExecutable = async (): Promise<string> => {
  const workspaceCandidates = projectCandidates();
  const candidates = [
    resolve(process.resourcesPath, "vendor", "shared-python-runtime", "runtime", "Scripts", "python.exe"),
    resolve(process.resourcesPath, "vendor", "shared-python-runtime", "runtime", "bin", "python"),
    ...workspaceCandidates.flatMap((base) => {
      return [
        join(base, ".generated", "shared-python-runtime", "runtime", "Scripts", "python.exe"),
        join(base, ".generated", "shared-python-runtime", "runtime", "bin", "python"),
        join(base, ".venv", "Scripts", "python.exe"),
        join(base, ".venv", "bin", "python")
      ];
    }),
    resolve(process.cwd(), ".venv", "Scripts", "python.exe"),
    resolve(process.cwd(), ".venv", "bin", "python"),
    "python3",
    "python"
  ];
  for (const candidate of candidates) {
    if (candidate === "python3" || candidate === "python") {
      return candidate;
    }
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  throw new Error("Python runtime is unavailable.");
};
