import { describe, test, expect } from "@jest/globals";
import { HookRunner } from "../src/hooks.js";

describe("HookRunner", () => {
  test("no hook configured is passthrough", () => {
    const runner = new HookRunner(undefined, undefined);
    const [decision, finalInput] = runner.runPreToolUse("git", '{"args": []}');
    expect(decision).toBeNull();
    expect(finalInput).toBe('{"args": []}');
    expect(() => runner.runPostToolUse("git", "{}", { ok: true }, false)).not.toThrow();
  });

  test("continue true is allowed", () => {
    const runner = new HookRunner("echo '{\"continue\": true}'", undefined);
    const [decision, finalInput] = runner.runPreToolUse("git", '{"args": []}');
    expect(decision).toBeNull();
    expect(finalInput).toBe('{"args": []}');
  });

  test("continue false blocks", () => {
    const runner = new HookRunner(
      `echo '{"continue": false, "reason": "blocked for testing"}'`,
      undefined,
    );
    expect(() => runner.runPreToolUse("git", "{}")).toThrow("blocked for testing");
  });

  test("exit code 2 with stderr blocks", () => {
    const runner = new HookRunner("echo 'dangerous' 1>&2; exit 2", undefined);
    expect(() => runner.runPreToolUse("bash", "{}")).toThrow("dangerous");
  });

  test("exit code 2 with no output still blocks", () => {
    const runner = new HookRunner("exit 2", undefined);
    expect(() => runner.runPreToolUse("bash", "{}")).toThrow("exit code 2");
  });

  test("updatedInput mutates arguments", () => {
    const runner = new HookRunner(
      `echo '{"continue": true, "hookSpecificOutput": {"permissionDecision": "allow", "updatedInput": {"args": ["custom"]}}}'`,
      undefined,
    );
    const [decision, finalInput] = runner.runPreToolUse("git", '{"args": []}');
    expect(decision).toBe("allow");
    expect(JSON.parse(finalInput)).toEqual({ args: ["custom"] });
  });

  test("post-tool hook can reject result", () => {
    const runner = new HookRunner(
      undefined,
      `echo '{"decision": "block", "reason": "leaked secret"}'`,
    );
    expect(() =>
      runner.runPostToolUse("fs__read", "{}", { content: "x" }, false),
    ).toThrow("leaked secret");
  });

  test("post hook none is passthrough", () => {
    const runner = new HookRunner("echo '{\"continue\": true}'", undefined);
    expect(() => runner.runPostToolUse("tool", "{}", { ok: 1 }, false)).not.toThrow();
  });

  test("nonzero exit code other than 2 is an error", () => {
    const runner = new HookRunner("exit 1", undefined);
    expect(() => runner.runPreToolUse("bash", "{}")).toThrow("hook exited with code");
  });

  test("deny permission decision surfaced", () => {
    const runner = new HookRunner(
      `echo '{"continue": true, "hookSpecificOutput": {"permissionDecision": "deny"}}'`,
      undefined,
    );
    const [decision] = runner.runPreToolUse("tool", "{}");
    expect(decision).toBe("deny");
  });

  test("ask permission decision surfaced", () => {
    const runner = new HookRunner(
      `echo '{"continue": true, "hookSpecificOutput": {"permissionDecision": "ask"}}'`,
      undefined,
    );
    const [decision] = runner.runPreToolUse("tool", "{}");
    expect(decision).toBe("ask");
  });

  test("exit code 2 with json reason on stdout uses that reason", () => {
    const runner = new HookRunner(
      `echo '{"reason": "custom block reason"}'; exit 2`,
      undefined,
    );
    expect(() => runner.runPreToolUse("bash", "{}")).toThrow("custom block reason");
  });

  test("invalid JSON stdout raises descriptive error", () => {
    const runner = new HookRunner("echo 'not json'", undefined);
    expect(() => runner.runPreToolUse("bash", "{}")).toThrow("invalid JSON");
  });
});
