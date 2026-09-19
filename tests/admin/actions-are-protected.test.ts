import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const featuresDir = path.resolve(import.meta.dirname, "../../src/features");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const rel = (f: string) => path.relative(featuresDir, f).replaceAll("\\", "/");
const allActionFiles = walk(featuresDir).filter((f) => /actions\.(t|j)s$/.test(f));

// The only actions that work for someone who is not signed in. Adding to this list is a security
// decision: each entry needs its own gate (registration uses the class join code).
const PUBLIC_ACTION_FILES = ["register/actions.ts"];

const actionFiles = allActionFiles.filter((f) => !PUBLIC_ACTION_FILES.includes(rel(f)));

// Server actions are public HTTP endpoints: anyone can POST to one without ever opening the page
// that uses it. So every exported action must check the session itself, as its first step.
describe("server actions", () => {
  it("finds the action files", () => {
    expect(actionFiles.length).toBeGreaterThanOrEqual(2);
  });

  it("only the listed files are public, and they all exist", () => {
    const publicFound = allActionFiles.map(rel).filter((f) => PUBLIC_ACTION_FILES.includes(f));
    expect(publicFound.sort()).toEqual([...PUBLIC_ACTION_FILES].sort());
  });

  it("registration never takes a role, school or status from the form", () => {
    // A visitor controls every form field, so anything read from the form can be forged.
    for (const file of ["register/actions.ts", "register/service.ts", "register/schemas.ts"]) {
      const source = readFileSync(path.join(featuresDir, file), "utf8");
      expect(source, file).not.toMatch(/formValue\(formData,\s*"(role|schoolId|school_id|status)"\)/);
      expect(source, file).not.toMatch(/\brole:\s*input\.|schoolId:\s*input\./);
    }
    // The role is fixed in the service, and the school comes from the class the code belongs to.
    const service = readFileSync(path.join(featuresDir, "register/service.ts"), "utf8");
    expect(service).toMatch(/role:\s*"student"/);
    expect(service).toMatch(/schoolId:\s*target\.schoolId/);
  });

  it.each(actionFiles.map((f) => [rel(f), f]))(
    "%s is a server-actions file where every action starts with requireUser(\"admin\")",
    (_name, file) => {
      const source = readFileSync(file, "utf8");
      expect(source.trimStart().startsWith('"use server"')).toBe(true);

      // Split into one chunk per exported function and check each one's first statement.
      const chunks = source.split(/^export async function /m).slice(1);
      expect(chunks.length).toBeGreaterThan(0);
      for (const chunk of chunks) {
        const name = chunk.slice(0, chunk.indexOf("("));
        const body = chunk.slice(chunk.indexOf("{") + 1);
        const firstStatement = body.trimStart().split("\n")[0];
        expect(firstStatement, `${name} must call requireUser("admin") first`).toMatch(
          /await requireUser\("admin"\)/,
        );
      }
    },
  );

  it("exports only async functions (a 'use server' file cannot export anything else)", () => {
    for (const file of allActionFiles) {
      const exported = readFileSync(file, "utf8").match(/^export (?!async function)/gm);
      expect(exported, path.basename(file)).toBeNull();
    }
  });
});
