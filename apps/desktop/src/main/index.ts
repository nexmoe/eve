import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { dirname } from "node:path";
import icon from "../../resources/icon.png?asset";
import { app, type BrowserWindow, dialog, ipcMain, shell, type OpenDialogOptions } from "electron";
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type DesktopSnapshot,
  type RecorderStatusSnapshot
} from "@eve/shared";
import {
  getMicrophonePermissionStatus,
  openMicrophonePrivacySettings,
  requestMicrophonePermission
} from "./permissions";
import { parseCliCommand } from "./cli-parser";
import { SidecarManager } from "./sidecar-manager";
import {
  applyTheme,
  getIdleStatus,
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
import { sendCliCommand, startCliServer, type CliResponse } from "./command-server";
import { initializeAutoUpdates, shutdownAutoUpdates } from "./updater";

let mainWindow: BrowserWindow | null = null;
let sidecar: SidecarManager | null = null;
let lastStatus: RecorderStatusSnapshot = getIdleStatus();
let cliServer: Awaited<ReturnType<typeof startCliServer>> | null = null;
let isQuitting = false;
let isWindowPinned = false;
let cachedDevices: DesktopSnapshot["devices"] = [];
let cachedHistory: DesktopSnapshot["history"] = [];
let cachedPermission = getMicrophonePermissionStatus();
const isCliMode = process.argv.includes("--cli");

const buildSnapshot = (): DesktopSnapshot => {
  const settings = getSettings();
  return {
    devices: cachedDevices,
    history: cachedHistory,
    permission: cachedPermission,
    settings,
    sidecarReady: sidecar?.getReady() ?? false,
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
      ? sidecar?.listDevices().catch(() => cachedDevices) ?? Promise.resolve(cachedDevices)
      : Promise.resolve(cachedDevices),
    refreshHistory
      ? listRecentRecordings([
          settings.recording.outputDir,
          settings.transcribe.inputDir,
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

const emitSnapshot = async (snapshot = buildSnapshot()): Promise<void> => {
  mainWindow?.webContents.send("desktop:snapshot", snapshot);
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
};

const applyLoginItemSettings = (enabled: boolean): void => {
  app.setLoginItemSettings({
    enabled,
    openAsHidden: true
  });
  setTrayLaunchAtLogin(enabled);
};

const applyWindowPinnedState = (pinned: boolean): void => {
  isWindowPinned = pinned;
  mainWindow?.setAlwaysOnTop(pinned, pinned ? "floating" : "normal");
};

const handleCliCommand = async (args: string[]): Promise<CliResponse> => {
  const command = parseCliCommand(args);
  if (!command) {
    return { error: `Unknown CLI command: ${args.join(" ")}`, ok: false };
  }
  if (command.kind === "open") {
    toggleMainWindow();
    return { ok: true, payload: { opened: true } };
  }
  if (command.kind === "status") {
    return {
      ok: true,
      payload: await getSnapshot({
        refreshDevices: true,
        refreshHistory: true,
        refreshPermission: true
      })
    };
  }
  if (command.kind === "record-start") {
    await sidecar?.request({ id: randomUUID(), method: "recording.start" });
    return { ok: true, payload: { started: true } };
  }
  if (command.kind === "record-stop") {
    await sidecar?.request({ id: randomUUID(), method: "recording.stop" });
    return { ok: true, payload: { stopped: true } };
  }
  if (command.kind === "transcribe-run") {
    const payload = await sidecar?.request({
      id: randomUUID(),
      method: "transcribe.run",
      params: {
        force: command.force,
        inputDir: command.inputDir,
        limit: command.limit
      }
    });
    return { ok: true, payload };
  }
  return { error: `Unknown CLI command: ${args.join(" ")}`, ok: false };
};

const startCliClient = async (args: string[]): Promise<number> => {
  try {
    const response = await sendCliCommand({ args });
    process.stdout.write(`${JSON.stringify(response.payload ?? response, null, 2)}\n`);
    return response.ok ? 0 : 1;
  } catch {
    const executable = process.execPath;
    const child = spawn(executable, ["--silent-startup"], {
      detached: true,
      stdio: "ignore"
    });
    child.unref();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const response = await sendCliCommand({ args });
    process.stdout.write(`${JSON.stringify(response.payload ?? response, null, 2)}\n`);
    return response.ok ? 0 : 1;
  }
};

const bootstrapDesktop = async (): Promise<void> => {
  if (process.platform === "darwin") {
    app.dock?.hide();
  }
  const settings = getSettings() ?? DEFAULT_SETTINGS;
  sidecar = new SidecarManager();
  sidecar.onEvent((event) => {
    if (event.type === "status") {
      lastStatus = event.payload;
      setTrayStatus(lastStatus);
      void emitSnapshot(buildSnapshot());
      return;
    }
    if (event.type === "transcript-preview") {
      lastStatus = {
        ...lastStatus,
        asrHistory: event.payload.history,
        asrPreview: event.payload.preview
      };
      void emitSnapshot(buildSnapshot());
    }
  });
  await sidecar.start(settings);
  await getSnapshot({
    refreshDevices: true,
    refreshHistory: true,
    refreshPermission: true
  });
  applyLoginItemSettings(settings.desktop.launchAtLogin);
  applyTheme(settings.desktop.theme);
  const shouldShow = false;
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
    if (!isQuitting && !isWindowPinned) {
      mainWindow?.hide();
    }
  });
  initializeTray({
    iconPath: icon,
    onOpen: toggleMainWindow,
    onQuit: () => app.quit(),
    onStartRecording: () => {
      void sidecar?.request({ id: randomUUID(), method: "recording.start" });
    },
    onStopRecording: () => {
      void sidecar?.request({ id: randomUUID(), method: "recording.stop" });
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
  cliServer = await startCliServer(async (command) => handleCliCommand(command.args));
  if (settings.desktop.startRecordingOnLaunch) {
    await sidecar.request({ id: randomUUID(), method: "recording.start" });
  }
  initializeAutoUpdates();
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
  const permission = await requestMicrophonePermission();
  cachedPermission = permission;
  await emitSnapshot(buildSnapshot());
  return permission;
});
ipcMain.handle("desktop:save-settings", async (_event, settings: AppSettings) => {
  const saved = setSettings(settings);
  applyLoginItemSettings(saved.desktop.launchAtLogin);
  applyTheme(saved.desktop.theme);
  await sidecar?.applySettings(saved);
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
  await sidecar?.request({ id: randomUUID(), method: "recording.start" });
  return getSnapshot({ refreshHistory: true });
});
ipcMain.handle("desktop:stop-recording", async () => {
  await sidecar?.request({ id: randomUUID(), method: "recording.stop" });
  return getSnapshot({ refreshHistory: true });
});
ipcMain.handle("desktop:run-transcribe", async (_event, inputDir: string) => {
  await sidecar?.request({
    id: randomUUID(),
    method: "transcribe.run",
    params: { inputDir }
  });
  return getSnapshot({ refreshHistory: true });
});
ipcMain.handle("desktop:set-window-pinned", async (_event, pinned: boolean) => {
  applyWindowPinnedState(Boolean(pinned));
  const snapshot = buildSnapshot();
  await emitSnapshot(snapshot);
  return snapshot;
});

if (!isCliMode && !app.requestSingleInstanceLock()) {
  app.quit();
}

app.whenReady().then(async () => {
  if (isCliMode) {
    const cliArgs = process.argv.slice(process.argv.indexOf("--cli") + 1);
    const exitCode = await startCliClient(cliArgs);
    app.exit(exitCode);
    return;
  }
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

app.on("before-quit", () => {
  isQuitting = true;
  cliServer?.close();
  destroyTray();
  shutdownAutoUpdates();
  sidecar?.stop();
});
