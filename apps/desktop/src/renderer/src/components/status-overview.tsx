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
  sharedStream,
  snapshot
}: {
  onTogglePinned: (pinned: boolean) => Promise<void>;
  onOpenPrivacy: () => Promise<boolean>;
  onRequestPermission: () => Promise<unknown>;
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
  sharedStream: MediaStream | null;
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
  const vadState = getVadState(snapshot, t);

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
        processing={!recording && snapshot.status.downloading}
        mode="static"
        centerStaticBars
        barWidth={2.5}
        barGap={1.5}
        barRadius={1.5}
        fadeEdges
        fadeWidth={20}
        height={72}
        className="w-full"
        requireSharedStream={recording}
        sharedStream={sharedStream}
      />

      {snapshot.status.downloading && (
        <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] shadow-[var(--shadow-raised-sm)] px-3.5 py-3">
          <p className="text-xs font-semibold tracking-tight text-[color:var(--foreground)]">
            {t("modelDownloadTitle")}
          </p>
          <p className="mt-1 text-[11px] leading-5 text-[color:var(--muted)]">
            {snapshot.status.downloadMessage || t("modelDownloadPreparing")}
          </p>
          {snapshot.status.downloadProgress !== null && (
            <p className="mt-1 text-[11px] leading-5 text-[color:var(--foreground)]">
              {t("modelDownloadProgress", { percent: snapshot.status.downloadProgress })}
            </p>
          )}
        </div>
      )}

      {!snapshot.status.ffmpegAvailable && (
        <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] shadow-[var(--shadow-raised-sm)] px-3.5 py-3">
          <p className="text-xs font-semibold tracking-tight text-[color:var(--foreground)]">
            {t("ffmpegRequiredTitle")}
          </p>
          <p className="mt-1 text-[11px] leading-5 text-[color:var(--muted)]">
            {t("ffmpegRequiredDescription")}
          </p>
        </div>
      )}

      {/* Metrics */}
      <div className="metric-stack">
        <div className="metric-cell">
          <Mic className="h-3 w-3 shrink-0 text-[color:var(--accent)]" />
          <div className="metric-label-compact">{t("metricDevice")}</div>
          <strong className="metric-value-compact ml-auto truncate text-right">
            {snapshot.status.deviceLabel}
          </strong>
        </div>
        <div className="metric-row-inner">
          <div className="metric-cell">
            <Activity className="h-3 w-3 shrink-0 text-[color:var(--accent)]" />
            <div className="metric-label-compact">{t("metricLevel")}</div>
            <strong className="metric-value-compact ml-auto">
              {snapshot.status.db.toFixed(1)} dB
            </strong>
          </div>
          <div className="metric-cell">
            <div className="status-dot shrink-0" data-tone={vadState.tone} />
            <div className="metric-label-compact">{t("metricVad")}</div>
            <strong className="metric-value-compact ml-auto">{vadState.label}</strong>
          </div>
        </div>
      </div>

      {/* Permission banner (only when needed) */}
      {snapshot.permission.state !== "authorized" && (
        <div className="flex items-center gap-2.5 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] shadow-[var(--shadow-raised-sm)] px-3.5 py-3">
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

      <section className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] shadow-[var(--shadow-raised-sm)] px-3.5 py-3">
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
          <div className="mt-2 grid gap-1.5">
            {preview && (
              <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--panel)] px-2.5 py-2">
                <div className="flex items-start gap-2">
                  <span className="shrink-0 rounded-full bg-[color:var(--surface-soft)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-[color:var(--muted)]">
                    {t("liveTranscriptCurrentSegment")}
                  </span>
                  <p className="min-w-0 flex-1 text-[11px] leading-5 text-[color:var(--foreground)]">
                    {preview}
                  </p>
                </div>
              </div>
            )}

            {history.map((item, index) => (
              <div
                key={`${index}-${item}`}
                className="flex items-start gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-soft)] px-2.5 py-1.5"
              >
                {index === 0 ? (
                  <span className="mt-0.5 shrink-0 rounded-full bg-[color:var(--panel)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-[color:var(--muted)]">
                    {t("liveTranscriptRecent")}
                  </span>
                ) : (
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[color:var(--muted)]/60" />
                )}
                <p className="min-w-0 flex-1 text-[11px] leading-5 text-[color:var(--foreground)]">
                  {item}
                </p>
              </div>
            ))}
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

function getVadState(snapshot: DesktopSnapshot, t: ReturnType<typeof createT>) {
  if (!snapshot.status.recording) {
    return { label: t("vadNotStarted"), tone: "idle" as const };
  }
  if (snapshot.status.inSpeech) {
    return { label: t("vadSpeech"), tone: "recording" as const };
  }
  return { label: t("vadSilence"), tone: "idle" as const };
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
