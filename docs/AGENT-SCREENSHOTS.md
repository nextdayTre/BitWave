# Agent screenshots — reproducible states

The **URL is the screenshot contract**: reloading a `#bw=` deeplink reproduces the view
byte-for-byte as far as the instrument's state is concerned. Beside the pixels, the page
also exposes its machine-readable state at `#bitwave-state` (see
[`AGENT-INTERFACE.md`](AGENT-INTERFACE.md) §6).

So prefer a **deeplink + state JSON pair** over prose, and never infer state from pixels.
The images in `docs/agent/` are reproducibility fixtures, not the source of truth.

Since the external-routing slice (toolset `1.1.0`, `.bitwave` schema 3; schema 4 since toolset `1.2.0`, D44; compact `#bw=` links since toolset `1.3.0`, D45) the default view
also contains the **Record** control and the source table can carry **`expr`** rows. Since
the dynamic-lanes slice (toolset `1.4.0`, D43–D46) the stage bar's lane control is a native
**lane dropdown** (`Lane 1`…`Lane 8`) and the frames view manages the live 1–8 lane set;
all images here were recaptured from the current artifact so they show those controls. The
Record take is transient session state, so its screenshot is driven over CDP rather than
through a deeplink; everything else is still a link.

This page records the recipes behind six states:

| state | file | what it shows |
|---|---|---|
| default | `docs/agent/default.png` | boot instrument, 64-bit lane 1, defaults (Record idle, lane dropdown) |
| A·B pair | `docs/agent/ab-xor.png` | lane 1 `8ADEFEDA85210125 ⊕ FFFFFFFF00000000`, both operands visible |
| width change | `docs/agent/width-16.png` | the same instrument at 16 bits (4 nibbles) |
| agent tab | `docs/agent/agent-tab.png` | `?` help panel with the `agent` tab selected |
| record | `docs/agent/record.png` | an armed take with three appended rows and an `expr` source visible |
| eight lanes | `docs/agent/eight-lanes.png` | `examples/eight-lanes.bitwave.json`, lane 8 focused (`O`/`P`/`Z8`) |

## Prerequisites

- The built instrument with the agent layer: `npm run build` (the committed
  `bitwave-v2.html` is the artifact these recipes load). `npm install` is needed once.
- Node ≥ 23.6 (the transports import `.ts` directly) and PowerShell 7 (`pwsh`).
- Chrome or Edge. If neither is on a default path, point `BITWAVE_CHROME` at the
  executable (the repo's own browser checks use the same variable).

Run every snippet **from the repository root**, in one PowerShell session (the helpers
below are used by later snippets).

```powershell
# The built instrument, as an absolute file:// URL (Chrome needs the full path).
$root = (Get-Location).Path
if (-not (Test-Path (Join-Path $root "bitwave-v2.html"))) { throw "run this from the repo root" }
$app = "file:///" + (($root -replace '\\', '/') -replace ' ', '%20') + "/bitwave-v2.html"

# Chrome/Edge executable: BITWAVE_CHROME wins, else the usual Windows installs.
$chrome = if ($env:BITWAVE_CHROME) { $env:BITWAVE_CHROME } else {
  @(
    "C:\Program Files\Google\Chrome\Application\chrome.exe",
    "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $chrome) { throw "no Chrome/Edge found — set `$env:BITWAVE_CHROME" }

# Scratch fixtures (git-ignored: .tmp-* is ignored; use TEMP for anything ad hoc).
$shots = Join-Path $env:TEMP "bitwave-shots"
New-Item -ItemType Directory -Force $shots | Out-Null

# A fresh profile per invocation. Reusing a profile silently reuses autosave and
# a normal Chrome session can swallow the capture.
function New-ShotProfile { Join-Path $env:TEMP ("bitwave-chrome-" + [guid]::NewGuid().ToString("N")) }

function Save-BitWaveShot {
  param([Parameter(Mandatory)][string]$Url, [Parameter(Mandatory)][string]$Out)
  $chromeArgs = @(
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--hide-scrollbars", "--force-device-scale-factor=1", "--window-size=1440,900",
    "--virtual-time-budget=5000", "--user-data-dir=$(New-ShotProfile)",
    "--screenshot=$Out", $Url
  )
  $dir = Split-Path $Out
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
  # Start-Process -Wait is required on Windows: `& $chrome` can return before the
  # PNG is flushed, so an immediately following check sees no file.
  Start-Process -FilePath $chrome -ArgumentList $chromeArgs -Wait -WindowStyle Hidden
}
```

## State 1 — default 64-bit view

No fragment: the boot instrument at its defaults (64-bit, lane 1, 2-D, Record idle).
`?fresh` makes the session ephemeral so a leftover autosave cannot leak into the shot.

```powershell
Save-BitWaveShot -Url ($app + "?fresh") -Out (Join-Path $root "docs\agent\default.png")
```

The boot state has no link restore, so the one-shot capture is already settled; the
link-restored states below use the CDP helper.

Expected (`#bitwave-state`): `width: 64`, `lane: 1`, `view.mode: "2d"`,
lane 1 `A = 8ADEFEDA85210125`, `B = FFFFFFFF00000000`, `Z1 = 7521012585210125`,
`binop: "xor"`, `lfo.on: false`, `recording: { on: false, rows: 0 }`, and every
`lanes[*].expressions` entry `null`. The header reads **64 bits · 16 nibbles**; the stage
bar's lane dropdown reads **Lane 1** (valued `"1"`; the active select carries
`[data-agent-lane="1"]`); the source group shows the Record toggle off with **0 rows**
(export disabled). `getState().lanes` has exactly the three boot keys.

## Scripted states — CDP driver (link-restored states, agent tab, Record)

The help panel and the Record toggle are interactive surfaces, so the one-shot
`--screenshot` flag cannot reach them — it captures the initial load only. A
**link-restored** state also needs a settled canvas: headless one-shot capture can fire
before the restore's first animation frames, leaving the wave blank. Drive the page over
the DevTools protocol instead. Save this as `$env:TEMP\capture-cdp.mjs` (zero
dependencies; Node ≥ 22 ships `fetch` and `WebSocket`):

```js
// capture-cdp.mjs — headless Chrome + CDP screenshot of one post-load state.
// usage: node capture-cdp.mjs <url> <out.png> [<js-to-run-after-ready>]
// env:   BITWAVE_CHROME = path to chrome.exe (default: standard Windows install)
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const chrome = process.env.BITWAVE_CHROME ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const [url, out, action] = process.argv.slice(2);
if (!url || !out) { console.error("usage: node capture-cdp.mjs <url> <out.png> [<js>]"); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = mkdtempSync(join(tmpdir(), "bitwave-cdp-"));
const portFile = join(profile, "DevToolsActivePort");
const child = spawn(chrome, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  "--hide-scrollbars", "--window-size=1440,900",
  `--user-data-dir=${profile}`, "--remote-debugging-port=0", "about:blank",
], { stdio: "ignore" });

let port = null;
for (let i = 0; i < 200 && !port; i++) {
  try { port = readFileSync(portFile, "utf8").split(/\r?\n/)[0]; } catch { await sleep(50); }
}
if (!port) throw new Error("DevToolsActivePort never appeared");
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

let nextId = 0;
const pending = new Map();
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  const waiter = pending.get(msg.id);
  if (!waiter) return;
  pending.delete(msg.id);
  if (msg.error) waiter.reject(new Error(JSON.stringify(msg.error)));
  else waiter.resolve(msg.result);
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? "page exception");
  return result.result.value;
};

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url });
let ready = false;
for (let i = 0; i < 100 && !ready; i++) {
  ready = await evaluate("Boolean(document.body && document.body.dataset.agentReady === 'true')");
  if (!ready) await sleep(100);
}
if (!ready) throw new Error("page never became agent-ready — rebuild: npm run build");
await evaluate("document.fonts.ready.then(() => true)");
if (action) { await evaluate(action); await sleep(300); }

const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(out, Buffer.from(shot.data, "base64"));
console.log(`wrote ${out}`);
ws.close();
child.kill();
```

Save it and define the path once (the states below reuse it):

```powershell
$cdp = Join-Path $env:TEMP "capture-cdp.mjs"
```

## State 2 — A·B pair (`8ADEFEDA85210125 XOR FFFFFFFF00000000`)

The pair is a `.bitwave` document (schema 3 here; a current build saves schema 4); `build_deeplink` canonicalises it (drops
`savedAt`, keeps expression sources) and appends the fragment to the app URL. All three
lanes need the schema-1 fields, so the fixture includes them even though only lane 1 is
on screen.

```powershell
$abXor = @'
{
  "schema": 3,
  "app": "bitwave",
  "N": 64,
  "view": { "lane": "1", "view3d": false, "split3d": false, "splitPair": ["1", "2"], "activePane": 0 },
  "lanes": {
    "1": { "a": "8ADEFEDA85210125", "b": "FFFFFFFF00000000", "showB": true, "binop": "xor", "colA": -1, "colB": -1, "focus": "z" },
    "2": { "a": "FEDA852101257ADE", "b": "02468ACEECA86420", "showB": true, "binop": "xor", "colA": -1, "colB": -1 },
    "3": { "a": "0123456789ABCDEF", "b": "8ADEFEDA85210125", "showB": false, "binop": "and", "colA": -1, "colB": -1 }
  },
  "routes": [],
  "parked": {}
}
'@
$project = Join-Path $shots "ab-xor.bitwave.json"
Set-Content -LiteralPath $project -Value $abXor -Encoding utf8

$linked = node agent/cli.mjs deeplink --project $project --base $app --json | ConvertFrom-Json
if (-not $linked.ok) { throw "deeplink failed: $($linked.error.code) $($linked.error.message)" }
$abUrl = $linked.data.url   # absolute file:// URL with the #bw= fragment
$linked.data | Select-Object fragment, payloadChars, withinBudget, datasetDropped

node $cdp $abUrl (Join-Path $root "docs\agent\ab-xor.png") "true"
```

> The CDP helper (defined above) waits for the link-restored canvas to settle. The one-shot
> `Save-BitWaveShot -Url $abUrl …` form captures the same page but can fire before the
> restore's first animation frames and leave the wave blank.

Expected: lane 1 shows `A = 8ADEFEDA85210125`, `B = FFFFFFFF00000000` (both frames
visible), `Z1 = 7521012585210125`; `derived.Z1` is
`{ "hex": "7521012585210125", "popcount": 20, "truthCounts": [23, 11, 9, 21] }`.

## State 3 — width change (16-bit)

The same recipe with `N: 16` and 4-nibble operands; the register width is shared by all
three lanes, so every lane carries a 16-bit value.

```powershell
$width16 = @'
{
  "schema": 3,
  "app": "bitwave",
  "N": 16,
  "view": { "lane": "1", "view3d": false, "split3d": false, "splitPair": ["1", "2"], "activePane": 0 },
  "lanes": {
    "1": { "a": "8ADE", "b": "FFFF", "showB": true, "binop": "xor", "colA": -1, "colB": -1, "focus": "z" },
    "2": { "a": "0F0F", "b": "1234", "showB": true, "binop": "and", "colA": -1, "colB": -1 },
    "3": { "a": "BEEF", "b": "0FFF", "showB": true, "binop": "or", "colA": -1, "colB": -1 }
  },
  "routes": [],
  "parked": {}
}
'@
$project = Join-Path $shots "width-16.bitwave.json"
Set-Content -LiteralPath $project -Value $width16 -Encoding utf8

$linked = node agent/cli.mjs deeplink --project $project --base $app --json | ConvertFrom-Json
if (-not $linked.ok) { throw "deeplink failed: $($linked.error.code) $($linked.error.message)" }
$widthUrl = $linked.data.url

node $cdp $widthUrl (Join-Path $root "docs\agent\width-16.png") "true"
```

Expected: header **16 bits · 4 nibbles**; lane 1 `Z1 = 7521` with
`popcount: 7`, `truthCounts: [0, 7, 0, 9]`; lanes 2/3 read `0F0F AND 1234 = 0204` and
`BEEF OR 0FFF = BFFF`. Confirm all of it in the state JSON, not by eye.

## State 4 — help panel, `agent` tab

Open the panel and select the agent tab through their real handlers:

```powershell
node $cdp $app (Join-Path $root "docs\agent\agent-tab.png") `
  "document.getElementById('helpBtn').click(); document.querySelector('[data-agent-tab=agent]').click(); true"
```

Expected: the help panel is open, the `agent` tab is selected, and the panel carries
`[data-agent-status="bridge-active"]` plus the bridge/deeplink/copy controls, the live
state JSON and the tool catalogue. Reaching the tab proves the `keys|agent` tablist works
with the same click path a user takes.

## State 5 — Record take (`docs/agent/record.png`)

The take is **session state** (in memory only, never in `.bitwave` or a share link), so it
is captured by driving the bridge after a deterministic boot: a fresh `?fresh` session,
one expression source, then arm Record and make three settled register writes. Opening
the source table at the end also exercises the new `expr` row.

```powershell
$recordAction = @'
window.bitwave.setExpression("D", "C + 1");
window.bitwave.record(true);
window.bitwave.setRegister("A", "1111111122222222");
window.bitwave.setRegister("A", "3333333344444444");
window.bitwave.setRegister("A", "5555555566666666");
document.getElementById("sourcesBtn").click();
true
'@
node $cdp ($app + "?fresh") (Join-Path $root "docs\agent\record.png") $recordAction
```

Expected (`#bitwave-state`): `width: 64`, `recording: { on: true, rows: 3 }`, lane 2
`expressions.D = "C + 1"` (D/Z2 follow the expression), and `window.bitwave.getLog()`
returns three rows whose `step` values are `[1, 2, 3]` and whose `frames` each hold the
nine global names (`A B Z1 C D Z2 E F Z3`). The Record toggle reads **on** with **3 rows**
and `export log` is enabled; the open source table shows lane 2 `D` reading an
`expr · expression` source. A deeplink built from this state carries the expression
(schema 4 in current builds) but **not** the take, by design.

## State 6 — eight-lane document (`docs/agent/eight-lanes.png`)

The dynamic-lanes fixture is a committed schema-4 document with **eight live lanes** and
lane 8 focused (`view.lane: "8"`), so the shot proves the live 1–8 instrument beyond the
three-lane boot. The compact canonical link is built by the CLI exactly as an agent would:

```powershell
$linked = node agent/cli.mjs deeplink --project examples/eight-lanes.bitwave.json --base $app --json | ConvertFrom-Json
if (-not $linked.ok) { throw "deeplink failed: $($linked.error.code) $($linked.error.message)" }
$linked.data | Select-Object fragment, payloadChars, withinBudget, datasetDropped, expressionsDropped
$eightUrl = $linked.data.url

node $cdp $eightUrl (Join-Path $root "docs\agent\eight-lanes.png") "true"
```

Expected: `width: 64`, `lane: 8`, `frame: "O"`, `view.mode: "2d"`,
`view.splitPair: [7, 8]`; `getState().lanes` has exactly the keys
`"1" … "8"` in ascending order, each with its own global frame names — lane 1
`A/B/Z1` (and the DESIGN §11 vector `Z1 = 7521012585210125`), lane 4 `G/H/Z4`, lane 8
`O/P/Z8` with `O = DEADBEEFCAFEBABE`, `P = 0123456789ABCDEF`. `bridge.version` is
`"1.4.0"`. The stage-bar lane dropdown reads **Lane 8** and offers all eight options; the
compact payload is **568 characters** (well within the 2000 budget, no drops). Opening the
frames view on the same link renders **24 cards** (`A`–`P` plus `Z1`–`Z8`) across eight
lane columns.

## Extract the state JSON (`#bitwave-state`) — no driver needed

One-shot headless Chrome writes the mounted DOM to stdout; `#bitwave-state` always exists
once the page has mounted. This is the cheapest independent state read (no CDP, no script).

```powershell
$dom = (& $chrome --headless=new --disable-gpu --no-first-run --no-default-browser-check `
  --user-data-dir="$(New-ShotProfile)" --virtual-time-budget=5000 --dump-dom $abUrl 2>$null | Out-String)
$match = [regex]::Match($dom, '(?s)<pre id="bitwave-state"[^>]*>(.*?)</pre>')
if (-not $match.Success) { throw "no #bitwave-state — stale artifact? run: npm run build" }
$state = [System.Net.WebUtility]::HtmlDecode($match.Groups[1].Value) | ConvertFrom-Json
$state | ConvertTo-Json -Depth 12          # full UI state (schema 1)
$state | Select-Object schemaVersion, ready, width, lane, frame
$state.lanes.'1'.derived.Z1                # { hex, popcount, truthCounts }
$state.recording                           # { on, rows } — transient take
$state.lanes.'2'.expressions               # { C, D } — null unless an expr source is bound
```

> On Windows, capture Chrome's stdout through a pipe (`| Out-String` above) or let
> `Start-Process` redirect it to a file. Assigning `$dom = & $chrome … --dump-dom …`
> directly can come back empty because Chrome is a GUI-subsystem executable; piping keeps
> the handle open until the DOM is flushed.

Assertions that make a shot trustworthy (all from the state, not the pixels):

```powershell
$state.schemaVersion -eq 1
$state.ready -eq $true
$state.deeplink -like "*#bw=*"             # the page mirrors the canonical link
# A·B pair only:
$state.lanes.'1'.frames.A -eq "8ADEFEDA85210125"
$state.lanes.'1'.frames.B -eq "FFFFFFFF00000000"
$state.lanes.'1'.derived.Z1.hex -eq "7521012585210125"
# Record only:
$state.recording.on -eq $true
$state.recording.rows -eq 3
```

On non-Windows systems the same flags work with `bash`/`zsh`; replace `$env:TEMP` and the
Chrome path.

## Expected files

| file | state | produced by | sanity check |
|---|---|---|---|
| `docs/agent/default.png` | default 64-bit, lane 1, Record idle | State 1 | 1440×900, header "64 bits · 16 nibbles", "0 rows" |
| `docs/agent/ab-xor.png` | A·B pair, `Z1` focused | State 2 | state `Z1 = 7521012585210125`, truth counts `23 11 9 21` |
| `docs/agent/width-16.png` | 16-bit resize | State 3 | state `width = 16`, `Z1 = 7521` |
| `docs/agent/agent-tab.png` | help panel, agent tab | State 4 | `[data-agent-status="bridge-active"]` |
| `docs/agent/record.png` | armed take, three rows, `expr` source | State 5 | state `recording = {on:true, rows:3}`, `expressions.D = "C + 1"` |
| `docs/agent/eight-lanes.png` | eight-lane document, lane 8 focused | State 6 | state `lane = 8`, `lanes` keys `"1"…"8"`, lane 8 `O/P/Z8`, compact link 568 chars |

Each file should be well over 50 KB (a blank/near-empty capture is a failed run) and
exactly 1440×900 at device scale factor 1. Inspect the PNGs with an image viewer (or the
agent's image reader) — the state JSON above is the semantic check; the image is the
visual check.

## `file://` caveats

- **Absolute path only.** `file:///C:/…/bitwave-v2.html`; a relative `file:` URL is not a
  valid URL for Chrome, and spaces must be `%20` (the helper above does it).
- **The fragment is local to that file path.** A copied `#bw=` link reproduces the view
  only when it is opened against the same `bitwave-v2.html` path. For a portable link,
  build the fragment with an `http(s)` `--base` (see [`hosting.md`](hosting.md)) —
  `build_deeplink` only appends the fragment to the base you pass.
- **Links are schema 4 and carry expression sources.** A link restores the `expr` text, so
  the same computation resumes. It never carries the Record take: the log is a session
  artifact (in memory, cleared on reload).
- **`?fresh` does not read a shared link.** Boot priority is shared link → autosave →
  defaults, and `?fresh` short-circuits the whole restore path (in `src/main.js`), so it
  is for default-state captures and throwaway sessions only. For a `#bw=` capture use a
  fresh Chrome profile (empty `localStorage`) instead of `?fresh`.
- **Fresh profile per capture.** The autosave is `localStorage` for the origin; a reused
  profile can boot from autosave when no fragment is present.
- **No fragment budget surprises.** Canonical links are ≤ 2000 characters after `bw=`;
  a project whose dataset overflows drops the dataset (`datasetDropped: true`) instead of
  producing an unusable link.

## Troubleshooting

| symptom | cause / fix |
|---|---|
| PNG missing after the command | `& $chrome` returned before flush; use `Start-Process -Wait`, and check the console line `<n> bytes written to file …`. |
| Blank or black PNG | A running/headed Chrome swallowed the shot — always pass a unique `--user-data-dir` and wait for the process. |
| `no #bitwave-state` in `--dump-dom` | Stale artifact: the committed HTML predates the agent layer — `npm run build`, then retry. |
| `deeplink failed: E_INPUT_TOO_LARGE` | Project + dataset exceeds the share budget; remove the dataset (the tool would have dropped it, but an oversized non-dataset payload is refused). |
| `no Chrome/Edge found` | Install Chrome/Edge or set `$env:BITWAVE_CHROME` to the executable. |
| Agent tab never found by the CDP script | Stale artifact or a pre-agent build; the tab markup and `data-agent-tab` attributes ship with the agent layer. |
| Record shot shows "0 rows" or the toggle off | The action ran before the bridge was ready or the artifact predates the slice — rebuild and retry; the take is transient, so a deeplink cannot produce it. |
| State JSON disagrees with the picture | Trust the JSON — the URL/state is the contract, the HTML mirrors it. Rebuild and file the drift. |
