import type { ReactNode } from "react";

export function SettingField({
  control,
  description,
  layout = "inline",
  title
}: {
  control: ReactNode;
  description: string;
  layout?: "inline" | "stacked";
  title: string;
}) {
  return (
    <div
      className={
        layout === "inline"
          ? "flex items-center justify-between gap-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-3.5"
          : "flex flex-col gap-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-3.5"
      }
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-[color:var(--foreground)]">{title}</p>
        <p className="mt-0.5 text-xs leading-5 text-[color:var(--muted)]">{description}</p>
      </div>
      <div className={layout === "inline" ? "shrink-0" : "min-w-0 max-w-full"}>{control}</div>
    </div>
  );
}
