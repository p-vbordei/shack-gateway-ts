# shack-gateway (TypeScript)

An aggregating MCP server that multiplexes multiple downstream MCP servers
behind a single, security-hardened gateway. Speaks JSON-RPC 2.0 over stdio;
STDOUT carries only protocol messages and all log output goes to STDERR.

## What it does

- Connects to one or more downstream MCP servers at startup and aggregates
  their tools and resources into a unified namespace (`server__tool`).
- Exposes a progressive-discovery surface by default: four `shack_*` meta-tools
  let clients explore and invoke downstream tools without loading every schema
  at once. In `full` mode every downstream tool is exposed directly.
- Runs every tool call through a security pipeline: workspace sandbox (path
  containment), declarative allow/deny permission rules, and optional pre/post
  shell hooks.
- Redacts sensitive field names (tokens, secrets, keys, etc.) from log output
  automatically.

## MCP tools

| Tool | Arguments | Description |
|---|---|---|
| `shack_list_tools` | `query?` (string), `server?` (string) | List downstream tools as compact `{name, server, summary}` entries. Filter by server name or a case-insensitive keyword. Returns no input schemas — use `shack_describe_tool` for a full schema. |
| `shack_describe_tool` | `name` (string, required) | Return the full description and JSON input schema for one namespaced tool (`server__tool`). |
| `shack_call_tool` | `name` (string, required), `arguments?` (object) | Invoke a downstream tool by namespaced name. Passes through the full sandbox, permission, and hook pipeline before routing. |
| `shack_list_servers` | — | List connected downstream servers with their tool counts. |

In `expose_mode: progressive` (the default) only the four meta-tools above
appear in `tools/list`. In `expose_mode: full` every downstream tool is listed
directly.

## Configuration

The gateway reads a JSON file (default `shack-config.json`). All fields except
`workspace_root` are optional.

| Field | Type | Default | Description |
|---|---|---|---|
| `workspace_root` | string | **required** | Absolute path; tool arguments containing paths are checked to stay inside this directory. |
| `expose_mode` | `"progressive"` or `"full"` | `"progressive"` | Controls how downstream tools are surfaced. |
| `servers` | object | `{}` | Map of server name to `{command, args?, env?}` objects. |
| `permissions.default_decision` | `"allow"` / `"deny"` / `"prompt"` | `"allow"` | Fallback when no allow/deny rule matches. |
| `permissions.allow` | string[] | `[]` | Patterns that explicitly allow calls, e.g. `fs__read(*)`. |
| `permissions.deny` | string[] | `[]` | Patterns that explicitly block calls. Evaluated before allow. |
| `pre_tool_hook` | string | none | Shell command run before every tool call; may modify arguments or deny. |
| `post_tool_hook` | string | none | Shell command run after every tool call; may reject results. |
| `redact_fields` | string[] | built-in list | JSON field names whose values are masked in logs. |
| `request_timeout_secs` | integer | `30` | Per-request timeout applied to downstream calls. |

### Permission rule syntax

Rules have the form `tool_name(subject_pattern)`:
- `fs__write(*)` — match any call to `fs__write`.
- `bash(rm -rf:*)` — match calls where the subject starts with `rm -rf`.
- `git(checkout)` — exact match on the subject value `checkout`.

The subject is extracted from the first matching well-known argument key:
`command`, `path`, `file_path`, `url`, `query`, etc.

Minimal config example:

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

The server reads newline-delimited JSON-RPC 2.0 from stdin and writes
responses to stdout. Log output goes to stderr.

## CLI flags

| Flag | Default | Description |
|---|---|---|
| `--config` / `-c` | `shack-config.json` | Path to the gateway JSON configuration file. |

## Usage example

The following shows a complete JSON-RPC 2.0 interaction over stdio. Each
request is one line; each response is one line.

**Request** — list available tools:
```json
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"shack_list_tools","arguments":{}}}
```

**Response** — compact tool list (empty with no configured downstream servers):
```json
{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"{\"tools\":[],\"count\":0}"}]}}
```

**Request** — call a downstream tool by namespaced name:
```json
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"shack_call_tool","arguments":{"name":"filesystem__read_file","arguments":{"path":"src/main.ts"}}}}
```

## Test

```sh
npm test
```

Unit tests cover config parsing, tool catalog registration and search,
permission rule evaluation, sandbox path validation, redaction, and hook
invocation. Integration tests in `tests/proxy.test.ts` spawn the gateway
process over stdio and exercise the full JSON-RPC surface.
