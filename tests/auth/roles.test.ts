import { describe, expect, it } from "vitest";
import { homeFor, isSignInRole, requiredRoleForPath } from "@/auth/roles";

describe("roles", () => {
  it("lets only students and admins sign in", () => {
    expect(isSignInRole("student")).toBe(true);
    expect(isSignInRole("admin")).toBe(true);
    expect(isSignInRole("teacher")).toBe(false);
    expect(isSignInRole("")).toBe(false);
  });

  it("maps each role to its own home", () => {
    expect(homeFor("admin")).toBe("/admin");
    expect(homeFor("student")).toBe("/student");
  });

  it("reserves /admin and /student subtrees, and nothing look-alike", () => {
    expect(requiredRoleForPath("/admin")).toBe("admin");
    expect(requiredRoleForPath("/admin/users/1")).toBe("admin");
    expect(requiredRoleForPath("/student")).toBe("student");
    expect(requiredRoleForPath("/student/quizzes")).toBe("student");
    expect(requiredRoleForPath("/administrator")).toBeNull();
    expect(requiredRoleForPath("/students")).toBeNull();
    expect(requiredRoleForPath("/login")).toBeNull();
    expect(requiredRoleForPath("/")).toBeNull();
  });
});
