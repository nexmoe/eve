import { app } from "electron";
import log from "electron-log/main";
import { autoUpdater } from "electron-updater";

const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

let updateCheckTimer: NodeJS.Timeout | null = null;

const shouldEnableAutoUpdate = (): boolean => {
  return app.isPackaged && !process.argv.includes("--cli");
};

const runUpdateCheck = async (): Promise<void> => {
  if (!shouldEnableAutoUpdate()) {
    return;
  }
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    log.error("[eve-updater] update check failed", error);
  }
};

export const initializeAutoUpdates = (): void => {
  if (!shouldEnableAutoUpdate()) {
    log.info("[eve-updater] skipped update initialization in development or CLI mode");
    return;
  }
  log.initialize();
  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.autoRunAppAfterInstall = true;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on("checking-for-update", () => {
    log.info("[eve-updater] checking for updates");
  });
  autoUpdater.on("update-available", (info) => {
    log.info("[eve-updater] update available", info.version);
  });
  autoUpdater.on("update-not-available", () => {
    log.info("[eve-updater] no update available");
  });
  autoUpdater.on("download-progress", (progress) => {
    log.info("[eve-updater] download progress", Math.round(progress.percent));
  });
  autoUpdater.on("update-downloaded", (info) => {
    log.info("[eve-updater] update downloaded and will install on quit", info.version);
  });
  autoUpdater.on("error", (error) => {
    log.error("[eve-updater] auto update error", error);
  });

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
};
