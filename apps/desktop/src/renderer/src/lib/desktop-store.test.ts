import { describe, expect, it } from "vitest";
import { statusTone } from "./status-tone";

describe("statusTone", () => {
  it("maps recording status to tone", () => {
    expect(
      statusTone({
        asrEnabled: true,
        asrHistory: [],
        asrPreview: "",
        autoSwitchEnabled: true,
        db: -80,
        deviceLabel: "default",
        elapsed: "00:00:01",
        error: null,
        inSpeech: false,
        levelRatio: 0,
        recording: true,
        rms: 0,
        statusMessage: "",
        waveformBins: []
      })
    ).toBe("recording");
  });
});
