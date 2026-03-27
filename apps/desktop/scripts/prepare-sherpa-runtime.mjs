import { cpSync, existsSync, mkdirSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopDirectory = resolve(__dirname, "..");
const outputDirectory = resolve(desktopDirectory, ".generated", "sherpa-runtime");
const workspaceNodeModulesDirectories = (() => {
  const directories = [];
  let currentDirectory = desktopDirectory;

  while (true) {
    directories.push(join(currentDirectory, "node_modules"));
    const parentDirectory = dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      return directories;
    }
    currentDirectory = parentDirectory;
  }
})();

const platformPackageName = (() => {
  if (process.platform === "darwin" && process.arch === "arm64") {
    return "sherpa-onnx-darwin-arm64";
  }
  if (process.platform === "darwin" && process.arch === "x64") {
    return "sherpa-onnx-darwin-x64";
  }
  if (process.platform === "linux" && process.arch === "arm64") {
    return "sherpa-onnx-linux-arm64";
  }
  if (process.platform === "linux" && process.arch === "x64") {
    return "sherpa-onnx-linux-x64";
  }
  if (process.platform === "win32" && process.arch === "ia32") {
    return "sherpa-onnx-win-ia32";
  }
  if (process.platform === "win32" && process.arch === "x64") {
    return "sherpa-onnx-win-x64";
  }
  throw new Error(`Unsupported sherpa platform: ${process.platform} ${process.arch}`);
})();

const resolveBunPackageDirectory = (packageName) => {
  for (const nodeModulesDirectory of workspaceNodeModulesDirectories) {
    const packageLinkPath = join(nodeModulesDirectory, packageName);
    if (existsSync(packageLinkPath)) {
      const packageDirectory = realpathSync(packageLinkPath);
      if (!existsSync(packageDirectory)) {
        throw new Error(`Resolved package directory is missing: ${packageDirectory}`);
      }
      return packageDirectory;
    }

    const bunStorePath = join(nodeModulesDirectory, ".bun");
    if (!existsSync(bunStorePath)) {
      continue;
    }

    for (const entry of readdirSync(bunStorePath)) {
      if (!entry.startsWith(`${packageName}@`)) {
        continue;
      }

      const candidate = join(bunStorePath, entry, "node_modules", packageName);
      if (existsSync(candidate)) {
        return realpathSync(candidate);
      }
    }
  }

  throw new Error(
    `Unable to locate ${packageName} in workspace node_modules: ${workspaceNodeModulesDirectories.join(", ")}.`
  );
};

rmSync(outputDirectory, { force: true, recursive: true });
mkdirSync(outputDirectory, { recursive: true });

for (const packageName of ["sherpa-onnx-node", platformPackageName]) {
  cpSync(resolveBunPackageDirectory(packageName), join(outputDirectory, packageName), {
    dereference: true,
    force: false,
    recursive: true
  });
}
