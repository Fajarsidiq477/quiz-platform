// Usage: npm run start:lan     (after `npm run build`, with `npm run db:dev` running)
//        npm run lan:info      (just print the addresses students should use, and the internet status)
//        npm run start:lan -- --go-offline           (disconnect this laptop's Wi-Fi, and keep it disconnected)
//        npm run start:lan -- --require-offline      (refuse to start while this laptop is online)
//        npm run start:lan -- --go-offline --dry-run (show what --go-offline would do, change nothing)
//
// Runs the platform for a classroom: a production server that other devices on your Wi-Fi hotspot
// can reach by IP address, e.g. http://192.168.137.1:3000. Not for the internet: it serves plain
// HTTP, which is fine on a hotspot you control.
//
// A hotspot shares whatever the laptop itself is connected to, so students get internet only if the
// laptop has it. This script says whether it does, keeps watching while it runs, and with
// --go-offline disconnects the Wi-Fi for you (it changes no saved network and needs no admin rights).
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  describeAddresses,
  describeInternet,
  describeRefusal,
  disconnectWifi,
  isOnline,
  lanAddresses,
  reachable,
  startInternetMonitor,
} from "./lan-lib";

const root = path.resolve(__dirname, "..");
const port = Number(process.env.PORT ?? 3000);
const args = new Set(process.argv.slice(2));
const infoOnly = args.has("--info");
const requireOffline = args.has("--require-offline");
const goOffline = args.has("--go-offline");
const dryRun = args.has("--dry-run");
// Checked more often when it is disconnecting for you, so a reconnect is undone within seconds.
const MONITOR_MS = Number(process.env.LAN_MONITOR_MS ?? (goOffline ? 10_000 : 30_000));

const stamp = () => new Date().toLocaleTimeString();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const show = (lines: string[], prefix = "") => {
  for (const line of lines) console.log(`${prefix}${line}`);
};

async function main() {
  console.log("Quiz Platform, classroom mode\n");
  show(describeAddresses(lanAddresses(os.networkInterfaces()), port));

  console.log("");
  let online = await isOnline();
  show(describeInternet(online));

  if (goOffline && !infoOnly) {
    console.log("");
    if (!online) {
      console.log("--go-offline: this laptop is already offline, nothing to disconnect.");
    } else {
      const result = await disconnectWifi(undefined, { dryRun });
      console.log(`--go-offline: ${result.message}`);
      if (result.ok && !dryRun) {
        await sleep(3000); // Windows takes a moment to drop the connection
        online = await isOnline();
        if (online) {
          console.log("Still ONLINE after disconnecting the Wi-Fi: another connection is providing internet");
          console.log("(an Ethernet cable, USB tethering, or a second Wi-Fi adapter). Disconnect that too.");
        } else {
          console.log("This laptop is now offline. Students can only reach this platform.");
          if (!lanAddresses(os.networkInterfaces()).some((a) => a.kind === "hotspot")) {
            console.log("");
            console.log("The Mobile Hotspot is off (its address 192.168.137.1 is gone). Turn it on now:");
            console.log("Settings > Network & internet > Mobile hotspot. The server can keep running meanwhile.");
          }
        }
      }
    }
  }
  if (infoOnly || dryRun) {
    if (dryRun) console.log("\n[dry run] Stopping here without starting the server.");
    return;
  }

  if (requireOffline && online) {
    console.log("");
    show(describeRefusal(), "");
    process.exit(1);
  }
  console.log("");

  if (!existsSync(path.join(root, ".next", "BUILD_ID"))) {
    console.error("There is no production build yet. Run:  npm run build   (then start again)");
    process.exit(1);
  }

  if (await reachable("127.0.0.1", port)) {
    console.error(
      `Port ${port} is already in use. If \`npm run dev\` is running, stop it first (Ctrl+C in its window).`,
    );
    process.exit(1);
  }

  // The database is a separate program; a page would just fail without it.
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) {
    try {
      const { hostname, port: dbPort } = new URL(dbUrl);
      if (!(await reachable(hostname, Number(dbPort || 5432)))) {
        console.error(`Cannot reach the database at ${hostname}:${dbPort}. Start it in another window:  npm run db:dev`);
        process.exit(1);
      }
    } catch {
      /* an unusual URL: let the app report it */
    }
  }

  // Devices reach the site by IP, not "localhost". Auth.js refuses hosts it has not been told to
  // trust in production, and sign-in would fail for everyone, so it is switched on here.
  const env = { ...process.env, AUTH_TRUST_HOST: process.env.AUTH_TRUST_HOST ?? "true" };
  const next = path.join(root, "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [next, "start", "-H", "0.0.0.0", "-p", String(port)], {
    cwd: root,
    env,
    stdio: "inherit",
  });

  // Windows reconnects to known Wi-Fi networks by itself, so the laptop can come back online
  // mid-class. Say so the moment it happens, and with --go-offline undo it.
  const stopMonitor = startInternetMonitor({
    check: () => isOnline(),
    initial: online,
    intervalMs: MONITOR_MS,
    autoDisconnect: goOffline,
    whenOnline: goOffline
      ? async () => {
          const result = await disconnectWifi();
          console.log(`[${stamp()}] --go-offline: ${result.message}`);
        }
      : undefined,
    onNotice: (lines) => {
      console.log("");
      show(lines, `[${stamp()}] `);
      console.log("");
    },
  });

  child.on("exit", (code) => {
    stopMonitor();
    process.exit(code ?? 0);
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
}

void main();
