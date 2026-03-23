export type ParsedCliCommand =
  | { kind: "open" }
  | { kind: "status" }
  | { kind: "record-start" }
  | { kind: "record-stop" }
  | {
      force: boolean;
      inputDir?: string;
      kind: "transcribe-run";
      limit?: number;
    };

export const parseCliCommand = (args: string[]): ParsedCliCommand | null => {
  const [command, subcommand, ...rest] = args;
  if (command === "open") {
    return { kind: "open" };
  }
  if (command === "status") {
    return { kind: "status" };
  }
  if (command === "record" && subcommand === "start") {
    return { kind: "record-start" };
  }
  if (command === "record" && subcommand === "stop") {
    return { kind: "record-stop" };
  }
  if (command === "transcribe" && subcommand === "run") {
    const inputDirIndex = rest.indexOf("--input-dir");
    const limitIndex = rest.indexOf("--limit");
    return {
      force: rest.includes("--force"),
      inputDir: inputDirIndex >= 0 ? rest[inputDirIndex + 1] : undefined,
      kind: "transcribe-run",
      limit: limitIndex >= 0 ? Number.parseInt(rest[limitIndex + 1] ?? "0", 10) : undefined
    };
  }
  return null;
};
