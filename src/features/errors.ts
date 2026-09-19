export type ServiceErrorCode = "not_found" | "conflict" | "invalid_state" | "invalid_input";

/** A failure the user can act on. The message is safe to show in the UI. */
export class ServiceError extends Error {
  constructor(
    message: string,
    readonly code: ServiceErrorCode = "invalid_input",
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

/** Who is doing the work. `schoolId` scopes every query; both come from the verified session. */
export type Ctx = { schoolId: string; userId: string };
