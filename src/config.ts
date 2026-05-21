/**
 * Gateway configuration loading and defaults.
 */

import { readFileSync } from "fs";

export const DEFAULT_REDACT_FIELDS: string[] = [
  "password",
  "passwd",
  "secret",
  "token",
  "access_token",
  "refresh_token",
  "api_key",
  "apikey",
  "authorization",
  "auth",
  "cookie",
  "private_key",
  "privatekey",
  "client_secret",
  "session_token",
  "credential",
  "credentials",
];

export type ExposeMode = "progressive" | "full";
export type DefaultDecision = "allow" | "deny" | "prompt";

export interface ServerConfig {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface PermissionConfig {
  default_decision: DefaultDecision;
  allow: string[];
  deny: string[];
}

export interface GatewayConfig {
  workspace_root: string;
  expose_mode: ExposeMode;
  pre_tool_hook?: string;
  post_tool_hook?: string;
  permissions: PermissionConfig;
  redact_fields: string[];
  request_timeout_secs: number;
  servers: Record<string, ServerConfig>;
}

export function loadConfig(path: string): GatewayConfig {
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`failed to read config '${path}': ${msg}`);
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`failed to parse config '${path}': ${msg}`);
  }

  if (typeof data["workspace_root"] !== "string") {
    throw new Error(`config '${path}' missing required field 'workspace_root'`);
  }

  const permsRaw = (data["permissions"] ?? {}) as Record<string, unknown>;
  const permissions: PermissionConfig = {
    default_decision: (permsRaw["default_decision"] as DefaultDecision) ?? "allow",
    allow: (permsRaw["allow"] as string[]) ?? [],
    deny: (permsRaw["deny"] as string[]) ?? [],
  };

  const serversRaw = (data["servers"] ?? {}) as Record<string, Record<string, unknown>>;
  const servers: Record<string, ServerConfig> = {};
  for (const [name, srv] of Object.entries(serversRaw)) {
    servers[name] = {
      command: srv["command"] as string,
      args: (srv["args"] as string[]) ?? [],
      env: (srv["env"] as Record<string, string>) ?? {},
    };
  }

  return {
    workspace_root: data["workspace_root"] as string,
    expose_mode: (data["expose_mode"] as ExposeMode) ?? "progressive",
    pre_tool_hook: data["pre_tool_hook"] as string | undefined,
    post_tool_hook: data["post_tool_hook"] as string | undefined,
    permissions,
    redact_fields: (data["redact_fields"] as string[]) ?? [...DEFAULT_REDACT_FIELDS],
    request_timeout_secs: Math.max(1, Number(data["request_timeout_secs"] ?? 30)),
    servers,
  };
}
