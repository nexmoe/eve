import log from "electron-log/main";

let initialized = false;

export const initializeMainLogger = (): void => {
  if (initialized) {
    return;
  }
  log.initialize();
  initialized = true;
};
