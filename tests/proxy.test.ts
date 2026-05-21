import { describe, test, expect } from "@jest/globals";
import { execFileSync } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function writeTempConfig(): string {
  const workspace = tmpdir();
  const data = JSON.stringify({
    workspace_root: workspace,
    expose_mode: "progressive",
    servers: {},
  });
  const path = join(tmpdir(), `shack_ts_e2e_${process.pid}.json`);
  writeFileSync(path, data);
  return path;
}

function runGateway(configPath: string, requests: unknown[]): unknown[] {
  const entrypoint = join(__dirname, "../dist/main.js");
  const input = requests.map((r) => JSON.stringify(r)).join("\n") + "\n";
  const result = execFileSync(process.execPath, [entrypoint, "--config", configPath], {
    input,
    timeout: 15000,
    stdio: ["pipe", "pipe", "pipe"],
  });
  return result
    .toString()
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

function findById(responses: unknown[], id: number): Record<string, unknown> {
  const resp = (responses as Array<Record<string, unknown>>).find((r) => r["id"] === id);
  if (!resp) throw new Error(`No response for id=${id}`);
  return resp;
}

describe("Gateway e2e (over stdio)", () => {
  test("initialize returns protocol version and server info", () => {
    const config = writeTempConfig();
    try {
      const responses = runGateway(config, [
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "test", version: "0" },
          },
        },
      ]);
      const resp = findById(responses, 1);
      expect(resp["error"]).toBeUndefined();
      const result = resp["result"] as Record<string, unknown>;
      expect(result["protocolVersion"]).toBe("2024-11-05");
      const serverInfo = result["serverInfo"] as Record<string, unknown>;
      expect(serverInfo["name"]).toBe("shack-gateway");
    } finally {
      unlinkSync(config);
    }
  });

  test("tools/list returns four shack meta-tools", () => {
    const config = writeTempConfig();
    try {
      const responses = runGateway(config, [
        { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      ]);
      const resp = findById(responses, 2);
      expect(resp["error"]).toBeUndefined();
      const result = resp["result"] as Record<string, unknown>;
      const tools = result["tools"] as Array<{ name: string }>;
      expect(tools).toHaveLength(4);
      const names = tools.map((t) => t.name);
      expect(names).toContain("shack_list_tools");
      expect(names).toContain("shack_describe_tool");
      expect(names).toContain("shack_call_tool");
      expect(names).toContain("shack_list_servers");
    } finally {
      unlinkSync(config);
    }
  });

  test("tools/call shack_list_servers succeeds", () => {
    const config = writeTempConfig();
    try {
      const responses = runGateway(config, [
        {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "shack_list_servers", arguments: {} },
        },
      ]);
      const resp = findById(responses, 3);
      expect(resp["error"]).toBeUndefined();
      const result = resp["result"] as Record<string, unknown>;
      const content = result["content"] as Array<{ type: string; text: string }>;
      expect(content.length).toBeGreaterThan(0);
      const parsed = JSON.parse(content[0].text);
      expect(parsed).toHaveProperty("servers");
    } finally {
      unlinkSync(config);
    }
  });

  test("unknown method returns method-not-found error", () => {
    const config = writeTempConfig();
    try {
      const responses = runGateway(config, [
        { jsonrpc: "2.0", id: 4, method: "completely/unknown", params: {} },
      ]);
      const resp = findById(responses, 4);
      const err = resp["error"] as Record<string, unknown>;
      expect(err["code"]).toBe(-32601);
    } finally {
      unlinkSync(config);
    }
  });
});
