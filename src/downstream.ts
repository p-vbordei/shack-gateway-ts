/**
 * Downstream MCP server client: spawns and multiplexes over stdio.
 */

import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import { createInterface } from "readline";
import type { ServerConfig } from "./config.js";

function idToString(id: unknown): string {
  if (typeof id === "string") return id;
  if (typeof id === "number") return String(id);
  return JSON.stringify(id);
}

interface PendingEntry {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class DownstreamClient {
  readonly name: string;
  private proc: ChildProcessWithoutNullStreams;
  private timeout: number;
  private alive = true;
  private pending: Map<string, PendingEntry> = new Map();

  private constructor(
    name: string,
    proc: ChildProcessWithoutNullStreams,
    timeout: number,
  ) {
    this.name = name;
    this.proc = proc;
    this.timeout = timeout;
  }

  static spawn(name: string, config: ServerConfig, timeoutMs: number): DownstreamClient {
    const env = { ...process.env, ...config.env };
    const proc = spawn(config.command, config.args, {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams;

    const client = new DownstreamClient(name, proc, timeoutMs);

    // Route stdout lines to pending requests.
    const rl = createInterface({ input: proc.stdout, crlfDelay: Infinity });
    rl.on("line", (line) => {
      if (!line.trim()) return;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(line) as Record<string, unknown>;
      } catch {
        return;
      }
      if (msg["id"] !== undefined && msg["id"] !== null) {
        const key = idToString(msg["id"]);
        const entry = client.pending.get(key);
        if (entry) {
          clearTimeout(entry.timer);
          client.pending.delete(key);
          entry.resolve(msg);
        }
      }
    });
    rl.on("close", () => {
      client.alive = false;
      process.stderr.write(`[shack-gateway] downstream server '${name}' closed its output stream\n`);
      for (const [, entry] of client.pending) {
        clearTimeout(entry.timer);
        entry.reject(new Error(`downstream server '${name}' closed before responding`));
      }
      client.pending.clear();
    });

    // Forward downstream stderr to our stderr.
    const errRl = createInterface({ input: proc.stderr, crlfDelay: Infinity });
    errRl.on("line", (line) => {
      process.stderr.write(`[${name} stderr] ${line}\n`);
    });

    return client;
  }

  isAlive(): boolean {
    return this.alive;
  }

  sendRequest(method: string, params: unknown, id: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.alive) {
        reject(new Error(`downstream server '${this.name}' is not available`));
        return;
      }

      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            `downstream server '${this.name}' timed out after ${this.timeout / 1000}s`,
          ),
        );
      }, this.timeout);

      this.pending.set(id, { resolve, reject, timer });

      const req = { jsonrpc: "2.0", method, params, id };
      this.writeLine(req).catch((err: unknown) => {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });
  }

  async notify(method: string, params: unknown): Promise<void> {
    const notif = { jsonrpc: "2.0", method, params };
    await this.writeLine(notif);
  }

  private writeLine(message: unknown): Promise<void> {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(message) + "\n";
      this.proc.stdin.write(payload, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}
