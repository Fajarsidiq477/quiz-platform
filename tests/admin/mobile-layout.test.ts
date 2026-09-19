import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  path.resolve(import.meta.dirname, "../../src/components/admin/admin.module.css"),
  "utf8",
);

/** The text between the braces of the block that starts at `open` (nested braces supported). */
function block(source: string, open: RegExp): string {
  const match = open.exec(source);
  if (!match) throw new Error(`no block matching ${open}`);
  let depth = 0;
  for (let i = match.index + match[0].length - 1; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}" && --depth === 0) return source.slice(match.index + match[0].length, i);
  }
  throw new Error("unbalanced braces");
}

const tracks = (value: string) => value.trim().split(/\s+/).length;
const declaration = (source: string, property: string) =>
  new RegExp(`${property}\s*:\s*([^;]+);`).exec(source)?.[1];

describe("admin shell layout", () => {
  // Regression: the phone layout stacks header, sidebar and main in three grid rows. When the
  // desktop `auto 1fr` rows were left in place, the `1fr` went to the sidebar and stretched the
  // nav strip to fill the screen, leaving a blank gap under the header.
  it("sizes one grid row per stacked area on small screens", () => {
    const mobile = block(css, /@media \(max-width: 760px\)\s*\{/);
    const shell = block(mobile, /\.shell\s*\{/);

    const areas = declaration(shell, "grid-template-areas")!.match(/"[^"]*"/g)!;
    const rows = declaration(shell, "grid-template-rows");

    expect(areas).toHaveLength(3);
    expect(rows, "mobile .shell must set grid-template-rows").toBeDefined();
    expect(tracks(rows!)).toBe(areas.length);
    // The flexible track belongs to the last row (main content), never the nav strip.
    expect(rows!.trim().split(/\s+/)).toEqual(["auto", "auto", "1fr"]);
  });

  it("keeps the desktop layout at two rows", () => {
    const desktop = block(css, /\.shell\s*\{/);
    expect(tracks(declaration(desktop, "grid-template-rows")!)).toBe(2);
  });
});
