# Running the quiz platform in a classroom (laptop + Wi-Fi hotspot)

Your laptop is the server. It shares a Wi-Fi hotspot; students connect their phones or laptops to it and
open the platform by typing the laptop's address in their browser. No internet is needed while the quiz runs.

## How it fits together

```
 students' phones ──Wi-Fi──▶  YOUR LAPTOP  (hotspot 192.168.137.1)
                              ├─ the quiz platform   http://192.168.137.1:3000
                              └─ the database        (same laptop)
```

**Tested:** 30 students signing in, taking a 10-question quiz and handing in at the same moment finished in
about 6 seconds with no failed requests. Sign-in is the slowest step (about 1 second each when everyone does it at once).

## Know this first: Windows allows only 8 devices on the hotspot

Windows Mobile Hotspot lets **at most 8 devices** connect at the same time. For a bigger class use a cheap
Wi-Fi router instead (see "More than 8 students" at the end). Everything else in this guide stays the same.

## One-time setup

1. **Let other devices through the Windows firewall.** Open **PowerShell as Administrator** (right-click Start >
   Terminal (Admin)) and run:

   ```powershell
   New-NetFirewallRule -DisplayName "Quiz Platform (classroom)" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -Profile Any -RemoteAddress LocalSubnet
   ```

   This allows only devices on the same local network (your hotspot), not the internet.
   (Windows may also pop up "Allow Node.js to communicate…". Tick **both** Private and Public and click Allow.)

2. **Stop the hotspot turning itself off.** Settings > Network & internet > **Mobile hotspot** > turn **Power saving off**.
   (When it is on, Windows switches the hotspot off when no device is connected, and the address disappears.)

3. **Stop the laptop sleeping.** Settings > System > Power > Screen and sleep > set "When plugged in, put my device
   to sleep" to **Never**. Keep the charger plugged in during class.

4. **Build the app once** (needs internet the first time; repeat only after the code changes):

   ```
   npm run build
   ```

## Every class day

Open two terminal windows in the project folder.

| Window | Command | Leave it… |
|---|---|---|
| 1 | `npm run db:dev` | running the whole class |
| 2 | `npm run start:lan` | running the whole class |

(Stop `npm run dev` first if it is running: both want port 3000.)

Then:

1. **Turn the Mobile hotspot on** (Settings > Network & internet > Mobile hotspot). Note the network name and password.
2. **Check the address.** `start:lan` prints it. Normally it is **`http://192.168.137.1:3000`**. To print it again:
   `npm run lan:info`. If it says the hotspot is off, turn it on.
3. **Open the platform yourself using that address** (not `localhost`), for example `http://192.168.137.1:3000/admin`.
   This matters: the "Copy link" button for a class code copies the address you are using, so a link copied from
   `localhost` would not work on students' phones.
4. Publish your quiz. Give students the **network name, password and address**. Write them on the board.

### What students do

1. Connect to your Wi-Fi network (the hotspot).
2. Open the browser and type the address, e.g. `http://192.168.137.1:3000`.
3. First time only: tap **Create an account**, enter the **class code** you gave them, their name, email and a password.
   Afterwards they just sign in.

**If a phone says "no internet" and won't open the page:** the phone is quietly using mobile data instead. Turn
**mobile data off**, or choose "stay connected" when Android asks about the Wi-Fi.

## Keeping students off the internet (so they can only use the platform)

Two different things could give a student internet, and you control only one of them:

| Source of internet | Can you stop it? |
|---|---|
| **Through your hotspot** (your laptop shares its own connection) | **Yes.** |
| **The student's own mobile data (SIM card)** | **No.** Nothing on your laptop can switch off another person's data plan. Ask them to turn it off, and watch the room. |

**The platform itself needs no internet.** Checked: the pages load no fonts, scripts or images from outside (fonts are
stored on the laptop), and the server makes no outside calls while running. So a class can run fully offline.

### Stopping the hotspot from sharing internet

The hotspot only shares what the laptop itself is connected to. So the rule is simple: **while class runs, the laptop
must not be connected to anything that has internet.**

- **Best and most reliable: a Wi-Fi router with nothing plugged into its "WAN/Internet" port.** It has nowhere to send
  traffic, so there is no internet by construction, and it also lifts the 8-device limit. Connect the laptop to it
  (see "More than 8 students").
- **Using the laptop's Mobile Hotspot:** disconnect the laptop from the internet, then make sure it stays disconnected.
  1. **Disconnect:** Wi-Fi menu > Disconnect, or run `netsh wlan disconnect`. Also unplug any Ethernet cable and turn
     off any mobile data on the laptop.
  2. **Stop Windows rejoining by itself.** Windows reconnects to *any* saved network in range that is set to
     "Connect automatically". Check the list in Settings > Network & internet > Wi-Fi > Manage known networks (or run
     `netsh wlan show profiles`, then `netsh wlan show profile name="NAME"` and look for "Connection mode"). On the
     teacher's laptop, 8 saved networks had it on, so switching off just the home network is **not** enough.
     Either turn it off for the networks you might be near during class, or rely on the warning below.
  3. **Turn the hotspot on.** The hotspot and the laptop's own Wi-Fi share one Wi-Fi card.
  4. **Start the server with `npm run start:lan -- --require-offline`.** It refuses to start while the laptop is
     online, and while it runs it re-checks every 30 seconds. If Windows rejoins a network, it prints a
     `WARNING: this laptop is now ONLINE` line so you can disconnect again.

  **Shortcut: let the script do steps 1 and 4.** `npm run start:lan -- --go-offline` disconnects the laptop's Wi-Fi
  for you and, while it runs, disconnects it again within about 10 seconds whenever Windows rejoins a network. It
  changes **no saved network settings** and needs **no administrator rights**; it only ends the current connection, and
  the laptop can reconnect whenever you like afterwards. It disconnects the laptop's own Wi-Fi only (by adapter name),
  not the hotspot. If internet is still there afterwards, another connection is providing it (an Ethernet cable, USB
  tethering or a second Wi-Fi adapter), and it tells you. To see what it would do without doing it, add `--dry-run`
  (it prints the exact command and stops without starting the server). Combine with `--require-offline` to refuse to
  start if the laptop is still online. Turn the hotspot on yourself (step 3); if the hotspot disappears when the Wi-Fi
  disconnects, the script prints a reminder to turn it back on.

  If Windows refuses to start the hotspot while offline ("no Wi-Fi or Ethernet connection"), it wants *some* connection
  to share. Connect the laptop to a network that has no internet, or add a Windows "Microsoft KM-TEST Loopback Adapter"
  (Device Manager > Action > Add legacy hardware), which is a commonly used workaround. **These Windows behaviours are
  not tested here (doing so would cut off the machine used to build this); try them once before the real class.**
- **Check that it worked:** on a phone joined to the hotspot, with mobile data off, open any website such as
  `example.com`. It should fail, while `http://192.168.137.1:3000` still works. `npm run lan:info` shows your addresses.

### What students' phones do

A Wi-Fi with no internet makes phones say "connected, no internet". Android may ask "Stay connected?" (answer **Yes**)
and may quietly use mobile data instead, which is why the platform sometimes seems not to load. Tell students to
**turn mobile data off (or use airplane mode, then turn Wi-Fi on)** before joining. This one step both keeps them
off the internet and makes the platform load reliably.

### Two more things when there is no internet

- **Set the laptop's clock correctly before class.** Without internet the clock cannot update itself. Quiz open/close
  times and every timer use the laptop's clock.
- **Keep the laptop plugged in and the hotspot on**, as before. Nothing else changes.

## After class

Press `Ctrl+C` in both windows. Your data lives in the `.pglite` folder in the project. To back it up, stop
`npm run db:dev` and copy that folder somewhere safe (for example a USB drive).

## When something goes wrong

| Symptom | Likely cause and fix |
|---|---|
| Phones can't open the page, but it works on your laptop | Firewall: run the one-time command above. Also check the phone is on the hotspot and you gave it the right address. |
| The address `192.168.137.1` is not shown / page stops loading mid-class | The hotspot switched off. Turn it on again and turn **Power saving off**. |
| Windows won't turn the hotspot on ("no Wi-Fi or Ethernet connection") | Windows wants some network connection to share. Connect the laptop to any Wi-Fi or an Ethernet cable, even without internet. |
| Sign-in fails for students but works for you | Start the server with `npm run start:lan` (it enables this). If you start it another way, add `AUTH_TRUST_HOST=true` to `.env`. |
| "Connection terminated unexpectedly" on a page | The local database stopped or was restarted. Check window 1 is still running `npm run db:dev`; if not, start it again. Your data is kept. |
| `Port 3000 is already in use` | `npm run dev` is still running. Close it. |
| "There is no production build yet" | Run `npm run build` first. |
| A student's quiz timer looks different from their phone clock | Normal. The countdown is the server's; the phone's clock is never used. |

## Good to know

- **Plain HTTP, no padlock.** Fine on a hotspot you control. Use a strong hotspot password and tell students not to
  reuse a password they use elsewhere.
- **The built-in database** needs nothing installed and is plenty for a class. It is a development database:
  the security rule that separates one school's data from another's is not active on it (you have one school, so
  nothing is exposed). For a shared or permanent server, use a real PostgreSQL.
- **Quiz timers keep running on the server** if a student's phone locks or the browser is closed. They can reopen the
  same address and continue. Their answers were saved as they went.

## More than 8 students: use a Wi-Fi router

1. Plug in a small Wi-Fi router (it does not need internet) and connect your laptop to it, by cable if you can.
2. Find your laptop's address on that network with `npm run lan:info` (something like `192.168.0.x`).
3. Students join the router's Wi-Fi and type `http://<that address>:3000`.
4. Ask the router to always give the laptop the same address ("DHCP reservation"), or set a fixed address on the
   laptop, so the address doesn't change between classes.

The firewall command, `start:lan`, and everything else work the same.
