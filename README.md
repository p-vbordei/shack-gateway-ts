# shack-gateway (TypeScript)

An aggregating MCP server that multiplexes multiple downstream MCP servers behind a single, security-hardened gateway. Speaks JSON-RPC 2.0 over stdio; STDOUT carries only protocol messages and all log output goes to STDERR.

## MCP tools

| Tool | Description |
|---|---|
| `shack_list_tools` | List downstream tools as compact `{name, server, summary}` entries; filter by server or keyword. |
| `shack_describe_tool` | Return the full description and JSON input schema for one namespaced downstream tool (`server__tool`). |
| `shack_call_tool` | Invoke a downstream tool by namespaced name; passes through the full sandbox/permission/hook pipeline. |
| `shack_list_servers` | List connected downstream servers with their tool counts. |

In `expose_mode: progressive` (the default) only the four meta-tools above appear in `tools/list`. In `expose_mode: full` every downstream tool is listed directly.

## Configuration

The gateway reads a JSON file (default `shack-config.json`).

| Field | Type | Default | Description |
|---|---|---|---|
| `workspace_root` | string | required | Absolute path; tool arguments containing paths are checked to stay inside this directory. |
| `expose_mode` | `"progressive"` or `"full"` | `"progressive"` | Controls how downstream tools are surfaced. |
| `servers` | object | `{}` | Map of server name to `{command, args?, env?}` objects. |
| `permissions.default_decision` | `"allow"` / `"deny"` / `"prompt"` | `"allow"` | Fallback when no allow/deny rule matches. |
| `permissions.allow` | string[] | `[]` | Glob-style patterns that explicitly allow calls. |
| `permissions.deny` | string[] | `[]` | Glob-style patterns that explicitly block calls. Evaluated before allow. |
| `pre_tool_hook` | string | none | Shell command run before every tool call. |
| `post_tool_hook` | string | none | Shell command run after every tool call. |
| `redact_fields` | string[] | built-in list | JSON field names whose values are masked in logs. |
| `request_timeout_secs` | integer | `30` | Per-request timeout applied to downstream calls. |

Minimal example:

```json
{
  "workspace_root": "/home/user/project",
  "expose_mode": "progressive",
  "servers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/user/project"]
    }
  }
}
```

## Install

```sh
npm install
```

## Build

```sh
npm run build
```

## Run

```sh
node dist/main.js --config shack-config.json
```

## Test

```sh
npm test
```
