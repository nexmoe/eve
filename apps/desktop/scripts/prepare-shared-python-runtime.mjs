import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
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

rmSync(generatedDirectory, { force: true, recursive: true });
mkdirSync(generatedDirectory, { recursive: true });

run("uv", ["venv", runtimeDirectory, "--python", "3.12"]);
run("uv", ["pip", "install", "--python", pythonExecutable, repositoryRoot]);

