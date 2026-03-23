import { AlertCircle } from "lucide-react";
import { useToasts } from "@/lib/toast-store";

export function ToastViewport() {
  const toasts = useToasts();

  if (toasts.length === 0) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed inset-x-3 top-11 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="flex items-start gap-2 rounded-xl border border-[color:var(--border)] bg-white px-3 py-2.5 shadow-lg dark:bg-[#1f1f22]"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--accent)]" />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-[color:var(--foreground)]">{toast.title}</p>
            <p className="text-xs leading-5 text-[color:var(--muted)]">{toast.message}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
