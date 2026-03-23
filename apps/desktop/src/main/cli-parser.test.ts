import { describe, expect, it } from "vitest";
import { parseCliCommand } from "./cli-parser";

describe("parseCliCommand", () => {
  it("parses open and status commands", () => {
    expect(parseCliCommand(["open"])).toEqual({ kind: "open" });
    expect(parseCliCommand(["status"])).toEqual({ kind: "status" });
  });

  it("parses record commands", () => {
    expect(parseCliCommand(["record", "start"])).toEqual({ kind: "record-start" });
    expect(parseCliCommand(["record", "stop"])).toEqual({ kind: "record-stop" });
  });

  it("parses transcribe options", () => {
    expect(
      parseCliCommand([
        "transcribe",
        "run",
        "--input-dir",
        "/tmp/audio",
        "--force",
        "--limit",
        "4"
      ])
    ).toEqual({
      force: true,
      inputDir: "/tmp/audio",
      kind: "transcribe-run",
      limit: 4
    });
  });

  it("returns null for unknown commands", () => {
    expect(parseCliCommand(["wat"])).toBeNull();
  });
});
