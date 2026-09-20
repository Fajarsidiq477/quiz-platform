import type { NetworkInterfaceInfo } from "node:os";
import { describe, expect, it } from "vitest";
import { describeAddresses, lanAddresses } from "../scripts/lan-lib";

const iface = (address: string, over: Partial<NetworkInterfaceInfo> = {}): NetworkInterfaceInfo => ({
  address,
  netmask: "255.255.255.0",
  family: "IPv4",
  mac: "00:00:00:00:00:00",
  internal: false,
  cidr: `${address}/24`,
  ...over,
}) as NetworkInterfaceInfo;

describe("lanAddresses", () => {
  it("finds the hotspot address and lists it first", () => {
    const found = lanAddresses({
      "Wi-Fi": [iface("192.168.1.17")],
      "Ethernet 2": [iface("192.168.56.1")],
      "Local Area Connection* 2": [iface("192.168.137.1")],
    });
    expect(found.map((a) => a.address)).toEqual(["192.168.137.1", "192.168.1.17", "192.168.56.1"]);
    expect(found[0]).toMatchObject({ kind: "hotspot", name: "Local Area Connection* 2" });
    expect(found.slice(1).every((a) => a.kind === "other")).toBe(true);
  });

  it("ignores loopback, link-local, IPv6 and adapters with no addresses", () => {
    const found = lanAddresses({
      Loopback: [iface("127.0.0.1", { internal: true })],
      "Not connected": [iface("169.254.10.20")],
      V6: [iface("fe80::1", { family: "IPv6" })],
      Empty: [],
      Missing: undefined,
      "Wi-Fi": [iface("10.0.0.5")],
    });
    expect(found.map((a) => a.address)).toEqual(["10.0.0.5"]);
  });

  it("returns nothing when there is no network", () => {
    expect(lanAddresses({})).toEqual([]);
  });
});

describe("describeAddresses", () => {
  it("tells students to use the hotspot address, with the port", () => {
    const lines = describeAddresses(
      lanAddresses({ hotspot: [iface("192.168.137.1")], "Wi-Fi": [iface("192.168.1.17")] }),
      3000,
    );
    expect(lines.join("\n")).toContain("http://192.168.137.1:3000");
    expect(lines.join("\n")).toContain("give students this one");
    expect(lines.join("\n")).toContain("http://192.168.1.17:3000");
    expect(lines.join("\n")).not.toContain("hotspot is off");
  });

  it("warns when the hotspot is not on", () => {
    const text = describeAddresses(lanAddresses({ "Wi-Fi": [iface("192.168.1.17")] }), 3000).join("\n");
    expect(text).toContain("Mobile Hotspot is off");
    expect(text).toContain("Mobile hotspot");
  });

  it("says so when there is no address at all", () => {
    expect(describeAddresses([], 3000).join(" ")).toMatch(/No network address/);
  });
});

// ------------------------------------------------------------------------------------------
// Internet check (a hotspot shares whatever the laptop is connected to)
// ------------------------------------------------------------------------------------------
import net from "node:net";
import { afterEach, beforeEach, vi } from "vitest";
import {
  INTERNET_TARGETS,
  describeInternet,
  describeRefusal,
  internetNotice,
  isOnline,
  reachable,
  startInternetMonitor,
  type Probe,
} from "../scripts/lan-lib";

describe("isOnline", () => {
  it("is online as soon as any target answers, without waiting for the others", async () => {
    const never = new Promise<boolean>(() => {});
    const probe: Probe = (host) => (host === "8.8.8.8" ? Promise.resolve(true) : never);
    await expect(isOnline(probe)).resolves.toBe(true);
  });

  it("is offline only when every target has failed", async () => {
    const seen: string[] = [];
    const probe: Probe = async (host) => {
      seen.push(host);
      return false;
    };
    await expect(isOnline(probe)).resolves.toBe(false);
    expect(seen.sort()).toEqual(INTERNET_TARGETS.map((t) => t.host).sort()); // it tried them all
  });

  it("treats a probe that throws as a failure, not as a crash", async () => {
    const probe: Probe = async () => {
      throw new Error("network unreachable");
    };
    await expect(isOnline(probe)).resolves.toBe(false);
  });

  it("is still online if one target throws and another answers", async () => {
    const probe: Probe = async (host) => {
      if (host === "1.1.1.1") throw new Error("boom");
      return host === "9.9.9.9";
    };
    await expect(isOnline(probe)).resolves.toBe(true);
  });

  it("is offline with no targets, and passes the time limit on", async () => {
    await expect(isOnline(async () => true, [])).resolves.toBe(false);
    const probe = vi.fn<Probe>(async () => false);
    await isOnline(probe, [{ host: "1.1.1.1", port: 443 }], 777);
    expect(probe).toHaveBeenCalledWith("1.1.1.1", 443, 777);
  });

  it("probes public IP addresses (no DNS needed) on the HTTPS port", () => {
    expect(INTERNET_TARGETS.length).toBeGreaterThanOrEqual(3);
    for (const t of INTERNET_TARGETS) {
      expect(net.isIPv4(t.host)).toBe(true);
      expect(t.port).toBe(443);
    }
  });
});

describe("reachable (real sockets, on this machine only)", () => {
  it("is true for a listening port and false for a closed one", async () => {
    const server = net.createServer((s) => s.end());
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const { port } = server.address() as net.AddressInfo;
    try {
      await expect(reachable("127.0.0.1", port, 1000)).resolves.toBe(true);
    } finally {
      await new Promise((r) => server.close(r));
    }
    await expect(reachable("127.0.0.1", port, 1000)).resolves.toBe(false); // now closed
  });

  it("gives up on an unreachable address within the time limit", async () => {
    const started = Date.now();
    // 192.0.2.0/24 is reserved for documentation and never routed, so nothing answers.
    await expect(reachable("192.0.2.1", 443, 300)).resolves.toBe(false);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe("internet messages", () => {
  it("online: says students can use the internet, gives the steps and the flag", () => {
    const text = describeInternet(true).join("\n");
    expect(text).toContain("ONLINE");
    expect(text).toContain("students on your hotspot can use the internet");
    expect(text).toContain("Connect automatically");
    expect(text).toContain("netsh wlan disconnect");
    expect(text).toContain("--require-offline");
    expect(text).toContain("mobile data");
  });

  it("offline: says students can only reach the platform, and that mobile data is separate", () => {
    const text = describeInternet(false).join("\n");
    expect(text).toContain("offline");
    expect(text).toContain("only reach this platform");
    expect(text).toContain("mobile data");
    expect(text).not.toContain("ONLINE");
  });

  it("the refusal names the flag and repeats the steps", () => {
    const text = describeRefusal().join("\n");
    expect(text).toContain("--require-offline");
    expect(text).toContain("Not starting");
    expect(text).toContain("netsh wlan disconnect");
  });

  it("notices a change of state, and nothing else", () => {
    expect(internetNotice(false, true)?.join("\n")).toMatch(/WARNING.*ONLINE/);
    expect(internetNotice(true, false)?.join("\n")).toMatch(/offline again/);
    expect(internetNotice(true, true)).toBeNull();
    expect(internetNotice(false, false)).toBeNull();
    expect(internetNotice(null, true)).toBeNull(); // the start-up message covers the first reading
    expect(internetNotice(null, false)).toBeNull();
  });
});

describe("startInternetMonitor", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = (initial: boolean, results: (boolean | Error)[]) => {
    const notices: string[][] = [];
    let i = 0;
    const check = vi.fn(async () => {
      const r = results[Math.min(i++, results.length - 1)];
      if (r instanceof Error) throw r;
      return r;
    });
    const stop = startInternetMonitor({ check, initial, intervalMs: 1000, onNotice: (l) => notices.push(l) });
    return { notices, check, stop };
  };

  it("warns once when the laptop goes online, and once when it goes offline again", async () => {
    const { notices, stop } = setup(false, [false, true, true, true, false, false]);
    await vi.advanceTimersByTimeAsync(6000);
    expect(notices).toHaveLength(2);
    expect(notices[0].join(" ")).toMatch(/now ONLINE/);
    expect(notices[1].join(" ")).toMatch(/offline again/);
    stop();
  });

  it("stays silent while nothing changes", async () => {
    const { notices, check, stop } = setup(false, [false]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(check).toHaveBeenCalledTimes(5);
    expect(notices).toEqual([]);
    stop();
  });

  it("does not report an online laptop that started online (the start-up message did)", async () => {
    const { notices, stop } = setup(true, [true]);
    await vi.advanceTimersByTimeAsync(3000);
    expect(notices).toEqual([]);
    stop();
  });

  it("keeps the last known state when a check fails", async () => {
    const { notices, stop } = setup(false, [new Error("x"), new Error("y"), true]);
    await vi.advanceTimersByTimeAsync(3000);
    expect(notices).toHaveLength(1); // only the real change is reported
    expect(notices[0].join(" ")).toMatch(/now ONLINE/);
    stop();
  });

  it("never runs two checks at once, and stops when asked", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const check = vi.fn(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 2500)); // slower than the interval
      inFlight--;
      return false;
    });
    const stop = startInternetMonitor({ check, initial: false, intervalMs: 1000, onNotice: () => {} });
    await vi.advanceTimersByTimeAsync(8000);
    expect(maxInFlight).toBe(1);
    const calls = check.mock.calls.length;
    stop();
    await vi.advanceTimersByTimeAsync(8000);
    expect(check.mock.calls.length).toBe(calls); // nothing after stop
  });
});

// ------------------------------------------------------------------------------------------
// Disconnecting the laptop's own Wi-Fi (--go-offline)
// ------------------------------------------------------------------------------------------
import { disconnectWifi, parseWifiInterfaces, runCommand, type Runner } from "../scripts/lan-lib";

const NETSH_ONE_CONNECTED = `
There is 1 interface on the system:

    Name                   : Wi-Fi
    Description            : Realtek RTL8852BE WiFi 6 802.11ax PCIe Adapter
    State                  : connected
    SSID                   : WIF1HOME_5G
    Signal                 : 85%
`;
const NETSH_TWO = `
    Name                   : Wi-Fi
    State                  : connected
    SSID                   : Home

    Name                   : Wi-Fi 2
    State                  : disconnected
`;

describe("parseWifiInterfaces", () => {
  it("reads each adapter and whether it is connected", () => {
    expect(parseWifiInterfaces(NETSH_ONE_CONNECTED)).toEqual([{ name: "Wi-Fi", connected: true }]);
    expect(parseWifiInterfaces(NETSH_TWO)).toEqual([
      { name: "Wi-Fi", connected: true },
      { name: "Wi-Fi 2", connected: false },
    ]);
  });

  it("does not mistake 'disconnected' for connected, and copes with junk and CRLF", () => {
    expect(parseWifiInterfaces("Name : X\r\nState : disconnected\r\n")).toEqual([{ name: "X", connected: false }]);
    expect(parseWifiInterfaces("")).toEqual([]);
    expect(parseWifiInterfaces("no interfaces here")).toEqual([]);
    expect(parseWifiInterfaces("State : connected")).toEqual([]); // a state with no adapter before it
  });

  it("finds nothing on a Windows in another language (labels differ), so the caller falls back", () => {
    expect(parseWifiInterfaces("    Nama : Wi-Fi\n    Status : terhubung\n")).toEqual([]);
  });
});

/** A fake `netsh`: records every call and answers `show interfaces` with the given text. */
function fakeNetsh(show: string, opts: { showCode?: number; disconnectCode?: number } = {}) {
  const calls: string[] = [];
  const run: Runner = async (command, args) => {
    calls.push([command, ...args].join(" "));
    if (args[1] === "show") return { code: opts.showCode ?? 0, output: show };
    return { code: opts.disconnectCode ?? 0, output: opts.disconnectCode ? "The request was refused" : "ok" };
  };
  return { run, calls };
}

describe("disconnectWifi", () => {
  it("disconnects exactly the connected adapter, by name", async () => {
    const { run, calls } = fakeNetsh(NETSH_TWO);
    const result = await disconnectWifi(run, { platform: "win32" });
    expect(result.ok).toBe(true);
    expect(calls).toEqual(["netsh wlan show interfaces", "netsh wlan disconnect interface=Wi-Fi"]);
    expect(result.message).toContain("Wi-Fi");
  });

  it("does nothing to adapters that are not connected", async () => {
    const { run, calls } = fakeNetsh(NETSH_TWO);
    await disconnectWifi(run, { platform: "win32" });
    expect(calls.some((c) => c.includes("Wi-Fi 2"))).toBe(false);
  });

  it("falls back to a plain disconnect when it cannot read the adapters", async () => {
    for (const show of [
      { text: "", code: 0 },
      { text: "garbage", code: 0 },
      { text: "boom", code: 1 },
    ]) {
      const { run, calls } = fakeNetsh(show.text, { showCode: show.code });
      const result = await disconnectWifi(run, { platform: "win32" });
      expect(result.ok).toBe(true);
      expect(calls.at(-1)).toBe("netsh wlan disconnect");
    }
  });

  it("dry run reads but never disconnects, and says what it would do", async () => {
    const { run, calls } = fakeNetsh(NETSH_ONE_CONNECTED);
    const result = await disconnectWifi(run, { platform: "win32", dryRun: true });
    expect(calls).toEqual(["netsh wlan show interfaces"]); // read-only: no disconnect was run
    expect(result.ok).toBe(true);
    expect(result.message).toContain("[dry run]");
    expect(result.message).toContain("netsh wlan disconnect interface=Wi-Fi");
    expect(result.message).toContain("nothing was changed");
    expect(result.commands).toEqual(["netsh wlan disconnect interface=Wi-Fi"]);
  });

  it("reports a failed disconnect instead of pretending it worked", async () => {
    const { run } = fakeNetsh(NETSH_ONE_CONNECTED, { disconnectCode: 1 });
    const result = await disconnectWifi(run, { platform: "win32" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Could not disconnect");
    expect(result.message).toContain("The request was refused");
  });

  it("does nothing off Windows, and says so", async () => {
    const { run, calls } = fakeNetsh(NETSH_ONE_CONNECTED);
    const result = await disconnectWifi(run, { platform: "linux" });
    expect(calls).toEqual([]);
    expect(result).toMatchObject({ ok: false, commands: [] });
    expect(result.message).toContain("only supported on Windows");
  });
});

describe("runCommand (a real program, not netsh)", () => {
  it("returns the output and a zero exit code", async () => {
    const r = await runCommand(process.execPath, ["-e", "console.log('hello'); console.error('warn')"]);
    expect(r.code).toBe(0);
    expect(r.output).toContain("hello");
    expect(r.output).toContain("warn");
  });

  it("returns the exit code instead of throwing", async () => {
    const r = await runCommand(process.execPath, ["-e", "process.exit(3)"]);
    expect(r.code).toBe(3);
  });

  it("returns a non-zero code for a program that does not exist", async () => {
    const r = await runCommand("definitely-not-a-real-program-xyz", []);
    expect(r.code).not.toBe(0);
  });
});

describe("internetNotice and the monitor with --go-offline", () => {
  it("says the Wi-Fi is being disconnected again automatically", () => {
    const text = internetNotice(false, true, { autoDisconnect: true })?.join(" ");
    expect(text).toContain("now ONLINE");
    expect(text).toContain("Disconnecting the Wi-Fi again automatically");
    expect(text).not.toContain("netsh wlan disconnect");
    expect(internetNotice(false, true)?.join(" ")).toContain("netsh wlan disconnect"); // manual advice by default
  });

  describe("whenOnline", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("runs on every check while online, not only on the change, and never while offline", async () => {
      const results = [false, true, true, true, false, false];
      let i = 0;
      const whenOnline = vi.fn(async () => {});
      const stop = startInternetMonitor({
        check: async () => results[Math.min(i++, results.length - 1)],
        initial: false,
        intervalMs: 1000,
        whenOnline,
        onNotice: () => {},
      });
      await vi.advanceTimersByTimeAsync(6000);
      expect(whenOnline).toHaveBeenCalledTimes(3); // the three online checks
      stop();
    });

    it("keeps monitoring even if the disconnect itself fails", async () => {
      let checks = 0;
      const notices: string[][] = [];
      const stop = startInternetMonitor({
        check: async () => ++checks >= 2, // offline first, then online
        initial: false,
        intervalMs: 1000,
        whenOnline: async () => {
          throw new Error("netsh exploded");
        },
        onNotice: (l) => notices.push(l),
      });
      await vi.advanceTimersByTimeAsync(4000);
      expect(checks).toBeGreaterThanOrEqual(4); // still running after the failure
      expect(notices).toHaveLength(1);
      stop();
    });

    it("does nothing extra when whenOnline is not given", async () => {
      const notices: string[][] = [];
      const stop = startInternetMonitor({
        check: async () => true,
        initial: false,
        intervalMs: 1000,
        onNotice: (l) => notices.push(l),
      });
      await vi.advanceTimersByTimeAsync(3000);
      expect(notices).toHaveLength(1);
      stop();
    });
  });
});
