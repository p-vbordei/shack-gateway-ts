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
});
