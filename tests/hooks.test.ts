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
});
