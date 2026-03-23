import { useState } from "react";
import { FolderCog, FolderOpen, Mic } from "lucide-react";
import type { AppLanguage, RecordingHistoryItem } from "@eve/shared";
import { desktopActions } from "@/lib/desktop-store";
import { Button } from "@/components/ui/button";
import { createT, resolveIntlLocale } from "@/lib/i18n";
import { toastActions } from "@/lib/toast-store";

type DayGroup = {
  dateKey: string;
  dayLabel: string;
  folderPath: string;
  total: number;
  transcribed: number;
  pending: number;
  recording: number;
};

const formatDayLabel = (value: string, language: AppLanguage): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.slice(0, 10) || value;
  }
  return new Intl.DateTimeFormat(resolveIntlLocale(language), {
    day: "numeric",
    month: "short",
    weekday: "short"
  }).format(date);
};

const toDateKey = (value: string): string => {
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) {
    return date.toISOString().slice(0, 10);
  }
  return value.slice(0, 10);
};

const summarizeDays = (items: RecordingHistoryItem[], language: AppLanguage): DayGroup[] => {
  const groups = new Map<string, DayGroup>();

  for (const item of items) {
    const dateKey = toDateKey(item.startedAt);
    const current =
      groups.get(dateKey) ??
      {
        dateKey,
        dayLabel: formatDayLabel(item.startedAt, language),
        folderPath: item.folderPath,
        pending: 0,
        recording: 0,
        total: 0,
        transcribed: 0
      };

    current.total += 1;
    current.folderPath = item.folderPath || current.folderPath;

    if (item.status === "ok") {
      current.transcribed += 1;
    } else if (item.status === "recording") {
      current.recording += 1;
    } else {
      current.pending += 1;
    }

    groups.set(dateKey, current);
  }

  return [...groups.values()].sort((left, right) => right.dateKey.localeCompare(left.dateKey));
};

const buildSummary = (group: DayGroup, language: AppLanguage): string => {
  const t = createT(language);
  const parts = [t("historySummaryTotal", { count: group.total })];

  if (group.transcribed > 0) {
    parts.push(t("historySummaryTranscribed", { count: group.transcribed }));
  }
  if (group.pending > 0) {
    parts.push(t("historySummaryPending", { count: group.pending }));
  }
  if (group.recording > 0) {
    parts.push(t("historySummaryRecording", { count: group.recording }));
  }

  return parts.join(" · ");
};

export function RecordingHistory({
  items,
  language
}: {
  items: RecordingHistoryItem[];
  language: AppLanguage;
}) {
  const t = createT(language);
  const [runningDays, setRunningDays] = useState<string[]>([]);

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-5">
        <p className="text-sm font-medium text-[color:var(--foreground)]">{t("historyTitle")}</p>
        <p className="mt-1 text-xs leading-5 text-[color:var(--muted)]">
          {t("historyEmptyDescription")}
        </p>
      </div>
    );
  }

  const groups = summarizeDays(items, language);

  return (
    <div className="space-y-2">
      {groups.map((group) => (
        <div
          key={group.dateKey}
          className="overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-3.5"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <Mic className="h-3.5 w-3.5 shrink-0 text-[color:var(--accent)]" />
                <p className="text-sm font-medium text-[color:var(--foreground)]">
                  {group.dayLabel}
                </p>
              </div>
              <p className="mt-1 text-xs leading-5 text-[color:var(--foreground)]">
                {buildSummary(group, language)}
              </p>
              <p
                className="mt-1 break-all text-xs leading-5 text-[color:var(--muted)]"
                title={group.folderPath}
              >
                {group.folderPath}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {group.pending > 0 && (
                <Button
                  aria-label={
                    runningDays.includes(group.dateKey)
                      ? t("historyProcessing")
                      : t("historyRunTranscribeTitle")
                  }
                  className="w-8 shrink-0 px-0"
                  disabled={runningDays.includes(group.dateKey)}
                  size="sm"
                  title={
                    runningDays.includes(group.dateKey)
                      ? t("historyProcessing")
                      : t("historyRunTranscribeTitle")
                  }
                  variant="subtle"
                  onClick={async () => {
                    setRunningDays((current) => [...current, group.dateKey]);
                    try {
                      await desktopActions.runTranscribe(group.folderPath);
                      toastActions.show({
                        message: t("historyTranscribeStartedMessage", {
                          dayLabel: group.dayLabel
                        }),
                        title: t("historyTranscribeStartedTitle")
                      });
                    } finally {
                      setRunningDays((current) =>
                        current.filter((value) => value !== group.dateKey)
                      );
                    }
                  }}
                >
                  <FolderCog className="h-3.5 w-3.5" />
                </Button>
              )}
              <Button
                aria-label={t("historyOpenFolderTitle")}
                className="w-8 shrink-0 px-0"
                size="sm"
                title={t("historyOpenFolderTitle")}
                variant="subtle"
                onClick={() => desktopActions.openRecordingFolder(group.folderPath)}
              >
                <FolderOpen className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
