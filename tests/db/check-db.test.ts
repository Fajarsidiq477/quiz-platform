import { describe, expect, it } from "vitest";
import { assessRole } from "../../scripts/check-db-lib";

const limited = { name: "quiz_app", superuser: false, bypassRls: false };

describe("judging a connection for the web app", () => {
  it("accepts a limited role that sees nothing without a school", () => {
    expect(assessRole(limited, 0, true)).toEqual({ ok: true, problems: [], notes: [] });
  });

  it("refuses a superuser", () => {
    const r = assessRole({ name: "postgres", superuser: true, bypassRls: true }, 12, true);
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toMatch(/superuser.*NOT kept apart/);
  });

  it("refuses a role with BYPASSRLS, and points at the Neon console pitfall", () => {
    const r = assessRole({ name: "neondb_owner", superuser: false, bypassRls: true }, 3, true);
    expect(r.ok).toBe(false);
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toMatch(/BYPASSRLS/);
    expect(r.problems[0]).toMatch(/Neon console/);
    expect(r.notes[0]).toMatch(/across schools, as expected/);
  });

  it("refuses a limited role that can nevertheless see users (row-level security not working)", () => {
    const r = assessRole(limited, 5, true);
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatch(/5 user row\(s\) without a school selected/);
  });

  it("asks for the grants when the role cannot read the tables", () => {
    const r = assessRole(limited, null, true);
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatch(/neon-app-role\.sql/);
  });

  it("asks for the migrations when the tables are not there", () => {
    const r = assessRole(limited, null, false);
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatch(/db:migrate/);
  });
});
