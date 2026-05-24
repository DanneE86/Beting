import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * UI-komponenter från @/components/ui som ofta glöms bort vid import
 * (t.ex. Card utan import → ReferenceError vid SSR).
 */
const UI_GUARD_COMPONENTS = [
  "Card",
  "Button",
  "Badge",
  "Skeleton",
  "Tabs",
  "TabsList",
  "TabsTrigger",
  "TabsContent",
  "Textarea",
  "Input",
  "Select",
  "Dialog",
  "Sheet",
  "Table",
] as const;

function collectRouteFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) collectRouteFiles(full, acc);
    else if (/\.tsx$/.test(entry)) acc.push(full);
  }
  return acc;
}

function importedIdentifiers(source: string): Set<string> {
  const ids = new Set<string>();
  const importRe =
    /^import\s+(?:type\s+)?(?:\{([^}]+)\}|(\w+)(?:\s*,\s*\{([^}]+)\})?)\s+from\s+["'][^"']+["']/gm;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(source))) {
    const defaultId = m[2];
    if (defaultId) ids.add(defaultId);
    for (const block of [m[1], m[3]].filter(Boolean)) {
      for (const part of block!.split(",")) {
        const name = part.trim().split(/\s+as\s+/)[0]?.trim();
        if (name) ids.add(name);
      }
    }
  }
  return ids;
}

function usesComponent(source: string, name: string): boolean {
  return new RegExp(`<${name}(\\s|>|/)`).test(source);
}

describe("route import-smoke", () => {
  const routesDir = join(process.cwd(), "src/routes");
  const files = collectRouteFiles(routesDir);

  it.each(files)("%s importerar ui-komponenter den använder", (file) => {
    const source = readFileSync(file, "utf-8");
    const rel = relative(process.cwd(), file);
    const imports = importedIdentifiers(source);
    const missing = UI_GUARD_COMPONENTS.filter(
      (name) => usesComponent(source, name) && !imports.has(name),
    );
    expect(missing, `${rel} saknar import för: ${missing.join(", ")}`).toEqual([]);
  });
});
