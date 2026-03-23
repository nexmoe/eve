import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { EventEmitter } from "node:events";
import type {
  AppSettings,
  DeviceInfo,
  SidecarEvent,
  SidecarRequest,
  SidecarResponse
} from "@eve/shared";
import { DEFAULT_STATUS, type RecorderStatusSnapshot } from "@eve/shared";
import { resolvePythonExecutable, resolveSidecarScriptPath } from "./sidecar-runtime";

type SidecarEventListener = (event: SidecarEvent) => void;

interface PendingRequest {
  reject: (error: Error) => void;
  resolve: (value: unknown) => void;
}

export class SidecarManager {
  private readonly emitter = new EventEmitter();
  private readonly pending = new Map<string, PendingRequest>();
  private process: ChildProcessWithoutNullStreams | null = null;
  private ready = false;
  private quitting = false;
  private restartDelayMs = 600;
  private settings: AppSettings | null = null;
  private status: RecorderStatusSnapshot = DEFAULT_STATUS;
  private stderrBuffer = "";

  async start(settings: AppSettings): Promise<void> {
    this.settings = settings;
    await this.spawnProcess();
    await this.request({ id: randomUUID(), method: "settings.apply", params: settings });
  }

  stop(): void {
    this.quitting = true;
    this.process?.kill();
    this.process = null;
  }

  getReady(): boolean {
    return this.ready;
  }

  getStatus(): RecorderStatusSnapshot {
    return this.status;
  }

  onEvent(listener: SidecarEventListener): () => void {
    this.emitter.on("event", listener);
    return () => {
      this.emitter.off("event", listener);
    };
  }

  async applySettings(settings: AppSettings): Promise<void> {
    this.settings = settings;
    await this.request({ id: randomUUID(), method: "settings.apply", params: settings });
  }

  async listDevices(): Promise<DeviceInfo[]> {
    return this.request({ id: randomUUID(), method: "devices.list" }) as Promise<DeviceInfo[]>;
  }

  async request(request: SidecarRequest): Promise<unknown> {
    if (!this.process) {
      throw new Error("Python sidecar is not running.");
    }
    const payload = JSON.stringify(request);
    return new Promise((resolve, reject) => {
      this.pending.set(request.id, { reject, resolve });
      this.process?.stdin.write(`${payload}\n`, (error) => {
        if (error) {
          this.pending.delete(request.id);
          reject(error);
        }
      });
    });
  }

  private async spawnProcess(): Promise<void> {
    this.stderrBuffer = "";
    const [pythonPath, scriptPath] = await Promise.all([
      resolvePythonExecutable(),
      resolveSidecarScriptPath()
    ]);
    this.process = spawn(pythonPath, [scriptPath], {
      cwd: process.cwd(),
      stdio: "pipe"
    });
    this.attachProcessListeners(this.process);
    await new Promise<void>((resolve, reject) => {
      const dispose = this.onEvent((event) => {
        if (event.type === "ready") {
          dispose();
          resolve();
        }
      });
      this.process?.once("error", reject);
      this.process?.once("exit", () => {
        if (!this.ready) {
          const detail = this.stderrBuffer.trim();
          reject(
            new Error(
              detail.length > 0
                ? `Python sidecar exited before ready: ${detail}`
                : "Python sidecar exited before ready."
            )
          );
        }
      });
    });
  }

  private attachProcessListeners(processRef: ChildProcessWithoutNullStreams): void {
    const lineReader = createInterface({ input: processRef.stdout });
    lineReader.on("line", (line) => {
      this.handleMessage(line);
    });
    processRef.stderr.on("data", (chunk) => {
      const message = chunk.toString("utf-8").trim();
      if (message.length > 0) {
        this.stderrBuffer = `${this.stderrBuffer}\n${message}`.trim();
      }
      this.emitEvent({
        type: "error",
        payload: { message }
      });
    });
    processRef.on("exit", (code, signal) => {
      this.ready = false;
      this.emitEvent({
        type: "exit",
        payload: {
          code,
          signal
        }
      });
      for (const [requestId, entry] of this.pending.entries()) {
        entry.reject(new Error("Python sidecar exited unexpectedly."));
        this.pending.delete(requestId);
      }
      if (!this.quitting) {
        const delay = this.restartDelayMs;
        this.restartDelayMs = Math.min(this.restartDelayMs * 2, 4_000);
        setTimeout(() => {
          void this.respawn();
        }, delay);
      }
    });
  }

  private async respawn(): Promise<void> {
    try {
      await this.spawnProcess();
      if (this.settings) {
        await this.request({
          id: randomUUID(),
          method: "settings.apply",
          params: this.settings
        });
      }
    } catch (error: unknown) {
      this.emitEvent({
        type: "error",
        payload: { message: String(error) }
      });
    }
  }

  private emitEvent(event: SidecarEvent): void {
    if (event.type === "status") {
      this.status = event.payload;
    }
    this.emitter.emit("event", event);
  }

  private handleMessage(line: string): void {
    let payload: SidecarEvent | SidecarResponse;
    try {
      payload = JSON.parse(line) as SidecarEvent | SidecarResponse;
    } catch {
      return;
    }
    if ("type" in payload) {
      if (payload.type === "ready") {
        this.ready = true;
        this.restartDelayMs = 600;
      }
      this.emitEvent(payload);
      return;
    }
    const pending = this.pending.get(payload.id);
    if (!pending) {
      return;
    }
    this.pending.delete(payload.id);
    if (payload.ok) {
      pending.resolve(payload.result);
      return;
    }
    pending.reject(new Error(payload.error));
  }
}
