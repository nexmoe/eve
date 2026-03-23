import type { ChangeEvent } from "react";
import type {
  AppLanguage,
  AppSettings,
  AudioFormat,
  DesktopSnapshot,
  ThemeMode
} from "@eve/shared";
import type { MessageKey } from "@/lib/i18n";
import { desktopActions } from "@/lib/desktop-store";
import { FolderOpen } from "lucide-react";
import { SettingField } from "@/components/setting-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

type Translator = (key: MessageKey, params?: Record<string, number | string>) => string;
type SelectOption<T extends string | number> = { label: string; value: T };

type TabProps = {
  options: ReturnType<typeof buildSettingsOptions>;
  settings: AppSettings;
  t: Translator;
};

export function GeneralTab({
  options,
  settings,
  t,
  updateDesktop,
  updateRecording
}: TabProps & {
  updateDesktop: (patch: Partial<AppSettings["desktop"]>) => void;
  updateRecording: (patch: Partial<AppSettings["recording"]>) => void;
}) {
  return (
    <div className="space-y-2">
      <SettingField
        control={<SelectField options={options.languageOptions} value={settings.desktop.language} onChange={(value) => updateDesktop({ language: value as AppLanguage })} />}
        description={t("languageDescription")}
        title={t("languageTitle")}
      />
      <SettingField
        control={<SelectField options={options.themeOptions} value={settings.desktop.theme} onChange={(value) => updateDesktop({ theme: value as ThemeMode })} />}
        description={t("themeDescription")}
        title={t("themeTitle")}
      />
      <SettingField
        control={<Switch checked={settings.desktop.launchAtLogin} onCheckedChange={(value: boolean) => updateDesktop({ launchAtLogin: value })} />}
        description={t("launchAtLoginDescription")}
        title={t("launchAtLoginTitle")}
      />
      <SettingField
        control={<Switch checked={settings.desktop.startRecordingOnLaunch} onCheckedChange={(value: boolean) => updateDesktop({ startRecordingOnLaunch: value })} />}
        description={t("startRecordingOnLaunchDescription")}
        title={t("startRecordingOnLaunchTitle")}
      />
      <SettingField
        control={
          <div className="flex min-w-0 max-w-full items-center gap-2">
            <div
              className="min-w-0 flex-1 break-all rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2 text-xs leading-5 text-[color:var(--foreground)]"
              title={settings.recording.outputDir}
            >
              {settings.recording.outputDir}
            </div>
            <Button
              className="w-8 shrink-0 px-0"
              size="sm"
              title={t("browseOutputDir")}
              variant="subtle"
              onClick={async () => {
                const selected = await desktopActions.pickDirectory(settings.recording.outputDir);
                if (selected) {
                  updateRecording({ outputDir: selected });
                }
              }}
            >
              <FolderOpen className="h-3.5 w-3.5" />
            </Button>
          </div>
        }
        description={t("outputDirDescription")}
        layout="stacked"
        title={t("outputDirTitle")}
      />
      <SettingField
        control={<SelectField options={options.audioFormatOptions} value={settings.recording.audioFormat} onChange={(value) => updateRecording({ audioFormat: value as AudioFormat })} />}
        description={t("audioFormatDescription")}
        title={t("audioFormatTitle")}
      />
      <SettingField
        control={<SelectNumberField options={options.segmentOptions} value={settings.recording.segmentMinutes} onChange={(value) => updateRecording({ segmentMinutes: value })} />}
        description={t("segmentMinutesDescription")}
        title={t("segmentMinutesTitle")}
      />
    </div>
  );
}

export function InputTab({
  options,
  settings,
  t,
  updateRecording
}: TabProps & {
  updateRecording: (patch: Partial<AppSettings["recording"]>) => void;
}) {
  return (
    <div className="space-y-2">
      <SettingField
        control={<SelectField options={options.deviceOptions} value={settings.recording.device} onChange={(value) => updateRecording({ device: value })} />}
        description={t("recordingDeviceDescription")}
        title={t("recordingDeviceTitle")}
      />
      <SettingField
        control={<Switch checked={settings.recording.autoSwitchDevice} onCheckedChange={(value: boolean) => updateRecording({ autoSwitchDevice: value })} />}
        description={t("autoSwitchDescription")}
        title={t("autoSwitchTitle")}
      />
      <SettingField
        control={<Input value={settings.recording.excludeDeviceKeywords} onChange={(event: ChangeEvent<HTMLInputElement>) => updateRecording({ excludeDeviceKeywords: event.currentTarget.value })} />}
        description={t("excludeDeviceKeywordsDescription")}
        layout="stacked"
        title={t("excludeDeviceKeywordsTitle")}
      />
    </div>
  );
}

export function TranscribeTab({
  options,
  settings,
  t,
  updateRecording,
  updateTranscribe
}: TabProps & {
  updateRecording: (patch: Partial<AppSettings["recording"]>) => void;
  updateTranscribe: (patch: Partial<AppSettings["transcribe"]>) => void;
}) {
  return (
    <div className="space-y-2">
      <SettingField control={<Switch checked={!settings.recording.disableAsr} onCheckedChange={(value: boolean) => updateRecording({ disableAsr: !value })} />} description={t("realtimeAsrDescription")} title={t("realtimeAsrTitle")} />
      <SettingField control={<SelectField options={options.realtimeModelOptions} value={settings.recording.asrModel} onChange={(value) => updateRecording({ asrModel: value })} />} description={t("realtimeModelDescription")} title={t("realtimeModelTitle")} />
      <SettingField control={<SelectField options={options.asrLanguageOptions} value={settings.recording.asrLanguage} onChange={(value) => updateRecording({ asrLanguage: value })} />} description={t("asrLanguageDescription")} title={t("asrLanguageTitle")} />
      <SettingField control={<SelectField options={options.inferenceDeviceOptions} value={settings.recording.asrDevice} onChange={(value) => updateRecording({ asrDevice: value })} />} description={t("inferenceDeviceDescription")} title={t("inferenceDeviceTitle")} />
      <SettingField control={<SelectField options={options.dtypeOptions} value={settings.recording.asrDtype} onChange={(value) => updateRecording({ asrDtype: value as AppSettings["recording"]["asrDtype"] })} />} description={t("inferenceDtypeDescription")} title={t("inferenceDtypeTitle")} />
      <SettingField control={<SelectNumberField options={options.batchSizeOptions} value={settings.recording.asrMaxBatchSize} onChange={(value) => updateRecording({ asrMaxBatchSize: value })} />} description={t("asrBatchSizeDescription")} title={t("asrBatchSizeTitle")} />
      <SettingField control={<SelectNumberField options={options.maxTokenOptions} value={settings.recording.asrMaxNewTokens} onChange={(value) => updateRecording({ asrMaxNewTokens: value })} />} description={t("asrMaxTokensDescription")} title={t("asrMaxTokensTitle")} />
      <SettingField control={<Switch checked={settings.transcribe.watch} onCheckedChange={(value: boolean) => updateTranscribe({ watch: value })} />} description={t("batchWatchDescription")} title={t("batchWatchTitle")} />
    </div>
  );
}

export function buildSettingsOptions(snapshot: DesktopSnapshot, t: Translator) {
  return {
    languageOptions: [
      { label: t("languageSystem"), value: "system" },
      { label: t("languageZhCn"), value: "zh-CN" },
      { label: t("languageEnUs"), value: "en-US" }
    ] satisfies SelectOption<AppLanguage>[],
    themeOptions: [
      { label: t("themeSystem"), value: "system" },
      { label: t("themeLight"), value: "light" },
      { label: t("themeDark"), value: "dark" }
    ] satisfies SelectOption<ThemeMode>[],
    audioFormatOptions: [
      { label: "FLAC", value: "flac" },
      { label: "WAV", value: "wav" }
    ] satisfies SelectOption<AudioFormat>[],
    deviceOptions: [
      { label: t("recordingDeviceDefault"), value: "default" },
      ...snapshot.devices.map((device) => ({
        label: device.isDefault ? `${device.label} (${t("recordingDeviceDefault")})` : device.label,
        value: device.id
      }))
    ] satisfies SelectOption<string>[],
    asrLanguageOptions: [
      { label: t("asrLanguageAuto"), value: "auto" },
      { label: t("languageNameChinese"), value: "zh" },
      { label: t("languageNameEnglish"), value: "en" },
      { label: t("languageNameJapanese"), value: "ja" },
      { label: t("languageNameKorean"), value: "ko" }
    ] satisfies SelectOption<string>[],
    realtimeModelOptions: [
      { label: "Qwen3-ASR 0.6B", value: "Qwen/Qwen3-ASR-0.6B" },
      { label: "Qwen3-ASR 4B", value: "Qwen/Qwen3-ASR-4B" }
    ] satisfies SelectOption<string>[],
    inferenceDeviceOptions: [
      { label: t("inferenceDeviceAuto"), value: "auto" },
      { label: t("inferenceDeviceCpu"), value: "cpu" },
      { label: t("inferenceDeviceMps"), value: "mps" },
      { label: t("inferenceDeviceCuda"), value: "cuda" }
    ] satisfies SelectOption<string>[],
    dtypeOptions: [
      { label: "auto", value: "auto" },
      { label: "float16", value: "float16" },
      { label: "float32", value: "float32" }
    ] satisfies SelectOption<AppSettings["recording"]["asrDtype"]>[],
    batchSizeOptions: numberOptions([1, 2, 4, 8]),
    maxTokenOptions: numberOptions([128, 256, 512, 1024]),
    segmentOptions: numberOptions([15, 30, 45, 60, 90, 120]),
    shortSecondsOptions: numberOptions([1, 2, 3, 5, 8, 10]),
    probeSecondsOptions: numberOptions([0.1, 0.25, 0.5, 1, 2]),
    hzOptions: numberOptions([2, 4, 8, 12, 24]),
    candidateOptions: numberOptions([1, 2, 3, 4, 5]),
    confirmationOptions: numberOptions([1, 2, 3, 4]),
    rmsOptions: numberOptions([0.003, 0.006, 0.01, 0.02]),
    ratioOptions: numberOptions([1.2, 1.5, 1.8, 2, 2.5]),
    limitOptions: numberOptions([0, 10, 25, 50, 100, 200])
  };
}

function SelectField<T extends string>({
  onChange,
  options,
  value
}: {
  onChange: (value: T) => void;
  options: SelectOption<T>[];
  value: T;
}) {
  return (
    <Select value={value} onValueChange={(nextValue) => onChange(nextValue as T)}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function SelectNumberField({
  onChange,
  options,
  value
}: {
  onChange: (value: number) => void;
  options: SelectOption<number>[];
  value: number;
}) {
  return (
    <Select value={String(value)} onValueChange={(nextValue) => onChange(Number(nextValue))}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={String(option.value)}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function numberOptions(values: number[]): SelectOption<number>[] {
  return values.map((value) => ({ label: String(value), value }));
}
