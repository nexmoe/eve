import { type DesktopSnapshot, type DeviceInfo } from "@eve/shared";
import { useEffect, useRef } from "react";

type Props = {
  onStreamChange: (stream: MediaStream | null) => void;
  snapshot: DesktopSnapshot;
};

type ProbeResult = {
  deviceId: string;
  label: string;
  rms: number;
};

const PROCESSOR_BUFFER_SIZE = 4096;
const AUTO_SWITCH_SCAN_SECONDS = 3;
const AUTO_SWITCH_PROBE_SECONDS = 0.25;
const AUTO_SWITCH_MAX_CANDIDATES = 2;
const AUTO_SWITCH_MIN_RMS = 0.006;
const AUTO_SWITCH_MIN_RATIO = 1.8;
const AUTO_SWITCH_COOLDOWN_SECONDS = 8;

const toDeviceLabel = (device: MediaDeviceInfo, index: number) => {
  return device.label.trim() || `Microphone ${index + 1}`;
};

const buildDeviceList = async (): Promise<DeviceInfo[]> => {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((device) => device.kind === "audioinput")
    .map((device, index) => ({
      id: device.deviceId,
      index,
      isDefault: index === 0,
      label: toDeviceLabel(device, index)
    }));
};

const computeRms = (samples: Float32Array) => {
  if (samples.length === 0) {
    return 0;
  }
  let total = 0;
  for (const sample of samples) {
    total += sample * sample;
  }
  return Math.sqrt(total / samples.length);
};

export function CaptureController({ onStreamChange, snapshot }: Props) {
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const currentDeviceIdRef = useRef<string>("default");
  const currentLabelRef = useRef<string>("default");
  const currentRmsRef = useRef<number>(0);
  const lastSwitchAtRef = useRef<number>(0);
  const winsRef = useRef(new Map<string, number>());

  const stopCapture = () => {
    processorRef.current?.disconnect();
    processorRef.current = null;
    if (contextRef.current && contextRef.current.state !== "closed") {
      void contextRef.current.close();
    }
    contextRef.current = null;
    streamRef.current?.getTracks().forEach((track) => {
      track.stop();
    });
    streamRef.current = null;
    currentRmsRef.current = 0;
    onStreamChange(null);
  };

  const startCapture = async (deviceId: string) => {
    stopCapture();
    const constraints: MediaStreamConstraints = {
      audio: {
        autoGainControl: true,
        channelCount: 1,
        deviceId: deviceId === "default" ? undefined : { exact: deviceId },
        echoCancellation: true,
        noiseSuppression: true
      }
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    const trackSettings = stream.getAudioTracks()[0]?.getSettings();
    currentDeviceIdRef.current = deviceId;
    currentLabelRef.current =
      trackSettings?.deviceId && trackSettings.deviceId.length > 0
        ? snapshot.devices.find((item) => item.id === trackSettings.deviceId)?.label ?? deviceId
        : snapshot.devices.find((item) => item.id === deviceId)?.label ?? "System default";
    streamRef.current = stream;
    onStreamChange(stream);

    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(PROCESSOR_BUFFER_SIZE, 1, 1);
    processor.onaudioprocess = (event) => {
      // getChannelData returns a view into a buffer that is reused across
      // callbacks.  We must copy before handing to pushAudioChunk because the
      // preload bridge will read the buffer asynchronously.
      const input = event.inputBuffer.getChannelData(0);
      const rms = computeRms(input);
      currentRmsRef.current = rms;
      // Copy into a fresh Float32Array – pushAudioChunk will slice the
      // underlying ArrayBuffer for IPC transfer.
      const samples = new Float32Array(input);
      window.eve.pushAudioChunk({
        deviceId: currentDeviceIdRef.current,
        deviceLabel: currentLabelRef.current,
        rms,
        sampleRate: event.inputBuffer.sampleRate,
        samples
      });
    };
    source.connect(processor);
    processor.connect(audioContext.destination);
    contextRef.current = audioContext;
    processorRef.current = processor;
  };

  useEffect(() => {
    let cancelled = false;

    const syncDevices = async () => {
      const devices = await buildDeviceList();
      if (cancelled) {
        return;
      }
      await window.eve.updateDevices(devices);
    };

    void syncDevices();
    const handler = () => {
      void syncDevices();
    };
    navigator.mediaDevices.addEventListener("devicechange", handler);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener("devicechange", handler);
    };
  }, []);

  useEffect(() => {
    if (!snapshot.status.recording) {
      stopCapture();
      return;
    }
    void startCapture(snapshot.settings.recording.device).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Microphone capture failed.";
      void window.eve.captureError(message);
    });
    return () => {
      stopCapture();
    };
  }, [snapshot.settings.recording.device, snapshot.status.recording]);

  useEffect(() => {
    if (!snapshot.status.recording || !snapshot.settings.recording.autoSwitchDevice) {
      return;
    }
    const ignoredKeywords = snapshot.settings.recording.excludeDeviceKeywords
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);

    const probeDevice = async (device: DeviceInfo): Promise<ProbeResult | null> => {
      let stream: MediaStream | null = null;
      let context: AudioContext | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            deviceId: { exact: device.id },
            echoCancellation: false,
            noiseSuppression: false
          }
        });
        context = new AudioContext();
        const analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        const source = context.createMediaStreamSource(stream);
        source.connect(analyser);
        await new Promise((resolve) => {
          window.setTimeout(resolve, AUTO_SWITCH_PROBE_SECONDS * 1000);
        });
        const samples = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(samples);
        return { deviceId: device.id, label: device.label, rms: computeRms(samples) };
      } catch {
        return null;
      } finally {
        stream?.getTracks().forEach((track) => track.stop());
        if (context && context.state !== "closed") {
          void context.close();
        }
      }
    };

    const interval = window.setInterval(() => {
      void (async () => {
        const candidates = snapshot.devices
          .filter((device) => device.id !== currentDeviceIdRef.current)
          .filter((device) => {
            const lower = device.label.toLowerCase();
            return !ignoredKeywords.some((keyword) => lower.includes(keyword));
          })
          .slice(0, AUTO_SWITCH_MAX_CANDIDATES);
        let best: ProbeResult | null = null;
        for (const device of candidates) {
          const result = await probeDevice(device);
          if (!result) {
            continue;
          }
          if (!best || result.rms > best.rms) {
            best = result;
          }
        }
        if (!best) {
          return;
        }
        const ratio = currentRmsRef.current > 0 ? best.rms / currentRmsRef.current : Number.POSITIVE_INFINITY;
        const previousWins = winsRef.current.get(best.deviceId) ?? 0;
        const nextWins =
          best.rms >= AUTO_SWITCH_MIN_RMS &&
          ratio >= AUTO_SWITCH_MIN_RATIO
            ? previousWins + 1
            : 0;
        winsRef.current.set(best.deviceId, nextWins);
        const cooldownElapsed =
          Date.now() - lastSwitchAtRef.current >=
          AUTO_SWITCH_COOLDOWN_SECONDS * 1000;
        if (cooldownElapsed && nextWins >= snapshot.settings.recording.autoSwitchConfirmations) {
          await startCapture(best.deviceId);
          winsRef.current.clear();
          lastSwitchAtRef.current = Date.now();
        }
      })();
    }, AUTO_SWITCH_SCAN_SECONDS * 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, [snapshot.devices, snapshot.settings.recording, snapshot.status.recording]);

  return null;
}
