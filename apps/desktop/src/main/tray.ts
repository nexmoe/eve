import { Menu, Tray, app, nativeImage } from "electron";
import { DEFAULT_STATUS, type AutoUpdateSnapshot, type RecorderStatusSnapshot } from "@eve/shared";

interface TrayControllerOptions {
  iconPath: string;
  onCheckForUpdates: () => void;
  onInstallUpdate: () => void;
  onOpen: () => void;
  onOpenDevTools: () => void;
  onQuit: () => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onToggleLaunchAtLogin: () => void;
}

interface TrayControllerState extends TrayControllerOptions {
  launchAtLogin: boolean;
  status: RecorderStatusSnapshot;
  tray: Tray;
  updater: AutoUpdateSnapshot | null;
}

let trayState: TrayControllerState | null = null;

const createTrayImage = (iconPath: string): Electron.NativeImage => {
  const image = nativeImage.createFromPath(iconPath);
  if (process.platform !== "darwin") {
    return image;
  }
  return image.resize({ height: 18, width: 18 });
};

const getUpdaterMenuItems = (): Electron.MenuItemConstructorOptions[] => {
  if (!trayState) {
    return [];
  }

  const updater = trayState.updater;
  const versionItem: Electron.MenuItemConstructorOptions = {
    enabled: false,
    label: `版本：${app.getVersion()}`
  };

  if (!updater) {
    return [
      versionItem,
      { click: trayState.onCheckForUpdates, label: "检查更新" }
    ];
  }

  switch (updater.phase) {
    case "checking":
      return [
        versionItem,
        { enabled: false, label: "正在检查更新…" }
      ];

    case "downloading":
      return [
        versionItem,
        { enabled: false, label: updater.statusMessage }
      ];

    case "downloaded":
      return [
        versionItem,
        {
          enabled: false,
          label: updater.installDeferredUntilIdle
            ? `更新 ${updater.downloadedVersion ?? ""} 将在录音结束后安装`
            : `更新 ${updater.downloadedVersion ?? ""} 已就绪`
        },
        { click: trayState.onInstallUpdate, label: "立即安装并重启" }
      ];

    case "error":
      return [
        versionItem,
        { enabled: false, label: "更新检查失败" },
        { click: trayState.onCheckForUpdates, label: "重试更新" }
      ];

    case "idle":
      return [
        versionItem,
        { enabled: false, label: "已是最新版本" },
        { click: trayState.onCheckForUpdates, label: "检查更新" }
      ];

    default:
      return [
        versionItem,
        { click: trayState.onCheckForUpdates, label: "检查更新" }
      ];
  }
};

const buildMenu = (): Menu => {
  if (!trayState) {
    return Menu.buildFromTemplate([]);
  }
  const statusLabel = trayState.status.recording
    ? `录音中 · ${trayState.status.elapsed}`
    : "空闲";
  return Menu.buildFromTemplate([
    {
      enabled: !trayState.status.recording,
      click: trayState.onStartRecording,
      label: "开始录音"
    },
    {
      enabled: trayState.status.recording,
      click: trayState.onStopRecording,
      label: "停止录音"
    },
    {
      type: "separator"
    },
    {
      checked: trayState.launchAtLogin,
      click: trayState.onToggleLaunchAtLogin,
      label: "开机自启",
      type: "checkbox"
    },
    {
      enabled: false,
      label: `状态：${statusLabel}`
    },
    {
      enabled: false,
      label: `设备：${trayState.status.deviceLabel}`
    },
    {
      click: trayState.onOpenDevTools,
      label: "打开开发者工具"
    },
    {
      type: "separator"
    },
    ...getUpdaterMenuItems(),
    {
      type: "separator"
    },
    {
      click: trayState.onOpen,
      label: "打开主窗口"
    },
    {
      type: "separator"
    },
    {
      click: trayState.onQuit,
      label: `退出 ${app.getName()}`
    }
  ]);
};

const syncTray = (): void => {
  if (!trayState) {
    return;
  }
  trayState.tray.setToolTip(
    trayState.status.recording
      ? `Eve Recorder 正在录音 · ${trayState.status.elapsed}`
      : "Eve Recorder 在后台待命"
  );
};

export const initializeTray = (options: TrayControllerOptions): void => {
  const tray = new Tray(createTrayImage(options.iconPath));
  // Left-click: toggle window; right-click: show context menu
  tray.on("click", options.onOpen);
  tray.on("right-click", () => {
    tray.popUpContextMenu(buildMenu());
  });
  trayState = {
    ...options,
    launchAtLogin: false,
    status: { ...DEFAULT_STATUS },
    tray,
    updater: null
  };
  syncTray();
};

export const getTrayBounds = (): Electron.Rectangle | null => {
  return trayState?.tray.getBounds() ?? null;
};

export const setTrayLaunchAtLogin = (value: boolean): void => {
  if (!trayState) {
    return;
  }
  trayState.launchAtLogin = value;
  syncTray();
};

export const setTrayStatus = (status: RecorderStatusSnapshot): void => {
  if (!trayState) {
    return;
  }
  trayState.status = status;
  syncTray();
};

export const setTrayUpdaterState = (updater: AutoUpdateSnapshot): void => {
  if (!trayState) {
    return;
  }
  trayState.updater = updater;
};

export const destroyTray = (): void => {
  trayState?.tray.destroy();
  trayState = null;
};
