/**
 * Declarative permission policy engine.
 */

import type { PermissionConfig, DefaultDecision } from "./config.js";

const PERMISSION_SUBJECT_KEYS = [
  "command",
  "path",
  "file_path",
  "filePath",
  "notebook_path",
  "notebookPath",
  "url",
  "pattern",
  "query",
  "code",
  "message",
];

function extractPermissionSubject(inputJson: string): string | null {
  try {
    const parsed = JSON.parse(inputJson);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      for (const key of PERMISSION_SUBJECT_KEYS) {
        const val = (parsed as Record<string, unknown>)[key];
        if (typeof val === "string") return val;
      }
    }
  } catch {
    // fall through
  }
  const stripped = inputJson.trim();
  return stripped || null;
}

export type MatcherKind = "any" | "exact" | "prefix";

export interface PermissionRule {
  raw: string;
  toolName: string;
  matcherKind: MatcherKind;
  matcherValue: string;
}

export function parseRule(raw: string): PermissionRule {
  const trimmed = raw.trim();
  const openIdx = trimmed.indexOf("(");
  const closeIdx = trimmed.lastIndexOf(")");
  if (openIdx !== -1 && closeIdx === trimmed.length - 1 && openIdx < closeIdx) {
    const toolName = trimmed.slice(0, openIdx).trim();
    const content = trimmed.slice(openIdx + 1, closeIdx).trim();
    if (!content || content === "*") {
      return { raw: trimmed, toolName, matcherKind: "any", matcherValue: "" };
    } else if (content.endsWith(":*")) {
      return {
        raw: trimmed,
        toolName,
        matcherKind: "prefix",
        matcherValue: content.slice(0, -2),
      };
    } else {
      return { raw: trimmed, toolName, matcherKind: "exact", matcherValue: content };
    }
  }
  return { raw: trimmed, toolName: trimmed, matcherKind: "any", matcherValue: "" };
}

function ruleMatches(rule: PermissionRule, toolName: string, inputJson: string): boolean {
  if (rule.toolName !== toolName) return false;
  const subject = extractPermissionSubject(inputJson);
  if (subject === null) return false;
  switch (rule.matcherKind) {
    case "any":
      return true;
    case "exact":
      return subject === rule.matcherValue;
    case "prefix":
      return subject.startsWith(rule.matcherValue);
  }
}

export type Decision =
  | { kind: "allow" }
  | { kind: "deny"; reason: string }
  | { kind: "prompt"; reason: string };

export class PermissionEngine {
  private defaultDecision: DefaultDecision;
  private allow: PermissionRule[];
  private deny: PermissionRule[];

  constructor(config: PermissionConfig) {
    this.defaultDecision = config.default_decision;
    this.allow = config.allow.map(parseRule);
    this.deny = config.deny.map(parseRule);
  }

  evaluate(toolName: string, inputJson: string): Decision {
    for (const rule of this.deny) {
      if (ruleMatches(rule, toolName, inputJson)) {
        return { kind: "deny", reason: `matched deny rule '${rule.raw}'` };
      }
    }
    for (const rule of this.allow) {
      if (ruleMatches(rule, toolName, inputJson)) {
        return { kind: "allow" };
      }
    }
    switch (this.defaultDecision) {
      case "allow":
        return { kind: "allow" };
      case "deny":
        return { kind: "deny", reason: "no matching allow rule (default policy is deny)" };
      case "prompt":
        return { kind: "prompt", reason: "tool call requires explicit approval" };
    }
  }
}
