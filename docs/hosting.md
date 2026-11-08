# Sharing BitWave

BitWave ships in two forms. They are the same instrument; pick the one that fits
how you work.

| Form | File | Works from | Persistence |
|---|---|---|---|
| **Single file** | `bitwave-v2.html` (repo root) | double-click / `file://` / USB stick | autosave + `#bw=` share link (per origin) |
| **Hosted PWA** | `dist/hosted/` | any static host over **HTTPS** | same, plus installable and fully offline |

The single file is the canonical artifact: zero external references, no server,
no network. The hosted build is the same app **plus** a manifest, service worker,
icons and registration. The PWA shell is added only to `dist/hosted/index.html`;
the committed `bitwave-v2.html` never gains those references (asserted by
`npm run check:pwa`).

## Build and verify

```bash
npm run build:pwa     # vite build → bitwave-v2.html → dist/hosted/
npm run check:pwa     # serves dist/hosted on 127.0.0.1, drives headless Chromium
```

`check:pwa` proves: the manifest and all icons load; the worker registers,
activates and controls the page; the app shell is in a hash-versioned cache; the
hosted build serves `/agent/manifest.json`, an example envelope and `/llms.txt`;
and a reload **with the origin server stopped** still boots the instrument from
the cache with no console errors. It also asserts the single-file artifact
stayed clean.

### Agent files in the hosted build

`npm run build:pwa` also copies `agent/` (manifest + examples + transport docs),
`AGENTS.md`, `llms.txt`, `docs/AGENT-INTERFACE.md` and `docs/AGENT-SCREENSHOTS.md`
into `dist/hosted/`, so a served instance is readable by an agent without a repo
checkout. These are static read-only files: the single-file artifact gains no
references to them, and the service worker does not cache them (agent clients use
the live origin). See [`AGENTS.md`](../AGENTS.md).

`npm run verify` runs the whole gate: unit + typecheck + build + browser +
hosted build + PWA check.

## Deploy

`dist/hosted/` is plain static files. Copy its **contents** so `index.html` is at
the server root (or a subpath — every URL in the PWA shell is relative, so
`https://example.org/bitwave/` works too):

- **GitHub Pages** — publish the contents to the branch/folder Pages serves
  (`main:/` or a `gh-pages` branch), enable Pages, wait for the HTTPS URL.
- **Netlify / Cloudflare Pages / Vercel** — drag the `dist/hosted` folder (or set
  it as the publish directory); no build command needed.
- **Any static host** — Apache/nginx/S3 + CDN. Must be served over **HTTPS** for
  the service worker to be allowed (or `localhost` while testing).

Suggested cache headers: `index.html`, `sw.js` and `manifest.webmanifest`
`no-cache` (or short max-age) so updates are picked up; the icons may be cached
long-term under their stable names.

## Install and use offline

Visit the hosted URL in Chrome/Edge and use the install icon in the address bar
(or menu → *Install BitWave*). On iOS Safari, *Share → Add to Home Screen*. Once
installed it launches standalone — no browser chrome — and works with the network
off: the worker cached the app shell on first visit.

Updates are versioned by the built artifact hash (`bitwave-<hash10>`). A new
deploy installs the new cache on the next visit, activates it, and deletes the
old one; a normal reload picks it up.

## Privacy and network behaviour

- No telemetry, analytics, fonts, CDNs or third-party requests. The worker only
  handles same-origin `GET`s and refuses everything else.
- State never leaves the machine unless the user acts: `save project` downloads a
  `.bitwave` file, and the address bar carries the state as a `#bw=` fragment
  (fragments are not sent to servers).
- Autosave is `localStorage` for the deployed origin. Moving BitWave to another
  host starts a fresh autosave; a `#bw=` link still carries the state across.

## The two forms side by side

- Send researchers the **hosted URL** for the installed/offline experience.
- Send the **`bitwave-v2.html`** file when the tool must travel by email/USB and
  open with a double-click, no server and no install.
- The hosted folder also contains an untouched `bitwave-v2.html` copy, so
  `https://…/bitwave-v2.html` is a direct download of the single file.
