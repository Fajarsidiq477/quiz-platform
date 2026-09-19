// Usage: npm run db:dev
// A local Postgres for development that needs nothing installed: PGlite (Postgres compiled to
// WASM) served over the normal Postgres protocol on 127.0.0.1:5433, with data kept in ./.pglite.
// Applies every migration in ./drizzle on start. Leave it running while you use `npm run dev`.
//
// Not for production, and NOT equivalent to a real deployment: the only login is a superuser, and
// superusers bypass row-level security, so RLS is inactive here. The automated tests cover RLS.
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { citext } from "@electric-sql/pglite/contrib/citext";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

const PORT = 5433;
const root = path.resolve(__dirname, "..");

async function main() {
  const client = await PGlite.create({
    dataDir: path.join(root, ".pglite"),
    extensions: { citext },
  });
  await migrate(drizzle(client), { migrationsFolder: path.join(root, "drizzle") });

  const server = new PGLiteSocketServer({
    db: client,
    host: "127.0.0.1",
    port: PORT,
    maxConnections: 10,
  });
  await server.start();
  console.log(`Local database ready: postgres://postgres:postgres@127.0.0.1:${PORT}/postgres`);
  console.log("Press Ctrl+C to stop.");

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
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
