import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Regression test for "Connection terminated unexpectedly" on the local development database.
// The socket library it uses leaked a connection slot whenever a client disconnected abruptly
// (a killed script, a restarted dev server) and could even throw inside the server afterwards.
// Once the slots ran out every new connection was refused and every page failed. This runs the
// real `scripts/dev-db.ts` in a child process and abuses it the same way.
describe("local dev database (scripts/dev-db.ts)", () => {
  const root = path.resolve(import.meta.dirname, "../..");
  let child: ChildProcess;
  let port: number;
  let output = "";

  const freePort = () =>
    new Promise<number>((resolve, reject) => {
      const probe = net.createServer();
      probe.listen(0, "127.0.0.1", () => {
        const { port } = probe.address() as net.AddressInfo;
        probe.close(() => resolve(port));
      });
      probe.on("error", reject);
    });

  beforeAll(async () => {
    port = await freePort();
    child = spawn(process.execPath, [path.join(root, "node_modules/tsx/dist/cli.mjs"), "scripts/dev-db.ts"], {
      cwd: root,
      env: {
        ...process.env,
        DEV_DB_PORT: String(port),
        DEV_DB_DIR: "memory://",
        DEV_DB_MAX_CONNECTIONS: "3", // a tiny limit, so a leak shows up after a few abrupt drops
        DEV_DB_PRUNE_MS: "100",
      },
    });
    child.stdout?.on("data", (d) => (output += d));
    child.stderr?.on("data", (d) => (output += d));

    const started = Date.now();
    while (!output.includes("Local database ready")) {
      if (child.exitCode !== null) throw new Error(`dev-db exited early:\n${output}`);
      if (Date.now() - started > 60_000) throw new Error(`dev-db did not start:\n${output}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }, 90_000);

  afterAll(() => {
    child?.kill();
  });

  const query = async () => {
    const client = new Client({ host: "127.0.0.1", port, user: "postgres", database: "postgres" });
    try {
      await client.connect();
      return (await client.query("select count(*)::int as n from users")).rows[0].n;
    } finally {
      await client.end().catch(() => {});
    }
  };

  /** Connects and then vanishes with a TCP reset, the way a killed process does. */
  const dropAbruptly = () =>
    new Promise<void>((resolve) => {
      const socket = net.connect(port, "127.0.0.1", () => {
        const params = Buffer.from("user\0postgres\0database\0postgres\0\0");
        const startup = Buffer.alloc(8 + params.length);
        startup.writeInt32BE(startup.length, 0);
        startup.writeInt32BE(196608, 4);
        params.copy(startup, 8);
        socket.write(startup, () =>
          setTimeout(() => {
            socket.resetAndDestroy();
            setTimeout(resolve, 30);
          }, 30),
        );
      });
      socket.on("error", () => resolve());
    });

  it("starts, applies the migrations, and answers queries", async () => {
    expect(await query()).toBe(0); // the users table exists and is empty
  });

  it("keeps accepting connections after clients disconnect abruptly", async () => {
    // Twice the connection limit: without cleanup these would fill every slot.
    for (let i = 0; i < 8; i++) await dropAbruptly();
    await new Promise((r) => setTimeout(r, 400)); // let the cleanup run

    expect(child.exitCode, `the database process crashed:\n${output}`).toBeNull();
    expect(await Promise.all([query(), query(), query()])).toEqual([0, 0, 0]); // in parallel, like a page
  });

  it("frees the leaked slots and says so", () => {
    expect(output).toMatch(/Freed \d+ leaked connection slot/);
  });

  it("stays healthy through repeated abuse", async () => {
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < 4; i++) await dropAbruptly();
      await new Promise((r) => setTimeout(r, 300));
      expect(await Promise.all([query(), query()])).toEqual([0, 0]);
    }
    expect(child.exitCode).toBeNull();
  });
});
