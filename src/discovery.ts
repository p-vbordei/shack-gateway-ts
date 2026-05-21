/**
 * Tool catalog and progressive-discovery meta-tool definitions.
 *
 * The {@link ToolCatalog} is the authoritative index of every downstream tool
 * the gateway knows about. Tools are keyed by their *namespaced* name
 * (`server__tool`) to avoid collisions when two servers expose identically-
 * named tools.
 *
 * Progressive discovery works by exposing only the four `shack_*` meta-tools
 * to the client by default. The client calls {@link META_LIST_TOOLS} or
 * {@link META_DESCRIBE_TOOL} to explore the catalog on demand, then
 * {@link META_CALL_TOOL} to invoke a specific tool through the security
 * pipeline.
 */

export const NS_SEP = "__";
export const META_PREFIX = "shack_";

export const META_LIST_TOOLS = "shack_list_tools";
export const META_DESCRIBE_TOOL = "shack_describe_tool";
export const META_CALL_TOOL = "shack_call_tool";
export const META_LIST_SERVERS = "shack_list_servers";

/** Returns `true` if `name` refers to a gateway meta-tool (`shack_*`). */
export function isMetaTool(name: string): boolean {
  return name.startsWith(META_PREFIX);
}

function summarize(description: string): string {
  const trimmed = description.trim();
  if (!trimmed) return "(no description provided)";

  let first = trimmed;
  const dotIdx = trimmed.indexOf(".");
  const newlineIdx = trimmed.indexOf("\n");
  // Find first sentence or line break.
  let cutIdx = -1;
  if (dotIdx !== -1 && (newlineIdx === -1 || dotIdx < newlineIdx)) {
    cutIdx = dotIdx;
  } else if (newlineIdx !== -1) {
    cutIdx = newlineIdx;
  }
  if (cutIdx !== -1) {
    first = trimmed.slice(0, cutIdx).trim();
    if (!first) first = trimmed;
  }
  if (first.length > 140) {
    return first.slice(0, 137) + "...";
  }
  return first;
}

/** A single downstream tool registered in the {@link ToolCatalog}. */
export interface CatalogEntry {
  /** The `server__tool` namespaced identifier used as the tool's public name. */
  namespacedName: string;
  serverName: string;
  originalName: string;
  /** One-line summary derived from the first sentence of `description`. */
  summary: string;
  description: string;
  inputSchema: unknown;
}

export class ToolCatalog {
  private entries: Map<string, CatalogEntry> = new Map();

  register(serverName: string, tool: Record<string, unknown>): string | null {
    const originalName = tool["name"];
    if (typeof originalName !== "string" || !originalName) return null;
    const namespacedName = `${serverName}${NS_SEP}${originalName}`;
    const description = typeof tool["description"] === "string" ? tool["description"] : "";
    const inputSchema = tool["inputSchema"] ?? { type: "object" };
    this.entries.set(namespacedName, {
      namespacedName,
      serverName,
      originalName,
      summary: summarize(description),
      description,
      inputSchema,
    });
    return namespacedName;
  }

  get(namespacedName: string): CatalogEntry | undefined {
    return this.entries.get(namespacedName);
  }

  toolCount(): number {
    return this.entries.size;
  }

  names(): string[] {
    return [...this.entries.keys()].sort();
  }

  fullToolList(): unknown[] {
    return [...this.entries.values()]
      .sort((a, b) => a.namespacedName.localeCompare(b.namespacedName))
      .map((e) => ({
        name: e.namespacedName,
        description: e.description,
        inputSchema: e.inputSchema,
      }));
  }

  search(query: string | null | undefined, server: string | null | undefined): unknown[] {
    const q = query ? query.toLowerCase() : null;
    const results: unknown[] = [];
    for (const e of [...this.entries.values()].sort((a, b) =>
      a.namespacedName.localeCompare(b.namespacedName),
    )) {
      if (server !== null && server !== undefined && e.serverName !== server) continue;
      if (q !== null) {
        const haystack =
          e.namespacedName.toLowerCase() +
          " " +
          e.summary.toLowerCase() +
          " " +
          e.description.toLowerCase();
        if (!haystack.includes(q)) continue;
      }
      results.push({ name: e.namespacedName, server: e.serverName, summary: e.summary });
    }
    return results;
  }

  serverSummaries(): unknown[] {
    const byServer = new Map<string, string[]>();
    for (const e of [...this.entries.values()].sort((a, b) =>
      a.namespacedName.localeCompare(b.namespacedName),
    )) {
      if (!byServer.has(e.serverName)) byServer.set(e.serverName, []);
      byServer.get(e.serverName)!.push(e.namespacedName);
    }
    return [...byServer.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([server, tools]) => ({ server, tool_count: tools.length, tools }));
  }
}

export function metaToolSchemas(): unknown[] {
  return [
    {
      name: META_LIST_TOOLS,
      description:
        "List downstream tools available through the gateway as compact " +
        "{name, server, summary} entries. Optionally filter by server or a keyword. " +
        "Returns no input schemas — call shack_describe_tool for a tool's full schema.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Case-insensitive keyword filter." },
          server: {
            type: "string",
            description: "Restrict results to one downstream server.",
          },
        },
      },
    },
    {
      name: META_DESCRIBE_TOOL,
      description:
        "Return the full description and JSON input schema for one downstream " +
        "tool, identified by its namespaced name (server__tool).",
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Namespaced tool name, e.g. filesystem__read_file.",
          },
        },
        required: ["name"],
      },
    },
    {
      name: META_CALL_TOOL,
      description:
        "Invoke a downstream tool by its namespaced name. The call passes " +
        "through the gateway's sandbox, permission, and hook pipeline before routing.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Namespaced tool name (server__tool)." },
          arguments: {
            type: "object",
            description: "Arguments forwarded to the downstream tool.",
          },
        },
        required: ["name"],
      },
    },
    {
      name: META_LIST_SERVERS,
      description: "List the connected downstream servers with their tool counts.",
      inputSchema: { type: "object", properties: {} },
    },
  ];
}
