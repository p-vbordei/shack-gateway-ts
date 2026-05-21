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
});

describe("isMetaTool", () => {
  test("recognizes meta tools", () => {
    expect(isMetaTool("shack_list_tools")).toBe(true);
    expect(isMetaTool("filesystem__read_file")).toBe(false);
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
});
