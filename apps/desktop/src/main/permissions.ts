import { shell, systemPreferences } from "electron";
import type { MicrophonePermissionStatus } from "@eve/shared";

const normalizeState = (state: string): MicrophonePermissionStatus["state"] => {
  if (state === "granted") {
    return "authorized";
  }
  if (state === "denied") {
    return "denied";
  }
  if (state === "restricted") {
    return "restricted";
  }
  if (state === "not-determined") {
    return "not-determined";
  }
  return "unsupported";
};

const buildMessage = (state: MicrophonePermissionStatus["state"]): string => {
  if (state === "authorized") {
    return "麦克风权限已授权。";
  }
  if (state === "denied") {
    return "麦克风权限已拒绝，请到系统设置手动开启。";
  }
  if (state === "restricted") {
    return "麦克风权限受系统限制。";
  }
  if (state === "not-determined") {
    return "麦克风权限尚未申请。";
  }
  return "当前平台未提供完整的麦克风权限桥接。";
};

export const getMicrophonePermissionStatus = (): MicrophonePermissionStatus => {
  try {
    const state = normalizeState(systemPreferences.getMediaAccessStatus("microphone"));
    return {
      message: buildMessage(state),
      state,
      supported: state !== "unsupported"
    };
  } catch {
    return {
      message: buildMessage("unsupported"),
      state: "unsupported",
      supported: false
    };
  }
};

export const requestMicrophonePermission = async (): Promise<MicrophonePermissionStatus> => {
  if (process.platform === "darwin") {
    await systemPreferences.askForMediaAccess("microphone");
  }
  return getMicrophonePermissionStatus();
};

export const openMicrophonePrivacySettings = async (): Promise<boolean> => {
  const target = process.platform === "win32"
    ? "ms-settings:privacy-microphone"
    : "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone";
  try {
    await shell.openExternal(target);
    return true;
  } catch {
    return false;
  }
};
