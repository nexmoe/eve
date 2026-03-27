import type { AppSettings, DesktopSnapshot } from "@eve/shared";
import { desktopActions } from "@/lib/desktop-store";
import { RecordingHistory } from "@/components/recording-history";
import { createT } from "@/lib/i18n";
import {
  GeneralTab,
  InputTab,
  TranscribeTab,
  buildSettingsOptions
} from "@/components/settings-tab-panels";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function SettingsTabs({ snapshot }: { snapshot: DesktopSnapshot }) {
  const draft = snapshot.settings;
  const t = createT(draft.desktop.language);
  const options = buildSettingsOptions(snapshot, t);

  const saveSettings = (nextSettings: AppSettings) => {
    void desktopActions.saveSettings(nextSettings);
  };

  const updateDesktop = (patch: Partial<AppSettings["desktop"]>) => {
    saveSettings({ ...draft, desktop: { ...draft.desktop, ...patch } });
  };

  const updateRecording = (patch: Partial<AppSettings["recording"]>) => {
    saveSettings({ ...draft, recording: { ...draft.recording, ...patch } });
  };

  const updateTranscribe = (patch: Partial<AppSettings["transcribe"]>) => {
    saveSettings({ ...draft, transcribe: { ...draft.transcribe, ...patch } });
  };

  return (
    <Tabs className="space-y-3" defaultValue="history">
      <TabsList className="grid-cols-4">
        <TabsTrigger value="history">{t("settingsTabHistory")}</TabsTrigger>
        <TabsTrigger value="general">{t("settingsTabGeneral")}</TabsTrigger>
        <TabsTrigger value="input">{t("settingsTabInput")}</TabsTrigger>
        <TabsTrigger value="transcribe">{t("settingsTabTranscribe")}</TabsTrigger>
      </TabsList>

      <TabsContent value="history">
        <RecordingHistory items={snapshot.history} language={draft.desktop.language} />
      </TabsContent>

      <TabsContent value="general">
        <GeneralTab
          options={options}
          settings={draft}
          t={t}
          updateDesktop={updateDesktop}
          updateRecording={updateRecording}
        />
      </TabsContent>

      <TabsContent value="input">
        <InputTab options={options} settings={draft} t={t} updateRecording={updateRecording} />
      </TabsContent>

      <TabsContent value="transcribe">
        <TranscribeTab
          options={options}
          settings={draft}
          snapshot={snapshot}
          t={t}
          updateRecording={updateRecording}
          updateTranscribe={updateTranscribe}
        />
      </TabsContent>
    </Tabs>
  );
}
