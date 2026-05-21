/**
 * Pre/post tool-use hook runner.
 *
 * Hooks are user-supplied shell commands that run synchronously around every
 * downstream tool call. A *pre-tool hook* receives the tool name and arguments
 * on stdin as JSON and can allow, mutate, or block the call. A *post-tool hook*
 * receives the result and can reject it.
 *
 * Exit code 2 is the canonical block signal. Any other non-zero exit is
 * treated as an execution failure and also fails closed. A hook can emit a
 * `reason` string on stdout (JSON) or stderr to explain why it blocked.
 */

import { spawnSync } from "child_process";

export interface HookResponse {
  continue?: boolean;
  decision?: string;
  reason?: string;
  hookSpecificOutput?: {
    permissionDecision?: string;
    updatedInput?: unknown;
  };
}

function parseOrRaw(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return { raw: input };
  }
}

function invokeHook(cmdStr: string, payload: unknown): HookResponse | null {
  const result = spawnSync("sh", ["-c", cmdStr], {
    input: JSON.stringify(payload),
    encoding: "utf-8",
    timeout: 30000,
  });

  if (result.error) {
    throw new Error(`failed to spawn hook: ${result.error.message}`);
  }

  const exitCode = result.status ?? -1;
  const stderrStr = (result.stderr ?? "").toString().trim();
  const stdoutStr = (result.stdout ?? "").toString().trim();

  // Exit code 2 is the canonical block signal.
  if (exitCode === 2) {
    let reason: string | null = null;
    if (stdoutStr) {
      try {
        const parsed = JSON.parse(stdoutStr) as HookResponse;
        reason = parsed.reason ?? null;
      } catch {
        // ignore
      }
    }
    if (!reason && stderrStr) reason = stderrStr;
    if (!reason) reason = "blocked by hook (exit code 2)";
    throw new Error(reason);
  }

  if (exitCode !== 0) {
    throw new Error(`hook exited with code ${exitCode}: ${stderrStr}`);
  }

  if (!stdoutStr) return null;

  let resp: HookResponse;
  try {
    resp = JSON.parse(stdoutStr) as HookResponse;
  } catch {
    throw new Error(`invalid JSON on hook stdout: ${stdoutStr}`);
  }

  if (resp.continue === false || resp.decision === "block") {
    const reason = resp.reason ?? "blocked by hook";
    throw new Error(reason);
  }

  return resp;
}

export class HookRunner {
  private preCommand?: string;
  private postCommand?: string;

  constructor(preCommand?: string, postCommand?: string) {
    this.preCommand = preCommand;
    this.postCommand = postCommand;
  }

  /**
   * Returns [permissionDecision, finalInputJson].
   * Throws Error with reason if the hook blocks the call.
   */
  runPreToolUse(toolName: string, toolInput: string): [string | null, string] {
    if (!this.preCommand) return [null, toolInput];

    const payload = {
      hook_event_name: "PreToolUse",
      tool_name: toolName,
      tool_input: parseOrRaw(toolInput),
      tool_input_json: toolInput,
    };

    const resp = invokeHook(this.preCommand, payload);
    if (!resp) return [null, toolInput];

    let overrideDecision: string | null = null;
    let finalInput = toolInput;

    if (resp.hookSpecificOutput) {
      const dec = resp.hookSpecificOutput.permissionDecision;
      if (dec === "allow" || dec === "deny" || dec === "ask") {
        overrideDecision = dec;
      }
      if (resp.hookSpecificOutput.updatedInput !== undefined) {
        finalInput = JSON.stringify(resp.hookSpecificOutput.updatedInput);
      }
    }

    return [overrideDecision, finalInput];
  }

  /**
   * Throws Error with reason if the hook rejects the result.
   */
  runPostToolUse(
    toolName: string,
    toolInput: string,
    toolResult: unknown,
    resultIsError: boolean,
  ): void {
    if (!this.postCommand) return;

    const payload = {
      hook_event_name: "PostToolUse",
      tool_name: toolName,
      tool_input: parseOrRaw(toolInput),
      tool_response: toolResult,
      tool_result_is_error: resultIsError,
    };

    invokeHook(this.postCommand, payload);
  }
}
