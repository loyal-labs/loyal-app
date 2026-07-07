import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const distDir = join(import.meta.dir, "..", "dist");

async function rewriteDeclarationImports(directory: string): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await rewriteDeclarationImports(path);
      continue;
    }
    if (!entry.name.endsWith(".d.ts")) {
      continue;
    }

    const original = await readFile(path, "utf8");
    const rewritten = original.replace(
      /(from\s+["']\.\.?\/[^"']+)\.ts(["'])/g,
      "$1.js$2"
    );
    if (rewritten !== original) {
      await writeFile(path, rewritten);
    }
  }
}

await rewriteDeclarationImports(distDir);
