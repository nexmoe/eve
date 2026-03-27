import { Menu, Tray, app, nativeImage } from "electron";
import { DEFAULT_STATUS, type RecorderStatusSnapshot } from "@eve/shared";

interface TrayControllerOptions {
  iconPath: string;
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
}

let trayState: TrayControllerState | null = null;

const createTrayImage = (iconPath: string): Electron.NativeImage => {
  const image = nativeImage.createFromPath(iconPath);
  if (process.platform !== "darwin") {
    return image;
  }
  return image.resize({ height: 18, width: 18 });
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
      ? `eve 正在录音 · ${trayState.status.elapsed}`
      : "eve 在后台待命"
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
    tray
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

export const destroyTray = (): void => {
  trayState?.tray.destroy();
  trayState = null;
};
