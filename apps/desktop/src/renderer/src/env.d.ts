import type { DesktopBridgeApi } from "../../preload/index";

declare global {
  interface Window {
    eve: DesktopBridgeApi;
  }
}

export {};
