import { dirname } from "node:path";
import icon from "../../resources/icon.png?asset";
import log from "electron-log/main";
import { app, type BrowserWindow, dialog, ipcMain, shell, type OpenDialogOptions } from "electron";
import {
  DEFAULT_SETTINGS,
  DEFAULT_STATUS,
  type AppSettings,
  type DesktopSnapshot,
  type DeviceInfo,
  type RecorderStatusSnapshot
} from "@eve/shared";
import {
  getMicrophonePermissionStatus,
  openMicrophonePrivacySettings,
  requestMicrophonePermission
} from "./permissions";
import { DesktopEngine } from "./desktop-engine";
import { TestDesktopEngine } from "./test-engine";
import {
  applyTheme,
  getSettings,
  setSettings
} from "./store";
import { listRecentRecordings } from "./recording-history";
import {
  destroyTray,
  getTrayBounds,
  initializeTray,
  setTrayLaunchAtLogin,
  setTrayStatus
} from "./tray";
import { createMainWindow, positionNearTray } from "./window";
import { initializeAutoUpdates, shutdownAutoUpdates } from "./updater";

const isE2E = process.env.EVE_E2E_TEST === "1";

type DesktopEngineLike = Pick<
  DesktopEngine,
  | "applySettings"
  | "getDevices"
  | "getReady"
  | "getStatus"
  | "updateDevices"
  | "reportCaptureError"
  | "startRecording"
  | "stopRecording"
  | "runTranscribe"
  | "pushAudioChunk"
>;

let mainWindow: BrowserWindow | null = null;
let engine: DesktopEngineLike | null = null;
let lastStatus: RecorderStatusSnapshot = DEFAULT_STATUS;
let isQuitting = false;
let isWindowPinned = false;
let quitAfterRecordingFinalize = false;
let cachedDevices: DesktopSnapshot["devices"] = [];
let cachedHistory: DesktopSnapshot["history"] = [];
let cachedPermission = isE2E
  ? {
      message: "E2E microphone permission granted.",
      state: "authorized" as const,
      supported: true
    }
  : getMicrophonePermissionStatus();

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Failed to start recording.";

const buildSnapshot = (): DesktopSnapshot => {
  const settings = getSettings();
  return {
    devices: cachedDevices,
    engineReady: engine?.getReady() ?? false,
    history: cachedHistory,
    permission: cachedPermission,
    settings,
    status: lastStatus,
    windowPinned: isWindowPinned
  };
};

const getSnapshot = async ({
  refreshDevices = false,
  refreshHistory = false,
  refreshPermission = false
}: {
  refreshDevices?: boolean;
  refreshHistory?: boolean;
  refreshPermission?: boolean;
} = {}): Promise<DesktopSnapshot> => {
  const settings = getSettings();
  const [devices, history] = await Promise.all([
    refreshDevices
      ? Promise.resolve(engine?.getDevices() ?? cachedDevices)
      : Promise.resolve(cachedDevices),
    refreshHistory
      ? listRecentRecordings([
          settings.recording.outputDir,
          DEFAULT_SETTINGS.recording.outputDir
        ]).catch(() => cachedHistory)
      : Promise.resolve(cachedHistory)
  ]);
  if (refreshDevices) {
    cachedDevices = devices;
  }
  if (refreshHistory) {
    cachedHistory = history;
  }
  if (refreshPermission) {
    cachedPermission = getMicrophonePermissionStatus();
  }
  return buildSnapshot();
};

const emitSnapshot = async (
  snapshot = buildSnapshot(),
  { force = false }: { force?: boolean } = {}
): Promise<void> => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  if (!force && !mainWindow.isVisible()) {
    return;
  }
  mainWindow.webContents.send("desktop:snapshot", snapshot);
};

const toggleMainWindow = (): void => {
  if (mainWindow?.isVisible()) {
    mainWindow.hide();
    return;
  }
  mainWindow ??= createMainWindow(true);
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  positionNearTray(mainWindow, getTrayBounds());
  mainWindow.show();
  mainWindow.focus();
  void getSnapshot({
    refreshDevices: true,
    refreshHistory: true,
    refreshPermission: true
  }).then((snapshot) => emitSnapshot(snapshot, { force: true }));
};

const applyLoginItemSettings = (enabled: boolean): void => {
  if (isE2E) {
    return;
  }
  if (!app.isPackaged) {
    log.info("[eve] skipped login item update in development");
    setTrayLaunchAtLogin(enabled);
    return;
  }
  try {
    app.setLoginItemSettings({
      enabled,
      openAsHidden: true
    });
  } catch (error) {
    log.warn("[eve] failed to update login item settings", error);
  }
  setTrayLaunchAtLogin(enabled);
};

const applyWindowPinnedState = (pinned: boolean): void => {
  isWindowPinned = pinned;
  mainWindow?.setAlwaysOnTop(pinned, pinned ? "floating" : "normal");
};

const startRecording = async (): Promise<void> => {
  if (!engine) {
    throw new Error("Recorder engine is unavailable.");
  }
  await engine.startRecording();
};

const captureStartRecordingError = (error: unknown): void => {
  engine?.reportCaptureError(errorMessage(error));
};

const finalizeRecordingBeforeQuit = async (): Promise<void> => {
  if (!engine || !lastStatus.recording) {
    return;
  }
  await engine.stopRecording();
};

const bootstrapDesktop = async (): Promise<void> => {
  if (app.isPackaged) {
    log.initialize();
  }
  if (process.platform === "darwin" && !isE2E) {
    app.dock?.hide();
  }
  const settings = getSettings() ?? DEFAULT_SETTINGS;
  engine = new (isE2E ? TestDesktopEngine : DesktopEngine)((status) => {
    lastStatus = status;
    setTrayStatus(lastStatus);
    void emitSnapshot(buildSnapshot(), { force: true });
  });
  engine.applySettings(settings);
  lastStatus = engine.getStatus();
  await getSnapshot({
    refreshDevices: true,
    refreshHistory: true,
    refreshPermission: true
  });
  applyLoginItemSettings(settings.desktop.launchAtLogin);
  applyTheme(settings.desktop.theme);
  const shouldShow = isE2E;
  mainWindow = createMainWindow(shouldShow);
  if (process.env.EVE_SMOKE_TEST === "1") {
    mainWindow.webContents.once("did-finish-load", () => {
      void mainWindow?.webContents
        .executeJavaScript(
          "JSON.stringify({ eve: typeof window.eve, bootstrap: typeof window.eve?.bootstrap })"
        )
        .then((result) => {
          console.log(`[eve-smoke] bridge=${String(result)}`);
          app.quit();
        })
        .catch((error: unknown) => {
          console.error("[eve-smoke] renderer bridge check failed", error);
          app.exit(1);
        });
    });
  }
  mainWindow.webContents.on("before-input-event", (_event, input) => {
    if (input.type === "keyDown" && input.key === "F12") {
      mainWindow?.webContents.openDevTools({ mode: "detach" });
    }
  });
  mainWindow.on("close", (event) => {
    if (isQuitting) {
      return;
    }
    event.preventDefault();
    mainWindow?.hide();
  });
  mainWindow.on("blur", () => {
    if (!isE2E && !isQuitting && !isWindowPinned) {
      mainWindow?.hide();
    }
  });
  if (!isE2E) {
    initializeTray({
      iconPath: icon,
      onOpen: toggleMainWindow,
      onQuit: () => app.quit(),
      onStartRecording: () => {
        void startRecording()
          .catch((error) => {
            captureStartRecordingError(error);
          })
          .then(() => getSnapshot({ refreshHistory: true }).then(emitSnapshot));
      },
      onStopRecording: () => {
        void engine?.stopRecording().then(() => getSnapshot({ refreshHistory: true }).then(emitSnapshot));
      },
      onToggleLaunchAtLogin: () => {
        const nextSettings: AppSettings = {
          ...getSettings(),
          desktop: {
            ...getSettings().desktop,
            launchAtLogin: !getSettings().desktop.launchAtLogin
          }
        };
        setSettings(nextSettings);
        applyLoginItemSettings(nextSettings.desktop.launchAtLogin);
        void emitSnapshot();
      }
    });
  }
  if (settings.desktop.startRecordingOnLaunch) {
    try {
      await startRecording();
    } catch (error) {
      captureStartRecordingError(error);
    }
  }
  if (!isE2E) {
    initializeAutoUpdates();
  }
};

ipcMain.handle("desktop:get-snapshot", () =>
  getSnapshot({
    refreshDevices: true,
    refreshHistory: true,
    refreshPermission: true
  })
);
ipcMain.handle("desktop:pick-directory", async (_event, defaultPath?: string) => {
  const options: OpenDialogOptions = {
    defaultPath: defaultPath && defaultPath.trim().length > 0 ? defaultPath : dirname(process.cwd()),
    properties: ["createDirectory", "openDirectory"]
  };
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options);
  return result.canceled ? null : (result.filePaths[0] ?? null);
});
ipcMain.handle("desktop:open-external", (_event, target: string) => shell.openExternal(target));
ipcMain.handle("desktop:open-recording-folder", async (_event, target: string) => {
  await shell.openPath(target);
});
ipcMain.handle("desktop:request-permission", async () => {
  const permission = isE2E
    ? cachedPermission
    : await requestMicrophonePermission();
  cachedPermission = permission;
  await emitSnapshot(buildSnapshot());
  return permission;
});
ipcMain.handle("desktop:save-settings", async (_event, settings: AppSettings) => {
  const saved = setSettings(settings);
  applyLoginItemSettings(saved.desktop.launchAtLogin);
  applyTheme(saved.desktop.theme);
  engine?.applySettings(saved);
  await emitSnapshot(
    await getSnapshot({
      refreshDevices: true,
      refreshHistory: true
    })
  );
  return saved;
});
ipcMain.handle("desktop:open-permission-settings", openMicrophonePrivacySettings);
ipcMain.handle("desktop:start-recording", async () => {
  await startRecording();
  return getSnapshot({ refreshHistory: true });
});
ipcMain.handle("desktop:stop-recording", async () => {
  await engine?.stopRecording();
  return getSnapshot({ refreshHistory: true });
});
ipcMain.handle("desktop:run-transcribe", async (_event, inputDir: string) => {
  await engine?.runTranscribe(inputDir);
  return getSnapshot({ refreshHistory: true });
});
ipcMain.handle("desktop:set-window-pinned", async (_event, pinned: boolean) => {
  applyWindowPinnedState(Boolean(pinned));
  const snapshot = buildSnapshot();
  await emitSnapshot(snapshot);
  return snapshot;
});
ipcMain.handle("desktop:update-devices", async (_event, devices: DeviceInfo[]) => {
  cachedDevices = devices;
  engine?.updateDevices(devices);
  const snapshot = buildSnapshot();
  await emitSnapshot(snapshot, { force: true });
  return snapshot;
});
ipcMain.handle("desktop:capture-error", async (_event, message: string) => {
  engine?.reportCaptureError(message);
  const snapshot = buildSnapshot();
  await emitSnapshot(snapshot, { force: true });
  return snapshot;
});
ipcMain.on("desktop:audio-chunk", (_event, payload: {
  deviceId: string;
  deviceLabel: string;
  rms: number;
  sampleRate: number;
  samples: number[];
}) => {
  const samples = Float32Array.from(payload.samples);
  void engine?.pushAudioChunk({
    ...payload,
    samples
  });
});

if (!isE2E && !app.requestSingleInstanceLock()) {
  app.quit();
}

app.whenReady().then(async () => {
  try {
    await bootstrapDesktop();
  } catch (error) {
    console.error("[eve] failed to bootstrap desktop", error);
    app.exit(1);
  }
});

app.on("second-instance", () => {
  mainWindow ??= createMainWindow(true);
  positionNearTray(mainWindow, getTrayBounds());
  mainWindow.show();
  mainWindow.focus();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", (event) => {
  isQuitting = true;
  if (!isE2E) {
    destroyTray();
    shutdownAutoUpdates();
  }
  if (quitAfterRecordingFinalize || !lastStatus.recording) {
    return;
  }
  event.preventDefault();
  quitAfterRecordingFinalize = true;
  void finalizeRecordingBeforeQuit()
    .catch((error) => {
      log.error("[eve] failed to finalize recording before quit", error);
    })
    .finally(() => {
      app.quit();
    });
});
