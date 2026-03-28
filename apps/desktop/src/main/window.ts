import { app, BrowserWindow, nativeImage, screen } from "electron";
import { join } from "node:path";

const WINDOW_TITLE = "Eve Recorder";
const WINDOW_ICON_PATH = join(import.meta.dirname, "../../resources/icon.png");

export const createMainWindow = (showOnReady: boolean): BrowserWindow => {
  const isMac = process.platform === "darwin";
  const useGlassWindow = isMac;

  const windowRef = new BrowserWindow({
    width: 420,
    height: 620,
    minWidth: 380,
    minHeight: 480,
    maxWidth: 520,
    resizable: true,
    frame: false,
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 14, y: 14 },
    transparent: useGlassWindow,
    show: false,
    skipTaskbar: false,
    title: WINDOW_TITLE,
    ...(isMac ? {} : { icon: nativeImage.createFromPath(WINDOW_ICON_PATH) }),
    // macOS: native vibrancy — "popover" matches system widget panels
    ...(useGlassWindow
      ? {
          vibrancy: "popover" as const,
          visualEffectState: "active"
        }
      : !isMac
        ? {
          // Windows 11: acrylic material for frosted glass
          backgroundMaterial: "acrylic" as const
        }
        : {}
    ),
    backgroundColor: useGlassWindow
      ? "#00000000"
      : isMac
        ? "#f6f7f9"
        : "#ffffff",
    hasShadow: true,
    roundedCorners: true,
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.mjs"),
      sandbox: false
    }
  });

  windowRef.on("ready-to-show", () => {
    if (showOnReady) {
      windowRef.show();
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void windowRef.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void windowRef.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  }
  return windowRef;
};

export const positionWindowForReveal = (
  windowRef: BrowserWindow,
  trayBounds: Electron.Rectangle | null
): void => {
  if (process.platform === "win32") {
    windowRef.center();
    return;
  }
  positionNearTray(windowRef, trayBounds);
};

/**
 * Position the window centered horizontally below the tray icon.
 * Falls back to top-right of primary display if tray bounds unavailable.
 */
export const positionNearTray = (
  windowRef: BrowserWindow,
  trayBounds: Electron.Rectangle | null
): void => {
  const [winWidth] = windowRef.getSize();
  const display = screen.getPrimaryDisplay();

  if (trayBounds && trayBounds.width > 0) {
    // Center the window horizontally on the tray icon
    const trayCenterX = trayBounds.x + Math.round(trayBounds.width / 2);
    const x = Math.round(trayCenterX - winWidth / 2);
    // Place just below the tray icon (menu bar height)
    const y = trayBounds.y + trayBounds.height + 4;

    // Clamp to screen edges
    const { width: screenWidth } = display.workAreaSize;
    const clampedX = Math.max(8, Math.min(x, screenWidth - winWidth - 8));
    windowRef.setPosition(clampedX, y, false);
  } else {
    // Fallback: top-right corner
    const { width: screenWidth } = display.workAreaSize;
    windowRef.setPosition(screenWidth - winWidth - 12, 4, false);
  }
};
