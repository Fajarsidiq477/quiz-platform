import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ADMIN_NAV, isActive } from "@/components/admin/nav-items";

const appDir = path.resolve(import.meta.dirname, "../../src/app");
const adminDir = path.join(appDir, "admin");

/** Every file under a directory, recursively. */
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const rel = (file: string) => path.relative(appDir, file).replaceAll("\\", "/");

describe("admin area access control", () => {
  // The layout cannot enforce access (it does not re-run on client navigation), so each page and
  // route handler must do it. This fails the build if a new admin page forgets.
  const guarded = walk(adminDir).filter((f) => /(^|\/)(page|route)\.[jt]sx?$/.test(rel(f)));

  it("finds the admin pages", () => {
    expect(guarded.length).toBeGreaterThanOrEqual(ADMIN_NAV.length);
  });

  it.each(guarded.map((f) => [rel(f), f]))("%s calls requireUser(\"admin\")", (_name, file) => {
    expect(readFileSync(file, "utf8")).toMatch(/await\s+requireUser\(\s*["']admin["']\s*\)/);
  });
});

describe("admin navigation", () => {
  it("links only to pages that exist", () => {
    for (const item of ADMIN_NAV) {
      const dir = path.join(appDir, item.href.replace(/^\//, ""));
      expect(existsSync(path.join(dir, "page.tsx")), `${item.href} has no page.tsx`).toBe(true);
    }
  });

  it("has unique links and labels", () => {
    expect(new Set(ADMIN_NAV.map((i) => i.href)).size).toBe(ADMIN_NAV.length);
    expect(new Set(ADMIN_NAV.map((i) => i.label)).size).toBe(ADMIN_NAV.length);
  });

  it("highlights the current section, and Dashboard only on /admin itself", () => {
    const dashboard = ADMIN_NAV[0];
    const classes = ADMIN_NAV.find((i) => i.href === "/admin/classes")!;
    expect(isActive(dashboard, "/admin")).toBe(true);
    expect(isActive(dashboard, "/admin/classes")).toBe(false);
    expect(isActive(classes, "/admin/classes")).toBe(true);
    expect(isActive(classes, "/admin/classes/123")).toBe(true);
    expect(isActive(classes, "/admin/classes-archive")).toBe(false);
    expect(isActive(classes, "/admin/students")).toBe(false);
  });
});

describe("student area access control", () => {
  // Same rule as the admin area: a layout cannot enforce access, so every page does it itself.
  const studentDir = path.join(appDir, "student");
  const guarded = walk(studentDir).filter((f) => /(^|\/)(page|route)\.[jt]sx?$/.test(rel(f)));

  it("finds the student pages", () => {
    expect(guarded.length).toBeGreaterThanOrEqual(3); // home, quiz, attempt
  });

  it.each(guarded.map((f) => [rel(f), f]))("%s calls requireUser(\"student\")", (_name, file) => {
    expect(readFileSync(file, "utf8")).toMatch(/await\s+requireUser\(\s*["']student["']\s*\)/);
  });
});
