import { Activity, Mic, Pin, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LiveWaveform } from "@/components/ui/live-waveform";
import type { DesktopSnapshot } from "@eve/shared";
import { statusTone } from "@/lib/status-tone";
import { createT } from "@/lib/i18n";

const MAX_HISTORY_ITEMS = 3;

export function StatusOverview({
  onTogglePinned,
  onOpenPrivacy,
  onRequestPermission,
  onStart,
  onStop,
  snapshot
}: {
  onTogglePinned: (pinned: boolean) => Promise<void>;
  onOpenPrivacy: () => Promise<boolean>;
  onRequestPermission: () => Promise<unknown>;
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
  snapshot: DesktopSnapshot;
}) {
  const t = createT(snapshot.settings.desktop.language);
  const tone = statusTone(snapshot.status);
  const recording = snapshot.status.recording;
  const preview = snapshot.status.asrPreview.trim();
  const history = snapshot.status.asrHistory
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item !== preview)
    .slice(0, MAX_HISTORY_ITEMS);
  const hasTranscript = preview.length > 0 || history.length > 0;

  return (
    <div className="space-y-4">
      {/* Header: status + action */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="status-dot" data-tone={tone} />
          <span className="text-sm font-semibold tracking-tight text-[color:var(--foreground)]">
            {recording
              ? t("statusRecording", { elapsed: snapshot.status.elapsed })
              : t("statusIdle")}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            aria-pressed={snapshot.windowPinned}
            className="w-8 px-0"
            size="sm"
            title={snapshot.windowPinned ? t("unpinWindow") : t("pinWindow")}
            variant={snapshot.windowPinned ? "subtle" : "ghost"}
            onClick={() => onTogglePinned(!snapshot.windowPinned)}
          >
            <Pin className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" onClick={recording ? onStop : onStart}>
            {recording ? t("stopRecording") : t("startRecording")}
          </Button>
        </div>
      </div>

      {/* Waveform — mirrors Viora RecordingWaveform usage */}
      <LiveWaveform
        active={recording}
        processing={!recording && snapshot.status.asrEnabled}
        mode="static"
        centerStaticBars
        barWidth={2.5}
        barGap={1.5}
        barRadius={1.5}
        fadeEdges
        fadeWidth={20}
        height={72}
        className="w-full"
      />

      {/* Metrics row */}
      <div className="grid grid-cols-2 gap-2">
        <div className="metric-card-compact">
          <Mic className="h-3.5 w-3.5 text-[color:var(--accent)]" />
          <div className="min-w-0 flex-1">
            <div className="metric-label-compact">{t("metricDevice")}</div>
            <strong className="metric-value-compact block truncate">
              {snapshot.status.deviceLabel}
            </strong>
          </div>
        </div>
        <div className="metric-card-compact">
          <Activity className="h-3.5 w-3.5 text-[color:var(--accent)]" />
          <div className="min-w-0 flex-1">
            <div className="metric-label-compact">{t("metricLevel")}</div>
            <strong className="metric-value-compact block truncate">
              {snapshot.status.db.toFixed(1)} dB
            </strong>
          </div>
        </div>
      </div>

      {/* Permission banner (only when needed) */}
      {snapshot.permission.state !== "authorized" && (
        <div className="flex items-center gap-2.5 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] px-3.5 py-3">
          <ShieldCheck className="h-4 w-4 shrink-0 text-[color:var(--accent)]" />
          <span className="flex-1 text-xs leading-5 text-[color:var(--muted)]">
            {permissionMessage(snapshot.permission.state, t)}
          </span>
          {snapshot.permission.state === "not-determined" ? (
            <Button size="sm" variant="ghost" onClick={onRequestPermission}>
              {t("permissionRequestAction")}
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={onOpenPrivacy}>
              {t("permissionOpenSettingsAction")}
            </Button>
          )}
        </div>
      )}

      <section className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] px-3.5 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold tracking-tight text-[color:var(--foreground)]">
              {t("liveTranscriptTitle")}
            </p>
            <p className="mt-0.5 text-[11px] leading-5 text-[color:var(--muted)]">
              {snapshot.status.asrEnabled
                ? t("liveTranscriptEnabledDescription")
                : t("liveTranscriptDisabledDescription")}
            </p>
          </div>
          {snapshot.status.asrEnabled && (
            <span className="rounded-full bg-[color:var(--surface-soft)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[color:var(--muted)]">
              {recording
                ? snapshot.status.inSpeech
                  ? t("liveTranscriptListening")
                  : t("liveTranscriptStandby")
                : t("liveTranscriptNotStarted")}
            </span>
          )}
        </div>

        {hasTranscript ? (
          <div className="mt-2.5 space-y-2">
            {preview && (
              <div className="rounded-lg bg-[color:var(--panel)] px-2.5 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[color:var(--muted)]">
                  {t("liveTranscriptCurrentSegment")}
                </p>
                <p className="mt-1 text-xs leading-5 text-[color:var(--foreground)]">
                  {preview}
                </p>
              </div>
            )}

            {history.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[color:var(--muted)]">
                  {t("liveTranscriptRecent")}
                </p>
                <div className="space-y-1.5">
                  {history.map((item, index) => (
                    <div
                      key={`${index}-${item}`}
                      className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-soft)] px-2.5 py-1.5"
                    >
                      <p className="text-[11px] leading-5 text-[color:var(--foreground)]">
                        {item}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="mt-2.5 text-[11px] leading-5 text-[color:var(--muted)]">
            {!snapshot.status.asrEnabled
              ? t("liveTranscriptHintDisabled")
              : !recording
                ? t("liveTranscriptHintIdle")
                : snapshot.status.inSpeech
                  ? t("liveTranscriptHintProcessing")
                  : t("liveTranscriptHintWaiting")}
          </p>
        )}
      </section>
    </div>
  );
}

function permissionMessage(
  state: DesktopSnapshot["permission"]["state"],
  t: ReturnType<typeof createT>
): string {
  if (state === "authorized") {
    return t("permissionAuthorized");
  }
  if (state === "denied") {
    return t("permissionDenied");
  }
  if (state === "restricted") {
    return t("permissionRestricted");
  }
  if (state === "not-determined") {
    return t("permissionNotDetermined");
  }
  return t("permissionUnsupported");
}
