import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import { writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { loadConfig, DEFAULT_REDACT_FIELDS } from "../src/config.js";

function writeTempConfig(data: unknown): string {
  const path = join(tmpdir(), `shack_cfg_test_${process.pid}_${Date.now()}.json`);
  writeFileSync(path, JSON.stringify(data));
  return path;
}

describe("loadConfig", () => {
  const paths: string[] = [];
  afterEach(() => {
    for (const p of paths) {
      try { unlinkSync(p); } catch { /* ignore */ }
    }
    paths.length = 0;
  });

  function tempConfig(data: unknown): string {
    const p = writeTempConfig(data);
    paths.push(p);
    return p;
  }

  test("defaults apply for minimal config", () => {
    const p = tempConfig({ workspace_root: tmpdir() });
    const cfg = loadConfig(p);
    expect(cfg.expose_mode).toBe("progressive");
    expect(cfg.permissions.default_decision).toBe("allow");
    expect(cfg.request_timeout_secs).toBe(30);
    expect(cfg.servers).toEqual({});
    expect(cfg.redact_fields.length).toBeGreaterThan(0);
  });

  test("explicit fields override defaults", () => {
    const p = tempConfig({
      workspace_root: tmpdir(),
      expose_mode: "full",
      permissions: { default_decision: "deny", deny: ["a__b(*)"] },
      request_timeout_secs: 5,
    });
    const cfg = loadConfig(p);
    expect(cfg.expose_mode).toBe("full");
    expect(cfg.permissions.default_decision).toBe("deny");
    expect(cfg.permissions.deny).toHaveLength(1);
    expect(cfg.request_timeout_secs).toBe(5);
  });

  test("server config parses command, args, env", () => {
    const p = tempConfig({
      workspace_root: tmpdir(),
      servers: {
        fs: { command: "node", args: ["dist/index.js", "--readonly"], env: { KEY: "val" } },
      },
    });
    const cfg = loadConfig(p);
    expect(cfg.servers["fs"]).toBeDefined();
    expect(cfg.servers["fs"].command).toBe("node");
    expect(cfg.servers["fs"].args).toEqual(["dist/index.js", "--readonly"]);
    expect(cfg.servers["fs"].env).toEqual({ KEY: "val" });
  });

  test("server config optional args and env default to empty", () => {
    const p = tempConfig({
      workspace_root: tmpdir(),
      servers: { bare: { command: "my_server" } },
    });
    const cfg = loadConfig(p);
    expect(cfg.servers["bare"].args).toEqual([]);
    expect(cfg.servers["bare"].env).toEqual({});
  });

  test("permission allow and deny rules parse correctly", () => {
    const p = tempConfig({
      workspace_root: tmpdir(),
      permissions: {
        default_decision: "prompt",
        allow: ["fs__read(*)", "db__query(select:*)"],
        deny: ["fs__write(rm -rf:*)"],
      },
    });
    const cfg = loadConfig(p);
    expect(cfg.permissions.default_decision).toBe("prompt");
    expect(cfg.permissions.allow).toHaveLength(2);
    expect(cfg.permissions.deny).toHaveLength(1);
  });

  test("missing file throws error with descriptive message", () => {
    expect(() => loadConfig("/nonexistent/shack_config_missing.json")).toThrow(
      "failed to read config",
    );
  });

  test("invalid JSON throws error with descriptive message", () => {
    const p = join(tmpdir(), `shack_invalid_${process.pid}.json`);
    writeFileSync(p, "not json at all");
    paths.push(p);
    expect(() => loadConfig(p)).toThrow("failed to parse config");
  });

  test("custom redact_fields overrides defaults", () => {
    const p = tempConfig({
      workspace_root: tmpdir(),
      redact_fields: ["my_secret", "custom_key"],
    });
    const cfg = loadConfig(p);
    expect(cfg.redact_fields).toEqual(["my_secret", "custom_key"]);
  });

  test("pre and post hook fields parse", () => {
    const p = tempConfig({
      workspace_root: tmpdir(),
      pre_tool_hook: "echo pre",
      post_tool_hook: "echo post",
    });
    const cfg = loadConfig(p);
    expect(cfg.pre_tool_hook).toBe("echo pre");
    expect(cfg.post_tool_hook).toBe("echo post");
  });

  test("request_timeout_secs minimum is 1", () => {
    const p = tempConfig({ workspace_root: tmpdir(), request_timeout_secs: 0 });
    const cfg = loadConfig(p);
    expect(cfg.request_timeout_secs).toBeGreaterThanOrEqual(1);
  });
});

describe("DEFAULT_REDACT_FIELDS", () => {
  test("contains common credential field names", () => {
    for (const name of ["password", "token", "secret", "api_key", "authorization"]) {
      expect(DEFAULT_REDACT_FIELDS).toContain(name);
    }
  });
});
