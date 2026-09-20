import { execFile } from "node:child_process";
import net from "node:net";
import type { NetworkInterfaceInfo } from "node:os";

export type LanAddress = {
  /** The adapter's name, e.g. "Local Area Connection* 2" or "Wi-Fi". */
  name: string;
  address: string;
  /** Windows Mobile Hotspot always uses 192.168.137.x, with the laptop at .1. */
  kind: "hotspot" | "other";
};

const isHotspot = (address: string) => address.startsWith("192.168.137.");

/**
 * The IPv4 addresses other devices could use to reach this computer, hotspot first. Skips loopback
 * (127.x, only this computer) and link-local (169.254.x, a network that never got an address).
 */
export function lanAddresses(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>,
): LanAddress[] {
  const found: LanAddress[] = [];
  for (const [name, list] of Object.entries(interfaces)) {
    for (const info of list ?? []) {
      if (info.family !== "IPv4" || info.internal) continue;
      if (info.address.startsWith("169.254.")) continue;
      found.push({ name, address: info.address, kind: isHotspot(info.address) ? "hotspot" : "other" });
    }
  }
  return found.sort(
    (a, b) =>
      Number(b.kind === "hotspot") - Number(a.kind === "hotspot") || a.address.localeCompare(b.address),
  );
}

/** The lines shown to the teacher: which address the students should type. */
export function describeAddresses(addresses: LanAddress[], port: number): string[] {
  const lines: string[] = [];
  if (addresses.length === 0) {
    lines.push("No network address found. Turn on the Wi-Fi hotspot (or connect to a network).");
    return lines;
  }
  lines.push("Students open this in their browser:");
  for (const a of addresses) {
    const note =
      a.kind === "hotspot"
        ? "<- Windows Mobile Hotspot (give students this one)"
        : `(${a.name}; only devices on that same network can use it)`;
    lines.push(`  http://${a.address}:${port}   ${note}`);
  }
  if (!addresses.some((a) => a.kind === "hotspot")) {
    lines.push("");
    lines.push("The hotspot address (192.168.137.1) is not listed, so the Mobile Hotspot is off.");
    lines.push("Turn it on: Settings > Network & internet > Mobile hotspot. It only exists while on.");
  }
  return lines;
}

// ---------------------------------------------------------------------------------------------
// Is this laptop online? A hotspot shares whatever the laptop is connected to, so if the laptop can
// reach the internet, so can every student on the hotspot.
// ---------------------------------------------------------------------------------------------

/** True if something accepts a TCP connection at host:port within the time limit. */
export function reachable(host: string, port: number, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

export type Probe = (host: string, port: number, timeoutMs: number) => Promise<boolean>;
export type Target = { host: string; port: number };

// Well-known public addresses that answer on HTTPS. Several, so one being down is not read as
// "offline". Plain IP addresses, so the check does not depend on DNS.
export const INTERNET_TARGETS: Target[] = [
  { host: "1.1.1.1", port: 443 },
  { host: "8.8.8.8", port: 443 },
  { host: "9.9.9.9", port: 443 },
];

/**
 * Whether this computer can reach the internet: true as soon as any target answers, false once all
 * have failed or timed out. The probe is a parameter so tests never touch the real network.
 */
export function isOnline(
  probe: Probe = reachable,
  targets: Target[] = INTERNET_TARGETS,
  timeoutMs = 2000,
): Promise<boolean> {
  if (targets.length === 0) return Promise.resolve(false);
  return new Promise((resolve) => {
    let pending = targets.length;
    const failed = () => {
      if (--pending === 0) resolve(false);
    };
    for (const target of targets) {
      probe(target.host, target.port, timeoutMs).then((ok) => (ok ? resolve(true) : failed()), failed);
    }
  });
}

const CUT_OFF_STEPS = [
  "To cut students off from the internet:",
  "  1. Windows rejoins ANY saved Wi-Fi in range that is set to \"Connect automatically\". Settings >",
  "     Network & internet > Wi-Fi > Manage known networks: turn that OFF for networks you may be near.",
  "  2. Disconnect the laptop from that network (Wi-Fi menu > Disconnect, or run: netsh wlan disconnect).",
  "  3. Turn the Mobile hotspot on. It only needs to be on, not connected to anything.",
  "  4. Ask students to turn their mobile data off: their own data plan is outside your laptop's control.",
  "  If Windows will not start the hotspot while offline, see docs/CLASSROOM.md.",
];

/** The lines printed at start-up (and by `npm run lan:info`) about the laptop's internet. */
export function describeInternet(online: boolean): string[] {
  if (online) {
    return [
      "INTERNET: this laptop is ONLINE, so students on your hotspot can use the internet too.",
      ...CUT_OFF_STEPS,
      "Start with --require-offline to refuse to run while this laptop is online.",
    ];
  }
  return [
    "INTERNET: this laptop is offline, so the hotspot shares no internet.",
    "Students can only reach this platform. (Their own mobile data is not affected: ask them to turn it off.)",
  ];
}

/** What is printed when `--require-offline` stops the server from starting. */
export function describeRefusal(): string[] {
  return ["Not starting: --require-offline is set, and this laptop is online.", ...CUT_OFF_STEPS];
}

/**
 * What to print when the laptop's internet status changes while the server runs, or null for no
 * change. Windows reconnects to known Wi-Fi networks on its own, so going online mid-class is real.
 * With `autoDisconnect` the script is about to disconnect the Wi-Fi again by itself.
 */
export function internetNotice(
  previous: boolean | null,
  current: boolean,
  options: { autoDisconnect?: boolean } = {},
): string[] | null {
  if (previous === null || previous === current) return null;
  if (current) {
    return [
      "!! WARNING: this laptop is now ONLINE. Students on your hotspot can reach the internet again.",
      options.autoDisconnect
        ? "   Disconnecting the Wi-Fi again automatically."
        : "   Disconnect the laptop from its Wi-Fi (netsh wlan disconnect) and turn off \"Connect automatically\".",
    ];
  }
  return ["OK: this laptop is offline again. Students can only reach this platform."];
}

// ---------------------------------------------------------------------------------------------
// Disconnecting the laptop's own Wi-Fi (opt-in, `--go-offline`). This only ends the current
// connection: it changes no saved network, needs no administrator rights, and the laptop can
// reconnect at any time. The hotspot is a separate virtual adapter that `netsh wlan` does not list.
// ---------------------------------------------------------------------------------------------

export type CommandResult = { code: number; output: string };
export type Runner = (command: string, args: string[]) => Promise<CommandResult>;

/** Runs a program and returns its exit code and text. Never throws. */
export const runCommand: Runner = (command, args) =>
  new Promise((resolve) => {
    execFile(command, args, { timeout: 10_000, windowsHide: true }, (error, stdout, stderr) => {
      const output = `${stdout}${stderr}`.trim();
      const code = error ? (typeof (error as { code?: unknown }).code === "number" ? (error as { code: number }).code : 1) : 0;
      resolve({ code, output });
    });
  });

/**
 * Reads `netsh wlan show interfaces` for the wireless adapters and whether each is connected. It
 * looks for the English labels; on a Windows in another language nothing is found, and the caller
 * falls back to a plain `netsh wlan disconnect`.
 */
export function parseWifiInterfaces(output: string): { name: string; connected: boolean }[] {
  const found: { name: string; connected: boolean }[] = [];
  for (const line of output.split(/\r?\n/)) {
    const name = /^\s*Name\s*:\s*(.+?)\s*$/.exec(line);
    if (name) {
      found.push({ name: name[1], connected: false });
      continue;
    }
    const state = /^\s*State\s*:\s*(.+?)\s*$/.exec(line);
    if (state && found.length > 0) found[found.length - 1].connected = /^connected$/i.test(state[1]);
  }
  return found;
}

export type DisconnectResult = { ok: boolean; message: string; commands: string[] };

/**
 * Disconnects the laptop's Wi-Fi from whatever network it is on. Finds the connected wireless
 * adapters first and disconnects exactly those; if it cannot tell, it runs a plain disconnect.
 * With `dryRun` it only reads (`show interfaces`) and reports what it would run.
 */
export async function disconnectWifi(
  run: Runner = runCommand,
  options: { platform?: NodeJS.Platform; dryRun?: boolean } = {},
): Promise<DisconnectResult> {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") {
    return {
      ok: false,
      message: "Disconnecting Wi-Fi from here is only supported on Windows. Disconnect it yourself.",
      commands: [],
    };
  }

  const shown = await run("netsh", ["wlan", "show", "interfaces"]);
  const connected = shown.code === 0 ? parseWifiInterfaces(shown.output).filter((i) => i.connected) : [];
  const plans =
    connected.length > 0
      ? connected.map((i) => ({ label: i.name, args: ["wlan", "disconnect", `interface=${i.name}`] }))
      : [{ label: "Wi-Fi", args: ["wlan", "disconnect"] }];
  const commands = plans.map((p) => `netsh ${p.args.join(" ")}`);

  if (options.dryRun) {
    return { ok: true, message: `[dry run] would run: ${commands.join("  and  ")} (nothing was changed)`, commands };
  }

  const failures: string[] = [];
  for (const plan of plans) {
    const result = await run("netsh", plan.args);
    if (result.code !== 0) failures.push(`${plan.label}: ${result.output || `exit code ${result.code}`}`);
  }
  return failures.length === 0
    ? { ok: true, message: `Disconnected Wi-Fi (${plans.map((p) => p.label).join(", ")}).`, commands }
    : { ok: false, message: `Could not disconnect Wi-Fi. ${failures.join("; ")}`, commands };
}

/**
 * Re-checks the internet every `intervalMs` and calls `onNotice` when the status changes. While the
 * laptop is online it also calls `whenOnline` (used to disconnect the Wi-Fi again), on every check
 * and not only on the change, so a laptop that keeps reconnecting keeps being disconnected.
 * Returns a function that stops it. Checks never overlap: a slow one just delays the next.
 */
export function startInternetMonitor(options: {
  check: () => Promise<boolean>;
  initial: boolean;
  onNotice: (lines: string[]) => void;
  intervalMs: number;
  whenOnline?: () => Promise<void>;
  /** Passed to `internetNotice`, so the message says the Wi-Fi is being disconnected for you. */
  autoDisconnect?: boolean;
}): () => void {
  let last: boolean = options.initial;
  let running = false;
  let stopped = false;

  const timer = setInterval(async () => {
    if (running || stopped) return;
    running = true;
    try {
      const now = await options.check();
      if (stopped) return;
      const notice = internetNotice(last, now, { autoDisconnect: options.autoDisconnect });
      last = now;
      if (notice) options.onNotice(notice);
      if (now && options.whenOnline) await options.whenOnline();
    } catch {
      // A failed check says nothing about the connection; keep the last known state.
    } finally {
      running = false;
    }
  }, options.intervalMs);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
