import { useSyncExternalStore } from "react";

export interface ToastItem {
  id: string;
  message: string;
  title: string;
}

let toasts: ToastItem[] = [];
const listeners = new Set<() => void>();

const publish = (): void => {
  for (const listener of listeners) {
    listener();
  }
};

const removeToast = (id: string): void => {
  toasts = toasts.filter((toast) => toast.id !== id);
  publish();
};

export const toastActions = {
  show(input: Omit<ToastItem, "id">): void {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    toasts = [...toasts, { ...input, id }];
    publish();
    setTimeout(() => removeToast(id), 4000);
  }
};

export const useToasts = (): ToastItem[] => {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => toasts
  );
};
