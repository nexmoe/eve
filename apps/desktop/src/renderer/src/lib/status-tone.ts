import type { RecorderStatusSnapshot } from "@eve/shared";

export const statusTone = (
  status: RecorderStatusSnapshot
): "idle" | "recording" => {
  return status.recording ? "recording" : "idle";
};
