import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

// `overflow-x: hidden` on both <html> and <body> makes <body> its own scroll container (one that
// never scrolls), so every `position: sticky` element inside it silently never sticks: the quiz
// timer bar and the question navigator scrolled away with the page. jsdom cannot see this, so the
// stylesheet is checked directly.
describe("sticky elements can stick to the screen", () => {
  const css = read("src/app/globals.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const rulesFor = (selector: string) =>
    [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, selectors]) => selectors.split(",").map((s) => s.trim()).includes(selector))
      .map(([, , body]) => body);

  it("never makes <body> a scroll container", () => {
    for (const body of rulesFor("body")) {
      expect(body).not.toMatch(/overflow(-x|-y)?\s*:\s*(hidden|auto|scroll)/);
    }
  });

  it("still stops sideways scrolling, without a scroll container on <body>", () => {
    expect(rulesFor("html").join(" ")).toMatch(/overflow-x:\s*hidden/);
    expect(rulesFor("body").join(" ")).toMatch(/overflow-x:\s*clip/);
  });

  it("keeps the quiz bar and the question navigator sticky", () => {
    const student = read("src/components/student/student.module.css");
    expect(student).toMatch(/\.bar\s*\{[^}]*position:\s*sticky/);
    expect(student).toMatch(/\.navPanel\s*\{[^}]*position:\s*sticky/);
  });
});
