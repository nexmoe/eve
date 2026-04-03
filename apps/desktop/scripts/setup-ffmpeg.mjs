import { execFile } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const APP_ROOT = resolve(import.meta.dirname, "..");
const OUTPUT_ROOT = join(APP_ROOT, "vendor/ffmpeg");
const LATEST_RELEASE_API_URL = "https://api.github.com/repos/Tyrrrz/FFmpegBin/releases/latest";
const RELEASE_TAG_REGEX = /\/download\/([^/]+)\//;
const INSTALL_INFO_FILE_NAME = "install-info.json";

const TARGET_CONFIG = {
  "darwin-arm64": { assetCandidates: ["ffmpeg-osx-arm64.zip"] },
  "darwin-x64": { assetCandidates: ["ffmpeg-osx-x64.zip"] },
  "linux-arm64": { assetCandidates: ["ffmpeg-linux-arm64.zip"] },
  "linux-x64": { assetCandidates: ["ffmpeg-linux-x64.zip"] },
  "win32-arm64": { assetCandidates: ["ffmpeg-windows-arm64.zip"] },
  "win32-x64": { assetCandidates: ["ffmpeg-windows-x64.zip"] }
};

const parseTargets = () => {
  const rawTargets = process.env.EVE_FFMPEG_TARGETS?.trim();
  if (!rawTargets) {
    return [`${process.platform}-${process.arch}`];
  }
  return rawTargets
    .split(",")
    .map((target) => target.trim())
    .filter((target) => target.length > 0);
};

const getLatestRelease = async () => {
  const response = await fetch(LATEST_RELEASE_API_URL, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "eve-ffmpeg-setup"
    }
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch latest ffmpeg release metadata: HTTP ${response.status}`);
  }
  return response.json();
};

const downloadAsset = async (downloadUrl, outputPath) => {
  const response = await fetch(downloadUrl, {
    headers: {
      "User-Agent": "eve-ffmpeg-setup"
    },
    redirect: "follow"
  });
  if (!response.ok) {
    throw new Error(`Failed to download ffmpeg asset: HTTP ${response.status}`);
  }
  const assetBuffer = Buffer.from(await response.arrayBuffer());
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, assetBuffer);
  return response.url;
};

const resolveAssetDownload = (release, assetCandidates) => {
  const releaseAssets = Array.isArray(release?.assets) ? release.assets : [];
  for (const assetName of assetCandidates) {
    const matchedAsset = releaseAssets.find((asset) => asset?.name === assetName);
    if (matchedAsset?.browser_download_url && matchedAsset.name) {
      return {
        assetName: matchedAsset.name,
        downloadUrl: matchedAsset.browser_download_url,
        tagName: typeof release?.tag_name === "string" ? release.tag_name : "latest"
      };
    }
  }
  for (const assetName of assetCandidates) {
    return {
      assetName,
      downloadUrl: `https://github.com/Tyrrrz/FFmpegBin/releases/latest/download/${assetName}`,
      tagName: "latest"
    };
  }
  throw new Error("No ffmpeg asset candidates provided.");
};

const extractArchive = async ({ archivePath, destinationPath }) => {
  if (process.platform === "win32") {
    await execFileAsync("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-Command",
      `Expand-Archive -LiteralPath '${archivePath.replaceAll("'", "''")}' -DestinationPath '${destinationPath.replaceAll("'", "''")}' -Force`
    ]);
    return;
  }
  if (process.platform === "darwin") {
    await execFileAsync("ditto", ["-x", "-k", archivePath, destinationPath]);
    return;
  }
  try {
    await execFileAsync("unzip", ["-o", archivePath, "-d", destinationPath]);
  } catch {
    await execFileAsync("python3", ["-m", "zipfile", "-e", archivePath, destinationPath]);
  }
};

async function findExtractedFile({ directoryPath, fileNames }) {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  for (const entry of entries) {
    const absoluteEntryPath = join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      const nestedMatch = await findExtractedFile({
        directoryPath: absoluteEntryPath,
        fileNames
      });
      if (nestedMatch) {
        return nestedMatch;
      }
      continue;
    }
    if (fileNames.includes(entry.name)) {
      return absoluteEntryPath;
    }
  }
  return null;
}

const resolveExecutableNames = (target) =>
  target.startsWith("win32")
    ? { ffmpeg: "ffmpeg.exe" }
    : { ffmpeg: "ffmpeg" };

const installTarget = async (release, target) => {
  const targetConfig = TARGET_CONFIG[target];
  if (!targetConfig) {
    console.warn(`[ffmpeg] skipped unsupported target "${target}"`);
    return;
  }
  const outputDirectoryPath = join(OUTPUT_ROOT, target);
  const executableNames = resolveExecutableNames(target);
  const outputFfmpegPath = join(outputDirectoryPath, executableNames.ffmpeg);
  const existingFfmpeg = await stat(outputFfmpegPath).then(
    () => true,
    () => false
  );
  if (process.env.EVE_FORCE_SETUP_FFMPEG !== "1" && existingFfmpeg) {
    console.log(`[ffmpeg] skipped ${target}, bundled binaries already exist`);
    return;
  }

  const assetDownload = resolveAssetDownload(release, targetConfig.assetCandidates);
  const temporaryDirectoryPath = await mkdtemp(join(tmpdir(), "eve-ffmpeg-"));
  const archivePath = join(temporaryDirectoryPath, assetDownload.assetName);
  try {
    const finalDownloadUrl = await downloadAsset(assetDownload.downloadUrl, archivePath);
    const extractedDirectoryPath = join(temporaryDirectoryPath, "extracted");
    await mkdir(extractedDirectoryPath, { recursive: true });
    await extractArchive({ archivePath, destinationPath: extractedDirectoryPath });

    const [resolvedFfmpegPath, resolvedLicensePath] = await Promise.all([
      findExtractedFile({
        directoryPath: extractedDirectoryPath,
        fileNames: [executableNames.ffmpeg]
      }),
      findExtractedFile({
        directoryPath: extractedDirectoryPath,
        fileNames: ["LICENSE", "LICENSE.txt", "license.txt"]
      })
    ]);
    if (!resolvedFfmpegPath) {
      throw new Error(`Downloaded archive for ${target} does not contain an ffmpeg binary.`);
    }

    await mkdir(outputDirectoryPath, { recursive: true });
    await cp(resolvedFfmpegPath, outputFfmpegPath, { force: true });
    if (resolvedLicensePath) {
      await cp(resolvedLicensePath, join(outputDirectoryPath, "LICENSE.txt"), { force: true });
    }
    if (process.platform !== "win32") {
      await chmod(outputFfmpegPath, 0o755);
    }

    const resolvedTagName = finalDownloadUrl.match(RELEASE_TAG_REGEX)?.[1] ?? assetDownload.tagName;
    await writeFile(
      join(outputDirectoryPath, INSTALL_INFO_FILE_NAME),
      `${JSON.stringify(
        {
          assetName: assetDownload.assetName,
          downloadedAt: new Date().toISOString(),
          ffmpegFileName: executableNames.ffmpeg,
          finalDownloadUrl,
          platform: target,
          tagName: resolvedTagName
        },
        null,
        2
      )}\n`
    );
    console.log(`[ffmpeg] installed ${target} -> ${outputDirectoryPath}`);
  } finally {
    await rm(temporaryDirectoryPath, { force: true, recursive: true });
  }
};

const main = async () => {
  let release = null;
  try {
    release = await getLatestRelease();
  } catch (error) {
    console.warn("[ffmpeg] latest release API unavailable, using latest/download");
    console.warn(error);
  }
  for (const target of parseTargets()) {
    await installTarget(release, target);
  }
};

main().catch((error) => {
  console.error("[ffmpeg] setup failed", error);
  process.exitCode = 1;
});
