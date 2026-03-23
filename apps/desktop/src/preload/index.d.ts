import type { DesktopBridgeApi } from "./index";

declare global {
  interface Window {
    eve: DesktopBridgeApi;
  }
}

export {};
