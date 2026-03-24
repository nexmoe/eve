import { execFileSync } from "node:child_process";
import {
  cpSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  rmSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopDirectory = resolve(__dirname, "..");
const repositoryRoot = resolve(desktopDirectory, "../..");
const generatedDirectory = resolve(
  desktopDirectory,
  ".generated",
  "shared-python-runtime"
);
const runtimeDirectory = join(generatedDirectory, "runtime");

const pythonExecutable = process.platform === "win32"
  ? join(runtimeDirectory, "Scripts", "python.exe")
  : join(runtimeDirectory, "bin", "python");

const transientDirectoryNames = new Set([
  "__pycache__",
  "docs",
  "test",
  "tests"
]);
const transientFileExtensions = new Set([".map", ".pyc", ".pyo"]);
const removableDistInfoEntries = new Set([
  "AUTHORS",
  "COPYING",
  "INSTALLER",
  "LICENSE",
  "LICENCE",
  "NOTICE",
  "RECORD",
  "REQUESTED",
  "WHEEL",
  "zip-safe"
]);
const removableRuntimeEntryPrefixes = [
  "fastapi",
  "flask",
  "gradio",
  "gradio_client",
  "pip",
  "setuptools",
  "uvicorn",
  "werkzeug"
];
const removableRuntimeRelativePaths = ["qwen_asr/cli"];
const removableBinEntries = process.platform === "win32"
  ? new Set(["activate.bat", "deactivate.bat", "pydoc.bat"])
  : new Set([
      "accelerate",
      "accelerate-config",
      "accelerate-estimate-memory",
      "accelerate-launch",
      "accelerate-merge-weights",
      "activate",
      "activate.csh",
      "activate.fish",
      "activate.nu",
      "activate.ps1",
      "activate_this.py",
      "cygdb",
      "cython",
      "cythonize",
      "f2py",
      "fastapi",
      "flask",
      "gradio",
      "hf",
      "httpx",
      "huggingface-cli",
      "isympy",
      "markdown-it",
      "normalizer",
      "numba",
      "numpy-config",
      "pyav",
      "pygmentize",
      "python3-config",
      "qwen-asr-demo",
      "qwen-asr-demo-streaming",
      "qwen-asr-serve",
      "tiny-agents",
      "torchfrtrace",
      "torchrun",
      "tqdm",
      "transformers",
      "transformers-cli",
      "typer",
      "upload_theme",
      "uvicorn"
    ]);

const run = (command, args, cwd = desktopDirectory) => {
  execFileSync(command, args, {
    cwd,
    env: {
      ...process.env,
      UV_LINK_MODE: "copy"
    },
    stdio: "inherit"
  });
};

const normalizeBundledSymlinks = (directoryPath) => {
  const pendingPaths = [directoryPath];
  while (pendingPaths.length > 0) {
    const currentPath = pendingPaths.shift();
    if (!currentPath) {
      continue;
    }
    const currentStats = lstatSync(currentPath);
    if (currentStats.isSymbolicLink()) {
      const linkTargetPath = readlinkSync(currentPath);
      const resolvedTargetPath = resolve(dirname(currentPath), linkTargetPath);
      const targetStats = lstatSync(resolvedTargetPath);
      rmSync(currentPath, { force: true, recursive: true });
      cpSync(resolvedTargetPath, currentPath, {
        dereference: true,
        force: false,
        recursive: targetStats.isDirectory()
      });
      if (targetStats.isDirectory()) {
        pendingPaths.push(currentPath);
      }
      continue;
    }
    if (!currentStats.isDirectory()) {
      continue;
    }
    for (const entry of readdirSync(currentPath, { withFileTypes: true })) {
      pendingPaths.push(join(currentPath, entry.name));
    }
  }
};

const collectSitePackagesDirectories = (directoryPath) => {
  const pendingPaths = [directoryPath];
  const sitePackagesDirectories = [];
  while (pendingPaths.length > 0) {
    const currentPath = pendingPaths.shift();
    if (!currentPath) {
      continue;
    }
    const currentStats = lstatSync(currentPath);
    if (!currentStats.isDirectory()) {
      continue;
    }
    if (currentPath.endsWith("site-packages")) {
      sitePackagesDirectories.push(currentPath);
      continue;
    }
    for (const entry of readdirSync(currentPath, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        pendingPaths.push(join(currentPath, entry.name));
      }
    }
  }
  return sitePackagesDirectories;
};

const removeExcludedRuntimeEntries = (directoryPath) => {
  for (const sitePackagesDirectory of collectSitePackagesDirectories(directoryPath)) {
    for (const entry of readdirSync(sitePackagesDirectory, { withFileTypes: true })) {
      const shouldRemove = removableRuntimeEntryPrefixes.some((prefix) => {
        return entry.name === prefix || entry.name.startsWith(`${prefix}-`);
      });
      if (shouldRemove) {
        rmSync(join(sitePackagesDirectory, entry.name), {
          force: true,
          recursive: true
        });
      }
    }
    for (const relativePath of removableRuntimeRelativePaths) {
      rmSync(join(sitePackagesDirectory, relativePath), {
        force: true,
        recursive: true
      });
    }
  }
};

const pruneRuntimeEntries = (directoryPath) => {
  const pendingPaths = [directoryPath];
  while (pendingPaths.length > 0) {
    const currentPath = pendingPaths.shift();
    if (!currentPath) {
      continue;
    }
    const currentStats = lstatSync(currentPath);
    if (!currentStats.isDirectory()) {
      continue;
    }
    for (const entry of readdirSync(currentPath, { withFileTypes: true })) {
      const entryPath = join(currentPath, entry.name);
      if (entry.isDirectory()) {
        if (transientDirectoryNames.has(entry.name)) {
          rmSync(entryPath, { force: true, recursive: true });
          continue;
        }
        if (
          entry.name.endsWith(".dist-info") &&
          readdirSync(entryPath).every((childName) => removableDistInfoEntries.has(childName) || childName === "licenses")
        ) {
          rmSync(entryPath, { force: true, recursive: true });
          continue;
        }
        pendingPaths.push(entryPath);
        continue;
      }
      const extension = entry.name.includes(".")
        ? entry.name.slice(entry.name.lastIndexOf("."))
        : "";
      if (transientFileExtensions.has(extension)) {
        rmSync(entryPath, { force: true });
        continue;
      }
      if (dirname(entryPath).endsWith(".dist-info")) {
        if (removableDistInfoEntries.has(entry.name)) {
          rmSync(entryPath, { force: true });
          continue;
        }
        if (entry.name === "METADATA") {
          continue;
        }
      }
      if (
        currentPath === join(runtimeDirectory, process.platform === "win32" ? "Scripts" : "bin") &&
        removableBinEntries.has(entry.name)
      ) {
        rmSync(entryPath, { force: true });
      }
    }
  }
};

rmSync(generatedDirectory, { force: true, recursive: true });
mkdirSync(generatedDirectory, { recursive: true });

run("uv", ["venv", runtimeDirectory, "--python", "3.12"]);
run("uv", ["pip", "install", "--python", pythonExecutable, repositoryRoot]);
normalizeBundledSymlinks(generatedDirectory);
removeExcludedRuntimeEntries(generatedDirectory);
pruneRuntimeEntries(generatedDirectory);
