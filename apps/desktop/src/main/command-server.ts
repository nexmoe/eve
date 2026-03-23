import { createConnection, createServer, type Server } from "node:net";
import { unlinkSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";

export interface CliCommand {
  args: string[];
}

export interface CliResponse {
  error?: string;
  ok: boolean;
  payload?: unknown;
}

export const getCliSocketPath = (): string => {
  if (process.platform === "win32") {
    return "\\\\.\\pipe\\eve-desktop-cli";
  }
  return join(app.getPath("userData"), "eve-cli.sock");
};

export const startCliServer = (
  handler: (command: CliCommand) => Promise<CliResponse>
): Promise<Server> => {
  const socketPath = getCliSocketPath();
  if (process.platform !== "win32") {
    try {
      unlinkSync(socketPath);
    } catch {
      // ignore
    }
  }
  return new Promise((resolve, reject) => {
    const server = createServer((socket) => {
      let raw = "";
      socket.on("data", (chunk) => {
        raw += chunk.toString("utf-8");
      });
      socket.on("end", () => {
        const payload = JSON.parse(raw) as CliCommand;
        void handler(payload).then((response) => {
          socket.write(JSON.stringify(response));
          socket.end();
        });
      });
    });
    server.once("error", reject);
    server.listen(socketPath, () => resolve(server));
  });
};

export const sendCliCommand = (command: CliCommand): Promise<CliResponse> => {
  const socketPath = getCliSocketPath();
  return new Promise((resolve, reject) => {
    const client = createConnection(socketPath, () => {
      client.write(JSON.stringify(command));
      client.end();
    });
    let raw = "";
    client.on("data", (chunk) => {
      raw += chunk.toString("utf-8");
    });
    client.on("end", () => {
      resolve(JSON.parse(raw) as CliResponse);
    });
    client.on("error", reject);
  });
};
