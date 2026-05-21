/**
 * MCP gateway proxy: aggregates downstream servers, applies security pipeline.
 */

import type { GatewayConfig } from "./config.js";
import {
  ToolCatalog,
  isMetaTool,
  metaToolSchemas,
  META_LIST_TOOLS,
  META_DESCRIBE_TOOL,
  META_CALL_TOOL,
  META_LIST_SERVERS,
} from "./discovery.js";
import { DownstreamClient } from "./downstream.js";
import { HookRunner } from "./hooks.js";
import { PermissionEngine } from "./permissions.js";
import { Redactor } from "./redaction.js";
import { WorkspaceSandbox } from "./sandbox.js";

const PROTOCOL_VERSION = "2024-11-05";
const GATEWAY_NAME = "shack-gateway";
const GATEWAY_VERSION = "0.1.0";

type PipelineError = [number, string];

function success(id: unknown, result: unknown): Record<string, unknown> {
  return { jsonrpc: "2.0", result, id };
}

function error(id: unknown, code: number, message: string): Record<string, unknown> {
  return { jsonrpc: "2.0", error: { code, message }, id };
}

function textResult(value: unknown): unknown {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

export class McpGatewayProxy {
  private exposeMode: string;
  private clients: Map<string, DownstreamClient>;
  private catalog: ToolCatalog;
  private resources: unknown[];
  private resourceOwner: Map<string, string>;
  private sandbox: WorkspaceSandbox;
  private permissions: PermissionEngine;
  private hooks: HookRunner;
  private redactor: Redactor;
  private seq = 0;

  private constructor(
    exposeMode: string,
    clients: Map<string, DownstreamClient>,
    catalog: ToolCatalog,
    resources: unknown[],
    resourceOwner: Map<string, string>,
    sandbox: WorkspaceSandbox,
    permissions: PermissionEngine,
    hooks: HookRunner,
    redactor: Redactor,
  ) {
    this.exposeMode = exposeMode;
    this.clients = clients;
    this.catalog = catalog;
    this.resources = resources;
    this.resourceOwner = resourceOwner;
    this.sandbox = sandbox;
    this.permissions = permissions;
    this.hooks = hooks;
    this.redactor = redactor;
  }

  static async init(config: GatewayConfig): Promise<McpGatewayProxy> {
    const sandbox = new WorkspaceSandbox(config.workspace_root);
    const permissions = new PermissionEngine(config.permissions);
    const hooks = new HookRunner(config.pre_tool_hook, config.post_tool_hook);
    const redactor = new Redactor(config.redact_fields);
    const timeoutMs = Math.max(1, config.request_timeout_secs) * 1000;

    process.stderr.write(
      `[shack-gateway] registering ${Object.keys(config.servers).length} downstream server(s)\n`,
    );

    const clients = new Map<string, DownstreamClient>();
    const failed: string[] = [];

    // Pass 1: spawn child processes.
    for (const [name, srvCfg] of Object.entries(config.servers).sort()) {
      try {
        const client = DownstreamClient.spawn(name, srvCfg, timeoutMs);
        clients.set(name, client);
        process.stderr.write(`[shack-gateway] spawned downstream server '${name}'\n`);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        process.stderr.write(`[shack-gateway] failed to spawn '${name}': ${msg}\n`);
        failed.push(name);
      }
    }

    // Pass 2: initialize handshake.
    const live: string[] = [];
    for (const name of [...clients.keys()].sort()) {
      const client = clients.get(name)!;
      const initParams = {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: GATEWAY_NAME, version: GATEWAY_VERSION },
      };
      try {
        await client.sendRequest("initialize", initParams, `init-${name}`);
        await client.notify("notifications/initialized", {});
        process.stderr.write(`[shack-gateway] handshake complete with '${name}'\n`);
        live.push(name);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        process.stderr.write(`[shack-gateway] handshake with '${name}' failed: ${msg}\n`);
        failed.push(name);
        clients.delete(name);
      }
    }

    // Pass 3: tool discovery.
    const catalog = new ToolCatalog();
    for (const name of live) {
      const client = clients.get(name)!;
      try {
        const resp = (await client.sendRequest("tools/list", {}, `tools-${name}`)) as Record<
          string,
          unknown
        >;
        const result = resp["result"] as Record<string, unknown> | undefined;
        const tools = (result?.["tools"] as unknown[]) ?? [];
        for (const tool of tools) {
          const ns = catalog.register(name, tool as Record<string, unknown>);
          if (ns) {
            process.stderr.write(`[shack-gateway] registered tool '${ns}'\n`);
          }
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        process.stderr.write(`[shack-gateway] tool discovery failed for '${name}': ${msg}\n`);
      }
    }
    process.stderr.write(
      `[shack-gateway] tool discovery complete: ${catalog.toolCount()} tool(s) registered\n`,
    );

    // Pass 4: resource discovery (optional).
    const resources: unknown[] = [];
    const resourceOwner = new Map<string, string>();
    for (const name of live) {
      const client = clients.get(name)!;
      try {
        const resp = (await client.sendRequest(
          "resources/list",
          {},
          `resources-${name}`,
        )) as Record<string, unknown>;
        const result = resp["result"] as Record<string, unknown> | undefined;
        const resList = (result?.["resources"] as unknown[]) ?? [];
        for (const res of resList) {
          const r = res as Record<string, unknown>;
          const uri = r["uri"] as string | undefined;
          if (uri) {
            resourceOwner.set(uri, name);
            resources.push(res);
          }
        }
      } catch {
        // Resource discovery is optional; many servers expose none.
      }
    }

    if (failed.length > 0) {
      process.stderr.write(
        `[shack-gateway] gateway starting in DEGRADED mode: ${failed.length} server(s) failed\n`,
      );
    } else {
      process.stderr.write(
        `[shack-gateway] gateway healthy: ${live.length} server(s) live, ${catalog.toolCount()} tool(s) available\n`,
      );
    }

    return new McpGatewayProxy(
      config.expose_mode,
      clients,
      catalog,
      resources,
      resourceOwner,
      sandbox,
      permissions,
      hooks,
      redactor,
    );
  }

  async handleClientRequest(req: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    const idVal = req["id"];
    const method = req["method"];

    if (typeof method !== "string") {
      if (idVal !== undefined) {
        return error(idVal, -32600, "invalid request: missing method");
      }
      return null;
    }

    // No id means a notification: act on it but never reply.
    if (idVal === undefined || idVal === null) {
      await this.forwardNotification(method, req["params"]);
      return null;
    }

    const params = (req["params"] ?? {}) as Record<string, unknown>;

    switch (method) {
      case "initialize":
        return success(idVal, this.initializeResult());
      case "ping":
        return success(idVal, {});
      case "tools/list":
        return success(idVal, this.toolsListResult());
      case "tools/call":
        return this.handleToolsCall(idVal, params);
      case "resources/list":
        return success(idVal, { resources: this.resources });
      case "resources/read":
        return this.handleResourcesRead(idVal, params);
      case "prompts/list":
        return success(idVal, { prompts: [] });
      default:
        return error(idVal, -32601, `method not found: ${method}`);
    }
  }

  private initializeResult(): unknown {
    return {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {}, resources: {} },
      serverInfo: { name: GATEWAY_NAME, version: GATEWAY_VERSION },
    };
  }

  private toolsListResult(): unknown {
    if (this.exposeMode === "progressive") {
      return { tools: metaToolSchemas() };
    }
    return { tools: this.catalog.fullToolList() };
  }

  private async handleToolsCall(
    idVal: unknown,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const name = params["name"];
    if (typeof name !== "string" || !name) {
      return error(idVal, -32602, "invalid params: missing tool name");
    }
    const arguments_ = (params["arguments"] ?? {}) as Record<string, unknown>;

    if (isMetaTool(name)) {
      return this.handleMetaTool(idVal, name, arguments_);
    }

    const [result, err] = await this.invokePipeline(name, arguments_);
    if (err) return error(idVal, err[0], err[1]);
    return success(idVal, result);
  }

  private async handleMetaTool(
    idVal: unknown,
    name: string,
    arguments_: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    switch (name) {
      case META_LIST_TOOLS: {
        const query = arguments_["query"] as string | undefined;
        const server = arguments_["server"] as string | undefined;
        const tools = this.catalog.search(query, server);
        return success(idVal, textResult({ tools, count: tools.length }));
      }
      case META_DESCRIBE_TOOL: {
        const toolName = arguments_["name"] as string | undefined;
        const entry = toolName ? this.catalog.get(toolName) : undefined;
        if (!entry) {
          return error(idVal, -32602, `unknown tool: ${toolName ?? "(missing 'name')"}`);
        }
        return success(
          idVal,
          textResult({
            name: entry.namespacedName,
            server: entry.serverName,
            description: entry.description,
            inputSchema: entry.inputSchema,
          }),
        );
      }
      case META_LIST_SERVERS:
        return success(idVal, textResult({ servers: this.catalog.serverSummaries() }));

      case META_CALL_TOOL: {
        const toolName = arguments_["name"] as string | undefined;
        if (!toolName) {
          return error(idVal, -32602, "missing 'name' for shack_call_tool");
        }
        const innerArgs = (arguments_["arguments"] ?? {}) as Record<string, unknown>;
        const [result, err] = await this.invokePipeline(toolName, innerArgs);
        if (err) return error(idVal, err[0], err[1]);
        return success(idVal, result);
      }
      default:
        return error(idVal, -32601, `unknown gateway tool: ${name}`);
    }
  }

  private async invokePipeline(
    namespaced: string,
    arguments_: Record<string, unknown>,
  ): Promise<[unknown, null] | [null, PipelineError]> {
    const entry = this.catalog.get(namespaced);
    if (!entry) return [null, [-32601, `tool not found: ${namespaced}`]];

    // Layer 1: workspace sandbox.
    try {
      this.sandbox.validateToolArguments(arguments_);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return [null, [-32001, `sandbox violation: ${msg}`]];
    }

    const argsStr = JSON.stringify(arguments_);

    // Layer 2: declarative permission policy.
    const decision = this.permissions.evaluate(namespaced, argsStr);
    if (decision.kind === "deny") {
      return [null, [-32002, `blocked by permission policy: ${decision.reason}`]];
    }
    if (decision.kind === "prompt") {
      return [
        null,
        [
          -32002,
          `${decision.reason}; the gateway has no interactive prompter — add an allow rule`,
        ],
      ];
    }

    // Layer 3: pre-tool hook (synchronous via spawnSync, no event loop blocking).
    let overrideDecision: string | null = null;
    let finalArgsStr = argsStr;
    try {
      [overrideDecision, finalArgsStr] = this.hooks.runPreToolUse(namespaced, argsStr);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return [null, [-32003, `blocked by pre-tool hook: ${msg}`]];
    }

    if (overrideDecision === "deny") {
      return [null, [-32002, "denied by pre-tool hook permission decision"]];
    }

    let finalArgs: Record<string, unknown>;
    try {
      finalArgs = JSON.parse(finalArgsStr) as Record<string, unknown>;
    } catch {
      finalArgs = arguments_;
    }

    // Route to the owning downstream server.
    const client = this.clients.get(entry.serverName);
    if (!client) {
      return [null, [-32603, `server '${entry.serverName}' is unavailable`]];
    }

    const reqId = this.nextId();
    process.stderr.write(
      `[shack-gateway] routing '${namespaced}' -> server '${entry.serverName}'\n`,
    );

    const downstreamParams = { name: entry.originalName, arguments: finalArgs };
    let response: Record<string, unknown>;
    try {
      response = (await client.sendRequest("tools/call", downstreamParams, reqId)) as Record<
        string,
        unknown
      >;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return [null, [-32603, `downstream error: ${msg}`]];
    }

    if (response["error"]) {
      const err = response["error"] as Record<string, unknown>;
      const code = typeof err["code"] === "number" ? err["code"] : -32603;
      const message =
        typeof err["message"] === "string" ? err["message"] : "downstream server error";
      return [null, [code, message]];
    }

    const result = (response["result"] ?? {}) as Record<string, unknown>;
    const resultIsError =
      typeof result["isError"] === "boolean" ? result["isError"] : false;

    // Layer 4: post-tool hook.
    try {
      this.hooks.runPostToolUse(namespaced, argsStr, result, resultIsError);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return [null, [-32003, `result rejected by post-tool hook: ${msg}`]];
    }

    return [result, null];
  }

  private async handleResourcesRead(
    idVal: unknown,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const uri = params["uri"];
    if (typeof uri !== "string") {
      return error(idVal, -32602, "invalid params: missing 'uri'");
    }
    const owner = this.resourceOwner.get(uri);
    if (!owner) return error(idVal, -32602, `unknown resource: ${uri}`);
    const client = this.clients.get(owner);
    if (!client) return error(idVal, -32603, "resource server is unavailable");

    const reqId = this.nextId();
    try {
      const resp = (await client.sendRequest(
        "resources/read",
        { uri },
        reqId,
      )) as Record<string, unknown>;
      if (resp["error"]) {
        const e = resp["error"] as Record<string, unknown>;
        const code = typeof e["code"] === "number" ? e["code"] : -32603;
        const message =
          typeof e["message"] === "string" ? e["message"] : "downstream server error";
        return error(idVal, code, message);
      }
      return success(idVal, resp["result"] ?? {});
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return error(idVal, -32603, `downstream error: ${msg}`);
    }
  }

  private async forwardNotification(method: string, params: unknown): Promise<void> {
    // The client's initialized notification is consumed here; downstream servers
    // were already initialized during startup.
    if (method === "notifications/initialized") return;
    const p = params ?? {};
    for (const client of this.clients.values()) {
      await client.notify(method, p);
    }
  }

  private nextId(): string {
    return `shack-${this.seq++}`;
  }
}
