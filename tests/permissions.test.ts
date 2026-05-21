import { describe, test, expect } from "@jest/globals";
import { parseRule, PermissionEngine } from "../src/permissions.js";
import type { PermissionConfig } from "../src/config.js";

describe("parseRule", () => {
  test("parses prefix rule", () => {
    const rule = parseRule("bash(rm -rf:*)");
    expect(rule.toolName).toBe("bash");
    expect(rule.matcherKind).toBe("prefix");
    expect(rule.matcherValue).toBe("rm -rf");
  });

  test("parses wildcard rule", () => {
    const rule = parseRule("git(*)");
    expect(rule.toolName).toBe("git");
    expect(rule.matcherKind).toBe("any");
  });

  test("parses exact rule", () => {
    const rule = parseRule("git(checkout)");
    expect(rule.toolName).toBe("git");
    expect(rule.matcherKind).toBe("exact");
    expect(rule.matcherValue).toBe("checkout");
  });

  test("parses empty parens as any", () => {
    const rule = parseRule("bash()");
    expect(rule.toolName).toBe("bash");
    expect(rule.matcherKind).toBe("any");
  });

  test("rule without parens treated as any", () => {
    const rule = parseRule("fs__read");
    expect(rule.toolName).toBe("fs__read");
    expect(rule.matcherKind).toBe("any");
  });
});

describe("PermissionEngine", () => {
  test("deny rule wins over default allow", () => {
    const cfg: PermissionConfig = {
      default_decision: "allow",
      allow: [],
      deny: ["fs__write(rm -rf:*)"],
    };
    const engine = new PermissionEngine(cfg);
    const result = engine.evaluate("fs__write", '{"command": "rm -rf /"}');
    expect(result.kind).toBe("deny");

    const result2 = engine.evaluate("fs__write", '{"command": "ls"}');
    expect(result2.kind).toBe("allow");
  });

  test("default deny requires explicit allow", () => {
    const cfg: PermissionConfig = {
      default_decision: "deny",
      allow: ["fs__read(*)"],
      deny: [],
    };
    const engine = new PermissionEngine(cfg);
    expect(engine.evaluate("fs__read", '{"path": "a.txt"}').kind).toBe("allow");
    expect(engine.evaluate("fs__write", '{"path": "a.txt"}').kind).toBe("deny");
  });

  test("default prompt when unmatched", () => {
    const cfg: PermissionConfig = { default_decision: "prompt", allow: [], deny: [] };
    const engine = new PermissionEngine(cfg);
    expect(engine.evaluate("anything", '{"path": "a.txt"}').kind).toBe("prompt");
  });

  test("deny wins over allow for same pattern", () => {
    const cfg: PermissionConfig = {
      default_decision: "allow",
      allow: ["dangerous(*)"],
      deny: ["dangerous(*)"],
    };
    const engine = new PermissionEngine(cfg);
    expect(engine.evaluate("dangerous", '{"command": "x"}').kind).toBe("deny");
  });

  test("deny reason mentions the matched rule", () => {
    const cfg: PermissionConfig = {
      default_decision: "allow",
      allow: [],
      deny: ["fs__write(rm -rf:*)"],
    };
    const engine = new PermissionEngine(cfg);
    const result = engine.evaluate("fs__write", '{"command": "rm -rf /"}');
    expect(result.kind).toBe("deny");
    if (result.kind === "deny") {
      expect(result.reason).toContain("fs__write(rm -rf:*)");
    }
  });

  test("rule does not match different tool name", () => {
    const cfg: PermissionConfig = {
      default_decision: "deny",
      allow: ["git(*)"],
      deny: [],
    };
    const engine = new PermissionEngine(cfg);
    expect(engine.evaluate("bash", '{"command": "anything"}').kind).toBe("deny");
  });

  test("exact rule does not match different subject", () => {
    const cfg: PermissionConfig = {
      default_decision: "deny",
      allow: ["git(checkout)"],
      deny: [],
    };
    const engine = new PermissionEngine(cfg);
    expect(engine.evaluate("git", '{"command": "merge"}').kind).toBe("deny");
    expect(engine.evaluate("git", '{"command": "checkout"}').kind).toBe("allow");
  });

  test("url key is used as subject", () => {
    const cfg: PermissionConfig = {
      default_decision: "deny",
      allow: ["fetch(https://api.example.com:*)"],
      deny: [],
    };
    const engine = new PermissionEngine(cfg);
    expect(
      engine.evaluate("fetch", '{"url": "https://api.example.com/v1/data"}').kind,
    ).toBe("allow");
    expect(engine.evaluate("fetch", '{"url": "https://evil.com"}').kind).toBe("deny");
  });

  test("default deny reason is descriptive", () => {
    const cfg: PermissionConfig = { default_decision: "deny", allow: [], deny: [] };
    const engine = new PermissionEngine(cfg);
    const result = engine.evaluate("any_tool", '{"path": "x"}');
    expect(result.kind).toBe("deny");
    if (result.kind === "deny") {
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });
});
