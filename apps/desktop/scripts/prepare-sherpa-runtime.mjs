import { cpSync, existsSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopDirectory = resolve(__dirname, "..");
const outputDirectory = resolve(desktopDirectory, ".generated", "sherpa-runtime");
const nodeModulesDirectory = resolve(desktopDirectory, "node_modules");

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
  const packageLinkPath = join(nodeModulesDirectory, packageName);
  if (!existsSync(packageLinkPath)) {
    throw new Error(`Unable to locate ${packageName} in ${nodeModulesDirectory}.`);
  }
  const packageDirectory = realpathSync(packageLinkPath);
  if (!existsSync(packageDirectory)) {
    throw new Error(`Resolved package directory is missing: ${packageDirectory}`);
  }
  return packageDirectory;
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
