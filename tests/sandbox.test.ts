import { describe, test, expect, beforeEach } from "@jest/globals";
import { mkdtempSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { WorkspaceSandbox } from "../src/sandbox.js";

let root: string;
let sandbox: WorkspaceSandbox;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "shack-sandbox-"));
  sandbox = new WorkspaceSandbox(root);
});

describe("WorkspaceSandbox", () => {
  test("path inside root is allowed", () => {
    const inside = join(root, "allowed.txt");
    writeFileSync(inside, "");
    expect(() => sandbox.validatePath(inside)).not.toThrow();
  });

  test("path outside root is blocked", () => {
    const outside = join(tmpdir(), "forbidden.txt");
    expect(() => sandbox.validatePath(outside)).toThrow("directory traversal blocked");
  });

  test("relative path inside is allowed", () => {
    expect(() => sandbox.validatePath("inside.txt")).not.toThrow();
  });

  test("relative path traversal is blocked", () => {
    expect(() => sandbox.validatePath("../outside.txt")).toThrow("directory traversal blocked");
  });

  test("validateToolArguments path key inside: ok", () => {
    expect(() => sandbox.validateToolArguments({ file_path: "inside.txt" })).not.toThrow();
  });

  test("validateToolArguments path key outside: throws", () => {
    expect(() => sandbox.validateToolArguments({ path: "../escape.txt" })).toThrow(
      "directory traversal blocked",
    );
  });

  test("validateToolArguments array: throws on any outside", () => {
    expect(() =>
      sandbox.validateToolArguments({ paths: ["a.txt", "../escape.txt"] }),
    ).toThrow("directory traversal blocked");
  });

  test("validateToolArguments no path key: always ok", () => {
    expect(() => sandbox.validateToolArguments({ query: "select 1" })).not.toThrow();
  });

  test("non-object arguments are skipped", () => {
    expect(() => sandbox.validateToolArguments("not an object")).not.toThrow();
    expect(() => sandbox.validateToolArguments(null)).not.toThrow();
  });

  test("path equal to root is allowed", () => {
    expect(() => sandbox.validatePath(root)).not.toThrow();
  });

  test("deeply nested existing path is allowed", () => {
    // Create the nested directory so canonicalize can resolve the real path.
    const dir = join(root, "a", "b", "c");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "file.txt");
    writeFileSync(file, "");
    expect(() => sandbox.validatePath(file)).not.toThrow();
  });

  test("all path keys are checked", () => {
    for (const key of ["directory", "dir", "cwd", "source", "destination", "filePath", "notebookPath"]) {
      expect(() =>
        sandbox.validateToolArguments({ [key]: "../escape.txt" }),
      ).toThrow("directory traversal blocked");
    }
  });

  test("array with non-string items does not throw TypeError", () => {
    expect(() =>
      sandbox.validateToolArguments({ paths: [1, null, true] }),
    ).not.toThrow();
  });

  test("constructor throws for nonexistent root", () => {
    expect(
      () => new WorkspaceSandbox("/nonexistent/definitely/not/here_shack_ts"),
    ).toThrow("does not exist");
  });
});
