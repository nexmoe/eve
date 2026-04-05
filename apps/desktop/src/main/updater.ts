import { app } from "electron";
import log from "electron-log/main";
import { autoUpdater } from "electron-updater";
import type { AutoUpdateSnapshot } from "@eve/shared";
import { initializeMainLogger } from "./logging";

const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

let updateCheckTimer: NodeJS.Timeout | null = null;
let onStateChange: ((snapshot: AutoUpdateSnapshot) => void) | null = null;
let shouldDeferInstall: (() => boolean) | null = null;
let updaterState: AutoUpdateSnapshot = {
  currentVersion: app.getVersion(),
  downloadedVersion: null,
  downloadedVersionReady: false,
  errorMessage: null,
  installDeferredUntilIdle: false,
  latestVersion: null,
  phase: "idle",
  statusMessage: "Automatic updates are ready."
};
let installingUpdate = false;

const shouldEnableAutoUpdate = (): boolean => app.isPackaged;

const publishState = (patch: Partial<AutoUpdateSnapshot>): void => {
  updaterState = {
    ...updaterState,
    ...patch,
    currentVersion: app.getVersion()
  };
  onStateChange?.(updaterState);
};

const installDownloadedUpdate = (): void => {
  if (!updaterState.downloadedVersionReady || installingUpdate) {
    return;
  }
  installingUpdate = true;
  publishState({
    phase: "downloaded",
    statusMessage: `Update ${updaterState.downloadedVersion ?? ""} is installing now.`
  });
  setTimeout(() => {
    autoUpdater.quitAndInstall(false, true);
  }, 1_000);
};

const runUpdateCheck = async (): Promise<void> => {
  if (!shouldEnableAutoUpdate()) {
    return;
  }
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Update check failed.";
    publishState({
      errorMessage: message,
      installDeferredUntilIdle: false,
      phase: "error",
      statusMessage: message
    });
    log.error("[eve-updater] update check failed", error);
  }
};

export const getAutoUpdateSnapshot = (): AutoUpdateSnapshot => updaterState;

export const isAutoUpdateInstalling = (): boolean => installingUpdate;

export const checkForUpdates = (): void => {
  void runUpdateCheck();
};

export const quitAndInstallUpdate = (): void => {
  installDownloadedUpdate();
};

export const installDownloadedUpdateIfReady = (): void => {
  if (!updaterState.downloadedVersionReady || shouldDeferInstall?.()) {
    return;
  }
  installDownloadedUpdate();
};

export const initializeAutoUpdates = ({
  deferInstallWhen,
  onSnapshot
}: {
  deferInstallWhen: () => boolean;
  onSnapshot: (snapshot: AutoUpdateSnapshot) => void;
}): void => {
  onStateChange = onSnapshot;
  shouldDeferInstall = deferInstallWhen;
  if (!shouldEnableAutoUpdate()) {
    publishState({
      errorMessage: null,
      installDeferredUntilIdle: false,
      phase: "unavailable",
      statusMessage: "Automatic updates are available in packaged builds."
    });
    log.info("[eve-updater] skipped update initialization in development");
    return;
  }
  initializeMainLogger();
  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.autoRunAppAfterInstall = true;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on("checking-for-update", () => {
    publishState({
      errorMessage: null,
      installDeferredUntilIdle: false,
      phase: "checking",
      statusMessage: "Checking for updates…"
    });
    log.info("[eve-updater] checking for updates");
  });
  autoUpdater.on("update-available", (info) => {
    publishState({
      downloadedVersion: null,
      downloadedVersionReady: false,
      errorMessage: null,
      installDeferredUntilIdle: false,
      latestVersion: info.version,
      phase: "downloading",
      statusMessage: `Downloading update ${info.version}…`
    });
    log.info("[eve-updater] update available", info.version);
  });
  autoUpdater.on("update-not-available", () => {
    publishState({
      downloadedVersion: null,
      downloadedVersionReady: false,
      errorMessage: null,
      installDeferredUntilIdle: false,
      latestVersion: null,
      phase: "idle",
      statusMessage: "You are on the latest version."
    });
    log.info("[eve-updater] no update available");
  });
  autoUpdater.on("download-progress", (progress) => {
    publishState({
      errorMessage: null,
      installDeferredUntilIdle: false,
      phase: "downloading",
      statusMessage: `Downloading update… ${Math.round(progress.percent)}%`
    });
    log.info("[eve-updater] download progress", Math.round(progress.percent));
  });
  autoUpdater.on("update-downloaded", (info) => {
    publishState({
      downloadedVersion: info.version,
      downloadedVersionReady: true,
      errorMessage: null,
      installDeferredUntilIdle: Boolean(shouldDeferInstall?.()),
      latestVersion: info.version,
      phase: "downloaded",
      statusMessage: shouldDeferInstall?.()
        ? `Update ${info.version} is ready and will install after recording stops.`
        : `Update ${info.version} is ready and will install automatically.`
    });
    log.info("[eve-updater] update downloaded", info.version);
    installDownloadedUpdateIfReady();
  });
  autoUpdater.on("error", (error) => {
    const message = error == null
      ? "Automatic update failed."
      : error instanceof Error
        ? error.message
        : String(error);
    publishState({
      errorMessage: message,
      installDeferredUntilIdle: false,
      phase: "error",
      statusMessage: message
    });
    log.error("[eve-updater] auto update error", error);
  });

  onSnapshot(updaterState);
  void runUpdateCheck();
  updateCheckTimer = setInterval(() => {
    void runUpdateCheck();
  }, UPDATE_CHECK_INTERVAL_MS);
};

export const shutdownAutoUpdates = (): void => {
  if (updateCheckTimer) {
    clearInterval(updateCheckTimer);
    updateCheckTimer = null;
  }
  autoUpdater.removeAllListeners();
  onStateChange = null;
  shouldDeferInstall = null;
};
