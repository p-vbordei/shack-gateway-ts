/**
 * Workspace sandbox: confines path arguments to the configured root.
 */

import { realpathSync, existsSync, statSync } from "fs";
import { resolve, join, relative, normalize, dirname, basename } from "path";

const PATH_KEYS = [
  "path",
  "paths",
  "file_path",
  "filePath",
  "notebook_path",
  "notebookPath",
  "directory",
  "dir",
  "cwd",
  "source",
  "destination",
];

function normalizePath(p: string): string {
  // Lexically normalize without hitting the disk.
  return normalize(p);
}

function canonicalize(p: string): string {
  // Resolve symlinks where the path exists; fall back to normalized form.
  if (existsSync(p)) {
    return realpathSync(p);
  }
  const parent = dirname(p);
  if (existsSync(parent)) {
    return join(realpathSync(parent), basename(p));
  }
  return normalizePath(p);
}

export class WorkspaceSandbox {
  private root: string;

  constructor(root: string) {
    if (!existsSync(root)) {
      throw new Error(`workspace_root does not exist: ${root}`);
    }
    this.root = realpathSync(root);
  }

  validatePath(target: string): string {
    const absolute = target.startsWith("/") ? target : join(this.root, target);
    const canon = canonicalize(absolute);

    // Ensure it starts with the root path (with a trailing slash to prevent
    // prefix-match false positives like /tmp matching /tmp2).
    const rootWithSep = this.root.endsWith("/") ? this.root : this.root + "/";
    if (canon !== this.root && !canon.startsWith(rootWithSep)) {
      throw new Error(
        `directory traversal blocked: ${canon} is outside workspace root ${this.root}`,
      );
    }
    return canon;
  }

  validateToolArguments(arguments_: unknown): void {
    if (typeof arguments_ !== "object" || arguments_ === null || Array.isArray(arguments_)) {
      return;
    }
    const args = arguments_ as Record<string, unknown>;
    for (const key of PATH_KEYS) {
      const val = args[key];
      if (typeof val === "string") {
        this.validatePath(val);
      } else if (Array.isArray(val)) {
        for (const item of val) {
          if (typeof item === "string") {
            this.validatePath(item);
          }
        }
      }
    }
  }
}
