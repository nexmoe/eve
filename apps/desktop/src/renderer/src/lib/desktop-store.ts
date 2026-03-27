import {
  DEFAULT_SETTINGS,
  DEFAULT_STATUS,
  type AppSettings,
  type DesktopSnapshot,
  type MicrophonePermissionStatus,
  type RecorderStatusSnapshot
} from "@eve/shared";
import { useSyncExternalStore } from "react";
import { createT } from "@/lib/i18n";
import { toastActions } from "@/lib/toast-store";

const defaultPermission = (): MicrophonePermissionStatus => ({
  message: createT(DEFAULT_SETTINGS.desktop.language)("permissionPending"),
  state: "not-determined",
  supported: true
});

let snapshot: DesktopSnapshot = {
  devices: [],
  engineReady: false,
  history: [],
  permission: defaultPermission(),
  settings: DEFAULT_SETTINGS,
  status: DEFAULT_STATUS,
  windowPinned: false
};

const listeners = new Set<() => void>();
const bridge = window.eve;
let saveSequence = 0;
let lastStatusError: string | null = null;

const publish = (): void => {
  for (const listener of listeners) {
    listener();
  }
};

const updateSnapshot = (nextSnapshot: DesktopSnapshot): void => {
  const nextError = nextSnapshot.status.error?.trim() || null;
  const previousError = snapshot.status.error?.trim() || null;
  snapshot = nextSnapshot;
  if (nextError && nextError !== previousError && nextError !== lastStatusError) {
    lastStatusError = nextError;
    toastActions.show({
      message: nextError,
      title: createT(nextSnapshot.settings.desktop.language)("errorStartRecordingFailed")
    });
  }
  if (!nextError) {
    lastStatusError = null;
  }
  publish();
};

if (!bridge) {
  console.error("[eve-renderer] preload bridge is unavailable.");
  updateSnapshot({
    ...snapshot,
    permission: {
      message: createT(snapshot.settings.desktop.language)("errorBridgeMissing"),
      state: "denied",
      supported: true
    }
  });
} else {
  void bridge.bootstrap().then(updateSnapshot);
  bridge.onSnapshot(updateSnapshot);
}

export const useDesktopSnapshot = (): DesktopSnapshot => {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => snapshot
  );
};

export const getDesktopSnapshot = (): DesktopSnapshot => snapshot;

const rejectBridgeCall = async <T>(): Promise<T> => {
  throw new Error(createT(snapshot.settings.desktop.language)("errorBridgeUnavailable"));
};

const requestBrowserMicrophonePermission = async (): Promise<void> => {
  if (!navigator.mediaDevices?.getUserMedia) {
    return;
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  stream.getTracks().forEach((track) => {
    track.stop();
  });
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return createT(snapshot.settings.desktop.language)("errorUnknown");
};

const withToast = async <T>(title: string, task: () => Promise<T>): Promise<T> => {
  try {
    return await task();
  } catch (error) {
    toastActions.show({
      message: getErrorMessage(error),
      title
    });
    throw error;
  }
};

export const desktopActions = {
  async openExternal(target: string): Promise<void> {
    await withToast(createT(snapshot.settings.desktop.language)("errorOpenLinkFailed"), () =>
      bridge?.openExternal(target) ?? rejectBridgeCall()
    );
  },
  async openRecordingFolder(target: string): Promise<void> {
    await withToast(createT(snapshot.settings.desktop.language)("errorOpenRecordingFolderFailed"), () =>
      bridge?.openRecordingFolder(target) ?? rejectBridgeCall()
    );
  },
  async pickDirectory(defaultPath?: string): Promise<string | null> {
    return withToast(createT(snapshot.settings.desktop.language)("errorOpenDirectoryPickerFailed"), () =>
      bridge?.pickDirectory(defaultPath) ?? rejectBridgeCall()
    );
  },
  async runTranscribe(inputDir: string): Promise<void> {
    updateSnapshot(
      await withToast(createT(snapshot.settings.desktop.language)("errorRunTranscribeFailed"), () =>
        bridge?.runTranscribe(inputDir) ?? rejectBridgeCall()
      )
    );
  },
  async requestPermission(): Promise<MicrophonePermissionStatus> {
    const permission = await withToast(
      createT(snapshot.settings.desktop.language)("errorRequestPermissionFailed"),
      async () => {
        const requested = await (bridge?.requestMicrophonePermission() ?? rejectBridgeCall());
        if (requested.state === "authorized") {
          return requested;
        }
        await requestBrowserMicrophonePermission();
        const refreshed = await (bridge?.bootstrap() ?? rejectBridgeCall());
        updateSnapshot(refreshed);
        return refreshed.permission;
      }
    );
    updateSnapshot({ ...snapshot, permission });
    return permission;
  },
  async saveSettings(settings: AppSettings): Promise<void> {
    const requestId = ++saveSequence;
    updateSnapshot({ ...snapshot, settings });
    const saved = await withToast(createT(settings.desktop.language)("errorSaveSettingsFailed"), () =>
      bridge?.saveSettings(settings) ?? rejectBridgeCall()
    );
    if (requestId === saveSequence) {
      updateSnapshot({ ...snapshot, settings: saved });
    }
  },
  async setWindowPinned(pinned: boolean): Promise<void> {
    updateSnapshot(
      await withToast(createT(snapshot.settings.desktop.language)("errorUpdateWindowStateFailed"), () =>
        bridge?.setWindowPinned(pinned) ?? rejectBridgeCall()
      )
    );
  },
  async startRecording(): Promise<void> {
    const title = createT(snapshot.settings.desktop.language)("errorStartRecordingFailed");
    if (snapshot.permission.state === "not-determined") {
      await desktopActions.requestPermission();
    }
    const nextSnapshot = await withToast(title, () =>
      bridge?.startRecording() ?? rejectBridgeCall()
    );
    updateSnapshot(nextSnapshot);
    if (nextSnapshot.status.recording) {
      return;
    }
    const message =
      nextSnapshot.status.error?.trim() ||
      nextSnapshot.status.statusMessage.trim() ||
      createT(nextSnapshot.settings.desktop.language)("errorUnknown");
    if (message !== lastStatusError) {
      lastStatusError = message;
      toastActions.show({
        message,
        title
      });
    }
    throw new Error(message);
  },
  async stopRecording(): Promise<void> {
    updateSnapshot(
      await withToast(createT(snapshot.settings.desktop.language)("errorStopRecordingFailed"), () =>
        bridge?.stopRecording() ?? rejectBridgeCall()
      )
    );
  },
  async openMicrophoneSettings(): Promise<boolean> {
    return withToast(createT(snapshot.settings.desktop.language)("errorOpenSystemSettingsFailed"), () =>
      bridge?.openMicrophoneSettings() ?? rejectBridgeCall()
    );
  }
};
