import type { PGLiteSocketServer } from "@electric-sql/pglite-socket";

/**
 * Frees connection slots that leaked.
 *
 * `pglite-socket` keeps one slot per connection in a private set and frees it when the socket
 * closes normally, but not when a client disconnects abruptly (a killed or crashed process, a
 * restarted dev server): its error path detaches the socket and drops the listener that would have
 * freed the slot. The slots then add up, and once the limit is reached every new connection is
 * refused with "Too many connections", which the app reports as "Connection terminated
 * unexpectedly". Real PostgreSQL does not do this; it only affects this local development database.
 *
 * A leaked handler is one whose socket is gone, so those are removed. Returns how many were freed.
 */
export function pruneDeadConnections(server: PGLiteSocketServer): number {
  const handlers = (server as unknown as { handlers?: Set<{ isAttached: boolean }> }).handlers;
  if (!handlers) return 0; // the library changed shape; nothing safe to do
  let freed = 0;
  for (const handler of [...handlers]) {
    if (!handler.isAttached) {
      handlers.delete(handler);
      freed++;
    }
  }
  return freed;
}

const DISCONNECT_CODES = new Set(["ECONNRESET", "EPIPE", "ECONNABORTED", "ERR_STREAM_DESTROYED"]);

/**
 * True for the error a client dropping its connection can cause. After such a drop the library has
 * already removed its own error listeners, so a late socket error would otherwise be uncaught and
 * kill the whole database process. Anything else is a real problem and must not be swallowed.
 */
export function isClientDisconnect(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && DISCONNECT_CODES.has(code);
}
