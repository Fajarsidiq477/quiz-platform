// Usage: npm run db:dev
// A local Postgres for development that needs nothing installed: PGlite (Postgres compiled to
// WASM) served over the normal Postgres protocol on 127.0.0.1:5433, with data kept in ./.pglite.
// Applies every migration in ./drizzle on start. Leave it running while you use `npm run dev`.
//
// Not for production, and NOT equivalent to a real deployment: the only login is a superuser, and
// superusers bypass row-level security, so RLS is inactive here. The automated tests cover RLS.
//
// Optional environment (mainly for the tests): DEV_DB_PORT, DEV_DB_DIR ("memory://" keeps nothing
// on disk), DEV_DB_MAX_CONNECTIONS, DEV_DB_PRUNE_MS.
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { citext } from "@electric-sql/pglite/contrib/citext";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { isClientDisconnect, pruneDeadConnections } from "./dev-db-lib";

const PORT = Number(process.env.DEV_DB_PORT ?? 5433);
const MAX_CONNECTIONS = Number(process.env.DEV_DB_MAX_CONNECTIONS ?? 50);
const PRUNE_MS = Number(process.env.DEV_DB_PRUNE_MS ?? 2000);
const root = path.resolve(__dirname, "..");

// A client that disconnects abruptly can make the socket library throw after it has already
// cleaned up. That must not take the database down, or every page fails until it is restarted.
function survive(error: unknown) {
  if (isClientDisconnect(error)) return;
  console.error(error);
  process.exit(1);
}
process.on("uncaughtException", survive);
process.on("unhandledRejection", survive);

async function main() {
  const client = await PGlite.create({
    dataDir: process.env.DEV_DB_DIR ?? path.join(root, ".pglite"),
    extensions: { citext },
  });
  await migrate(drizzle(client), { migrationsFolder: path.join(root, "drizzle") });

  const server = new PGLiteSocketServer({
    db: client,
    host: "127.0.0.1",
    port: PORT,
    maxConnections: MAX_CONNECTIONS,
  });
  await server.start();

  // The socket library leaks a connection slot for every client that disconnects abruptly (see
  // dev-db-lib.ts); without this, they add up until every new connection is refused.
  const pruner = setInterval(() => {
    const freed = pruneDeadConnections(server);
    if (freed > 0) console.log(`Freed ${freed} leaked connection slot${freed === 1 ? "" : "s"}.`);
  }, PRUNE_MS);
  pruner.unref();

  console.log(`Local database ready: postgres://postgres:postgres@127.0.0.1:${PORT}/postgres`);
  console.log("Press Ctrl+C to stop.");

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(pruner);
    await server.stop();
    await client.close(); // flushes to disk
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
