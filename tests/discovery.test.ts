import { describe, test, expect } from "@jest/globals";
import {
  ToolCatalog,
  isMetaTool,
  metaToolSchemas,
  META_LIST_TOOLS,
  META_DESCRIBE_TOOL,
  META_CALL_TOOL,
  META_LIST_SERVERS,
} from "../src/discovery.js";

function sampleTool(name: string, desc: string) {
  return {
    name,
    description: desc,
    inputSchema: { type: "object", properties: { path: { type: "string" } } },
  };
}

describe("ToolCatalog", () => {
  test("registers and namespaces tools", () => {
    const catalog = new ToolCatalog();
    const ns = catalog.register("filesystem", sampleTool("read_file", "Read a file. Extra."));
    expect(ns).toBe("filesystem__read_file");
    const entry = catalog.get("filesystem__read_file");
    expect(entry).toBeDefined();
    expect(entry!.originalName).toBe("read_file");
    expect(entry!.serverName).toBe("filesystem");
    expect(entry!.summary).toBe("Read a file");
  });

  test("two servers with same tool name do not collide", () => {
    const catalog = new ToolCatalog();
    catalog.register("fs_a", sampleTool("read", "Read from A"));
    catalog.register("fs_b", sampleTool("read", "Read from B"));
    expect(catalog.toolCount()).toBe(2);
    expect(catalog.get("fs_a__read")).toBeDefined();
    expect(catalog.get("fs_b__read")).toBeDefined();
  });

  test("search filters by server and keyword", () => {
    const catalog = new ToolCatalog();
    catalog.register("fs", sampleTool("read_file", "Read a file"));
    catalog.register("fs", sampleTool("write_file", "Write a file"));
    catalog.register("db", sampleTool("query", "Run a query"));

    expect(catalog.search(null, "fs")).toHaveLength(2);
    expect(catalog.search("query", null)).toHaveLength(1);
    expect(catalog.search("write", "fs")).toHaveLength(1);
    expect(catalog.search("nonexistent", null)).toHaveLength(0);
  });

  test("empty description gets placeholder summary", () => {
    const catalog = new ToolCatalog();
    catalog.register("s", { name: "t" });
    expect(catalog.get("s__t")!.summary).toBe("(no description provided)");
  });

  test("tool missing name returns null", () => {
    const catalog = new ToolCatalog();
    const result = catalog.register("fs", { description: "no name" });
    expect(result).toBeNull();
    expect(catalog.toolCount()).toBe(0);
  });

  test("serverSummaries aggregates by server", () => {
    const catalog = new ToolCatalog();
    catalog.register("fs", sampleTool("read", "Read"));
    catalog.register("fs", sampleTool("write", "Write"));
    catalog.register("db", sampleTool("query", "Query"));
    const summaries = catalog.serverSummaries() as Array<{ server: string; tool_count: number }>;
    expect(summaries).toHaveLength(2);
    const db = summaries.find((s) => s.server === "db")!;
    expect(db.tool_count).toBe(1);
  });

  test("fullToolList includes inputSchema", () => {
    const catalog = new ToolCatalog();
    catalog.register("srv", sampleTool("do_thing", "Does a thing"));
    const list = catalog.fullToolList() as Array<Record<string, unknown>>;
    expect(list).toHaveLength(1);
    expect(list[0]["name"]).toBe("srv__do_thing");
    expect(list[0]["description"]).toBe("Does a thing");
    expect(list[0]["inputSchema"]).toBeDefined();
  });

  test("fullToolList is sorted alphabetically", () => {
    const catalog = new ToolCatalog();
    catalog.register("z", sampleTool("alpha", "First"));
    catalog.register("a", sampleTool("zebra", "Second"));
    const list = catalog.fullToolList() as Array<{ name: string }>;
    const names = list.map((t) => t.name);
    expect(names).toEqual([...names].sort());
  });

  test("names returns sorted list", () => {
    const catalog = new ToolCatalog();
    catalog.register("b", sampleTool("tool", "T"));
    catalog.register("a", sampleTool("tool", "T"));
    expect(catalog.names()).toEqual(["a__tool", "b__tool"]);
  });

  test("long description is clipped with ellipsis", () => {
    const catalog = new ToolCatalog();
    catalog.register("s", { name: "t", description: "a".repeat(200) });
    const summary = catalog.get("s__t")!.summary;
    expect(summary.endsWith("...")).toBe(true);
    expect(summary.length).toBeLessThanOrEqual(140);
  });

  test("description split on period", () => {
    const catalog = new ToolCatalog();
    catalog.register("s", { name: "t", description: "First sentence. More detail." });
    expect(catalog.get("s__t")!.summary).toBe("First sentence");
  });

  test("search is case-insensitive on keyword", () => {
    const catalog = new ToolCatalog();
    catalog.register("fs", sampleTool("read_file", "Read a FILE from disk"));
    expect(catalog.search("FILE", null)).toHaveLength(1);
    expect(catalog.search("file", null)).toHaveLength(1);
  });

  test("tool without inputSchema gets default object schema", () => {
    const catalog = new ToolCatalog();
    catalog.register("s", { name: "t", description: "desc" });
    const entry = catalog.get("s__t")!;
    expect((entry.inputSchema as Record<string, unknown>)["type"]).toBe("object");
  });

  test("serverSummaries empty catalog returns empty array", () => {
    const catalog = new ToolCatalog();
    expect(catalog.serverSummaries()).toHaveLength(0);
  });
});

describe("isMetaTool", () => {
  test("recognizes meta tools", () => {
    expect(isMetaTool("shack_list_tools")).toBe(true);
    expect(isMetaTool("filesystem__read_file")).toBe(false);
  });

  test("shack without underscore is not a meta tool", () => {
    expect(isMetaTool("shack")).toBe(false);
  });

  test("empty string is not a meta tool", () => {
    expect(isMetaTool("")).toBe(false);
  });

  test("shack_ prefix alone is a meta tool", () => {
    expect(isMetaTool("shack_")).toBe(true);
    expect(isMetaTool("shack_anything")).toBe(true);
  });
});

describe("metaToolSchemas", () => {
  test("returns four schemas with correct names", () => {
    const schemas = metaToolSchemas() as Array<{ name: string }>;
    expect(schemas).toHaveLength(4);
    const names = schemas.map((s) => s.name);
    expect(names).toContain(META_LIST_TOOLS);
    expect(names).toContain(META_DESCRIBE_TOOL);
    expect(names).toContain(META_CALL_TOOL);
    expect(names).toContain(META_LIST_SERVERS);
  });

  test("each schema has an inputSchema", () => {
    const schemas = metaToolSchemas() as Array<Record<string, unknown>>;
    for (const schema of schemas) {
      expect(schema["inputSchema"]).toBeDefined();
    }
  });
});
