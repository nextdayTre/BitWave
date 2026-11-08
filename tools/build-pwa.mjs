#!/usr/bin/env node
/**
 * BitWave hosted / PWA build.
 *
 * The committed `bitwave-v2.html` is the single-file distribution: one file,
 * zero external references, opens over `file://`. The hosted build is a second
 * deliverable for research groups: the same app plus a manifest, service worker,
 * icons and registration, served from static hosting over HTTPS so it can be
 * installed and used offline.
 *
 * Invariant: this script must NOT change the root artifact. It reads it, proves
 * it still has no manifest/SW references, injects the PWA shell into a *copy* at
 * `dist/hosted/index.html`, and re-checks the artifact bytes afterwards.
 *
 * Run: npm run build:pwa   (after `npm run build`; the npm script does both)
 * Out: dist/hosted/{index.html, manifest.webmanifest, sw.js, icons/*, bitwave-v2.html}
 */

import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const ARTIFACT = resolve(ROOT, "bitwave-v2.html");
const ICON_DIR = resolve(ROOT, "assets/pwa");
const OUT_DIR = resolve(ROOT, "dist/hosted");

const ICONS = [
  { src: "./icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
  { src: "./icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  { src: "./icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
];
const ICON_FILES = ["icon-192.png", "icon-512.png", "icon-maskable-512.png", "favicon-32.png"];

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function assert(condition, message) {
  if (!condition) {
    console.error(`✘ ${message}`);
    process.exit(1);
  }
}

function injectHead(html) {
  const tag =
    `  <link rel="manifest" href="./manifest.webmanifest" />\n` +
    `  <meta name="theme-color" content="#08090c" />\n` +
    `  <link rel="icon" type="image/png" sizes="32x32" href="./icons/favicon-32.png" />\n` +
    `  <link rel="apple-touch-icon" href="./icons/icon-192.png" />\n`;
  return html.includes("</head>") ? html.replace("</head>", `${tag}</head>`) : html;
}

function injectRegistration(html) {
  const script =
    `<script>\n` +
    `  /* Hosted build only: install the app shell for offline use. */\n` +
    `  if ("serviceWorker" in navigator) {\n` +
    `    window.addEventListener("load", function () {\n` +
    `      navigator.serviceWorker.register("./sw.js").catch(function () {});\n` +
    `    });\n` +
    `  }\n` +
    `</script>\n`;
  return html.includes("</body>") ? html.replace("</body>", `${script}</body>`) : html;
}

function manifest() {
  return {
    id: "./",
    name: "BitWave — a register you can see",
    short_name: "BitWave",
    description:
      "A bit register rendered as a wavetable: drag nibbles, apply bitwise and arithmetic ops, step data. Offline, zero dependencies.",
    start_url: "./",
    scope: "./",
    display: "standalone",
    orientation: "any",
    background_color: "#08090c",
    theme_color: "#08090c",
    lang: "en",
    dir: "ltr",
    categories: ["education", "music", "utilities"],
    icons: ICONS,
  };
}

function serviceWorker(version) {
  return `/* BitWave service worker — hosted build only (generated).
   Cache-first app shell; same-origin GETs only, no telemetry, no third parties.
   The cache name comes from the built artifact hash, so a new build installs
   alongside the old one and stale caches are deleted on activate. */
const CACHE = "bitwave-${version}";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/favicon-32.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match("./index.html"));
    })
  );
});
`;
}

function externalRefs(html) {
  const refs = new Set();
  for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const value = match[1];
    if (value.startsWith("#") || value.startsWith("data:") || value.startsWith("blob:")) continue;
    refs.add(value);
  }
  return [...refs];
}

function main() {
  assert(existsSync(ARTIFACT), "bitwave-v2.html is missing — run `npm run build` first");
  assert(existsSync(ICON_DIR), "assets/pwa is missing — run `python tools/make-pwa-icons.py`");
  for (const name of ICON_FILES) {
    assert(existsSync(join(ICON_DIR, name)), `missing icon: assets/pwa/${name}`);
  }

  const artifact = readFileSync(ARTIFACT);
  const before = sha256(artifact);
  const html = artifact.toString("utf8");

  assert(!/rel="manifest"/.test(html), "the single-file artifact must stay free of a manifest link");
  assert(!/serviceWorker/.test(html), "the single-file artifact must stay free of service-worker registration");

  const version = before.slice(0, 10);
  const hostedIndex = injectRegistration(injectHead(html));
  const refs = externalRefs(hostedIndex);
  const allowed = new Set([
    "./manifest.webmanifest",
    "./icons/favicon-32.png",
    "./icons/icon-192.png",
    "./icons/icon-512.png",
    "./icons/icon-maskable-512.png",
  ]);
  const unexpected = refs.filter((ref) => !allowed.has(ref));
  assert(unexpected.length === 0, `hosted build has unexpected external references: ${unexpected.join(", ")}`);
  assert(/id="wave"/.test(hostedIndex), "hosted build does not contain the instrument");

  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(join(OUT_DIR, "icons"), { recursive: true });

  writeFileSync(join(OUT_DIR, "index.html"), hostedIndex, "utf8");
  writeFileSync(join(OUT_DIR, "manifest.webmanifest"), `${JSON.stringify(manifest(), null, 2)}\n`, "utf8");
  writeFileSync(join(OUT_DIR, "sw.js"), serviceWorker(version), "utf8");
  for (const name of ICON_FILES) copyFileSync(join(ICON_DIR, name), join(OUT_DIR, "icons", name));
  /* The clean single file travels with the hosted build so a visitor can also
     download the double-clickable instrument. */
  copyFileSync(ARTIFACT, join(OUT_DIR, "bitwave-v2.html"));

  /* Agent layer: serve the generated manifest/examples and the onboarding docs
     beside the app, so a hosted instance is agent-readable without a repo
     checkout. The single-file artifact gains no references to any of this. */
  const agentDir = resolve(ROOT, "agent");
  if (existsSync(agentDir)) cpSync(agentDir, join(OUT_DIR, "agent"), { recursive: true });
  for (const [source, destination] of [
    [resolve(ROOT, "llms.txt"), "llms.txt"],
    [resolve(ROOT, "AGENTS.md"), "AGENTS.md"],
    [resolve(ROOT, "docs/AGENT-INTERFACE.md"), "docs/AGENT-INTERFACE.md"],
    [resolve(ROOT, "docs/AGENT-SCREENSHOTS.md"), "docs/AGENT-SCREENSHOTS.md"],
  ]) {
    if (!existsSync(source)) continue;
    const target = join(OUT_DIR, destination);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(source, target);
  }

  assert(sha256(readFileSync(ARTIFACT)) === before, "the single-file artifact changed during the PWA build");

  const size = (name) =>
    statSync(join(OUT_DIR, name)).size.toLocaleString("en-US");
  console.log(`✔ hosted build → dist/hosted`);
  console.log(`  cache version: bitwave-${version}`);
  console.log(`  index.html ${size("index.html")} B · sw.js ${size("sw.js")} B · manifest ${size("manifest.webmanifest")} B`);
  console.log(`  icons: ${ICON_FILES.map((name) => `${name} ${size(`icons/${name}`)} B`).join(" · ")}`);
  console.log(`  agent: ${existsSync(join(OUT_DIR, "agent", "manifest.json")) ? "manifest + examples + docs served" : "not present"}`);
  console.log(`  single-file artifact unchanged (sha256 ${before.slice(0, 16)}…)`);
}

main();
