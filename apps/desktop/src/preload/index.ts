import { contextBridge, ipcRenderer } from "electron";
import type { AppSettings, DesktopSnapshot, MicrophonePermissionStatus } from "@eve/shared";

export interface DesktopBridgeApi {
  bootstrap: () => Promise<DesktopSnapshot>;
  openRecordingFolder: (target: string) => Promise<void>;
  pickDirectory: (defaultPath?: string) => Promise<string | null>;
  onSnapshot: (listener: (snapshot: DesktopSnapshot) => void) => () => void;
  openExternal: (target: string) => Promise<void>;
  openMicrophoneSettings: () => Promise<boolean>;
  requestMicrophonePermission: () => Promise<MicrophonePermissionStatus>;
  runTranscribe: (inputDir: string) => Promise<DesktopSnapshot>;
  saveSettings: (settings: AppSettings) => Promise<AppSettings>;
  setWindowPinned: (pinned: boolean) => Promise<DesktopSnapshot>;
  startRecording: () => Promise<DesktopSnapshot>;
  stopRecording: () => Promise<DesktopSnapshot>;
}

const api: DesktopBridgeApi = {
  bootstrap: () => ipcRenderer.invoke("desktop:get-snapshot"),
  openRecordingFolder: (target) => ipcRenderer.invoke("desktop:open-recording-folder", target),
  pickDirectory: (defaultPath) => ipcRenderer.invoke("desktop:pick-directory", defaultPath),
  onSnapshot: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, snapshot: DesktopSnapshot) => {
      listener(snapshot);
    };
    ipcRenderer.on("desktop:snapshot", wrappedListener);
    return () => {
      ipcRenderer.removeListener("desktop:snapshot", wrappedListener);
    };
  },
  openExternal: (target) => ipcRenderer.invoke("desktop:open-external", target),
  openMicrophoneSettings: () => ipcRenderer.invoke("desktop:open-permission-settings"),
  requestMicrophonePermission: () => ipcRenderer.invoke("desktop:request-permission"),
  runTranscribe: (inputDir) => ipcRenderer.invoke("desktop:run-transcribe", inputDir),
  saveSettings: (settings) => ipcRenderer.invoke("desktop:save-settings", settings),
  setWindowPinned: (pinned) => ipcRenderer.invoke("desktop:set-window-pinned", pinned),
  startRecording: () => ipcRenderer.invoke("desktop:start-recording"),
  stopRecording: () => ipcRenderer.invoke("desktop:stop-recording")
};

contextBridge.exposeInMainWorld("eve", api);
