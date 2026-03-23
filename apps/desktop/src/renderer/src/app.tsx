import { useDesktopSnapshot, desktopActions } from "@/lib/desktop-store";
import { ScrollArea } from "@/components/ui/scroll-area";
import { StatusOverview } from "@/components/status-overview";
import { SettingsTabs } from "@/components/settings-tabs";
import { ToastViewport } from "@/components/ui/toast";

export function App() {
  const snapshot = useDesktopSnapshot();

  return (
    <main className="h-screen text-[color:var(--foreground)]">
      {/* Draggable title bar region for frameless window */}
      <div className="drag-region" />
      <ToastViewport />

      <ScrollArea className="h-screen w-full">
        <div className="tray-panel min-w-0 max-w-full overflow-x-hidden">
          <div className="panel-section">
            <StatusOverview
              onTogglePinned={desktopActions.setWindowPinned}
              onOpenPrivacy={desktopActions.openMicrophoneSettings}
              onRequestPermission={desktopActions.requestPermission}
              onStart={desktopActions.startRecording}
              onStop={desktopActions.stopRecording}
              snapshot={snapshot}
            />
          </div>
          <div className="panel-section">
            <SettingsTabs snapshot={snapshot} />
          </div>
        </div>
      </ScrollArea>
    </main>
  );
}
