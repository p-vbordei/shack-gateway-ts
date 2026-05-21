#!/usr/bin/env node
/**
 * Entry point: reads JSON-RPC from stdin, writes responses to stdout.
 * All logs go to stderr; stdout carries only JSON-RPC protocol messages.
 */

import { createInterface } from "readline";
import { loadConfig } from "./config.js";
import { McpGatewayProxy } from "./proxy.js";

function parseArgs(): { config: string } {
  const args = process.argv.slice(2);
  let config = "shack-config.json";
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === "--config" || args[i] === "-c") && args[i + 1]) {
      config = args[i + 1];
      i++;
    }
  }
  return { config };
}

async function main(): Promise<void> {
  const { config: configPath } = parseArgs();

  process.stderr.write(
    `[shack-gateway] loading gateway configuration from '${configPath}'\n`,
  );

  let config;
  try {
    config = loadConfig(configPath);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`[shack-gateway] ${msg}\n`);
    process.exit(1);
  }

  let gateway: McpGatewayProxy;
  try {
    gateway = await McpGatewayProxy.init(config);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`[shack-gateway] gateway initialization failed: ${msg}\n`);
    process.exit(1);
  }

  process.stderr.write(
    "[shack-gateway] shack-gateway is ready; serving client requests on stdio\n",
  );

  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const pending: Promise<void>[] = [];

  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    // Each request is processed independently so slow downstream calls never
    // block unrelated requests.
    const task = (async () => {
      let req: Record<string, unknown>;
      try {
        req = JSON.parse(trimmed) as Record<string, unknown>;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        const errResp = {
          jsonrpc: "2.0",
          error: { code: -32700, message: `parse error: ${msg}` },
          id: null,
        };
        process.stdout.write(JSON.stringify(errResp) + "\n");
        return;
      }

      const response = await gateway.handleClientRequest(req);
      if (response !== null) {
        process.stdout.write(JSON.stringify(response) + "\n");
      }
    })();

    pending.push(task);
  });

  await new Promise<void>((resolve) => rl.on("close", resolve));

  // Drain in-flight handlers before exiting.
  await Promise.allSettled(pending);

  process.stderr.write("[shack-gateway] shack-gateway shut down cleanly\n");
}

main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  process.stderr.write(`[shack-gateway] fatal error: ${msg}\n`);
  process.exit(1);
});
