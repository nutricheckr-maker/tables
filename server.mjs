// tables — one process, three listeners, one gate:
//
//   127.0.0.1:5170  the tables app (Next.js), including /gate and /api/gate/*
//   127.0.0.1:8898  gate proxy: the browsers' PAC files send ChatGPT, Gemini and
//                   Stream's video hosts here. It tunnels (never decrypts) only
//                   while the gate is open, and cuts open tunnels when it closes.
//   127.0.0.1:5180  Stream's public address: reverse-proxies to Stream's private
//                   unix socket while open, redirects to /gate while locked.
//
// The gate state (src/lib/gate/state.ts) lives in this process's memory only.
// Route handlers create it on a global symbol; this file reads the same object.
// If it is missing for any reason, every check here answers "locked".

import { spawn } from "node:child_process";
import { createServer, request as httpRequest } from "node:http";
import net from "node:net";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import next from "next";

const HOST = "127.0.0.1";
const APP_PORT = Number(process.env.TABLES_PORT || 5170);
const PROXY_PORT = Number(process.env.GATE_PROXY_PORT || 8898);
const STREAM_PORT = Number(process.env.STREAM_GATE_PORT || 5180);
const STREAM_SOCKET = process.env.STREAM_SOCKET || `${process.env.XDG_RUNTIME_DIR || "/tmp"}/stream.sock`;
const GATE_URL = `http://${HOST}:${APP_PORT}/gate`;

/** Host suffix → protected app. Must match DW_GATED in the PAC files. */
const GATED = [
  ["chatgpt.com", "chatgpt"],
  ["gemini.google.com", "gemini"],
  ["youtube-nocookie.com", "stream"],
  ["googlevideo.com", "stream"],
];
const LABEL = { chatgpt: "ChatGPT", gemini: "Gemini", stream: "Stream" };

function appFor(host) {
  const h = String(host).toLowerCase().replace(/\.$/, "");
  for (const [suffix, app] of GATED) if (h === suffix || h.endsWith(`.${suffix}`)) return app;
  return null;
}

const GATE_KEY = Symbol.for("tables.gate");
function isOpen() {
  const gate = globalThis[GATE_KEY];
  try {
    return Boolean(gate && gate.isGranted());
  } catch {
    return false;
  }
}

const log = (...a) => console.log(new Date().toISOString(), ...a);

// ── when something is blocked, take the user to the challenge ──
//
// An HTTPS site cannot be redirected by a proxy: the browser only shows its own
// "proxy server is refusing connections" page. So the gate opens the challenge
// itself, in a new tab of the same browser that was refused, at most once per
// app and browser per AUTO_OPEN_EVERY_MS, and not while a challenge page is open.
const AUTO_OPEN = process.env.GATE_AUTO_OPEN !== "0";
const AUTO_OPEN_EVERY_MS = 3 * 60_000;
const lastOpened = new Map();
let lastGateVisit = 0;
// The gate extension (deploy/extension) checks in every 15 s and redirects the
// tab itself; a browser that has it needs no extra tab.
const EXTENSION_FRESH_MS = 45_000;
const extensionSeen = new Map();
const run = (cmd, args) => {
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
  } catch {
    // Opening the page is a convenience; the block itself does not depend on it.
  }
};

/** Which browser owns the connection from this local port: "firefox", "zen" or null. */
function browserFor(port) {
  return new Promise((resolve) => {
    if (!port) return resolve(null);
    let out = "";
    const ss = spawn("ss", ["-Htnp", `( sport = :${port} )`], { stdio: ["ignore", "pipe", "ignore"] });
    ss.stdout.on("data", (d) => (out += d));
    ss.on("error", () => resolve(null));
    ss.on("close", async () => {
      const pid = /pid=(\d+)/.exec(out)?.[1];
      if (!pid) return resolve(null);
      try {
        const { readFile } = await import("node:fs/promises");
        const cmd = (await readFile(`/proc/${pid}/cmdline`, "utf8")).split("\0")[0];
        resolve(cmd.startsWith("/app/zen/") ? "zen" : /firefox/.test(cmd) ? "firefox" : null);
      } catch {
        resolve(null);
      }
    });
  });
}

/**
 * Call before refusing: the owner lookup needs the connection still open.
 * Cooldown is per app *and* browser, so being refused in Zen right after
 * Firefox still opens the challenge in Zen.
 */
const lastLookup = new Map();
async function onBlocked(app, clientPort) {
  const now = Date.now();
  if (!AUTO_OPEN || now - lastGateVisit < 60_000) return;
  // Retry storms (an open tab reconnecting) need one lookup, not dozens.
  if (now - (lastLookup.get(app) ?? 0) < 2_000) return;
  lastLookup.set(app, now);
  const browser = await browserFor(clientPort);
  if (browser && now - (extensionSeen.get(browser) ?? 0) < EXTENSION_FRESH_MS) return;
  const key = `${app}:${browser ?? "default"}`;
  if (now - (lastOpened.get(key) ?? 0) < AUTO_OPEN_EVERY_MS) return;
  lastOpened.set(key, now);
  const url = `${GATE_URL}?app=${app}`;
  if (browser === "firefox") run("firefox", ["--new-tab", url]);
  else if (browser === "zen") run("flatpak", ["run", "app.zen_browser.zen", "--new-tab", url]);
  else run("xdg-open", [url]);
  log(`opened challenge for ${app} in ${browser ?? "default browser"}`);
  run("notify-send", ["-a", "tables gate", `${LABEL[app]} is locked`, "Opened the challenge in a new tab — 10 questions, 40 s, 8 correct."]);
}

// ── live tunnels, cut the moment the gate closes ──
const tunnels = new Set();
function closeAllIfLocked() {
  if (tunnels.size === 0 || isOpen()) return;
  log(`gate closed: cutting ${tunnels.size} tunnel(s)`);
  for (const s of tunnels) s.destroy();
  tunnels.clear();
}
setInterval(closeAllIfLocked, 1000).unref();

function refuse(socket, app) {
  socket.end(
    "HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n" +
      `${app ? LABEL[app] : "This host"} is locked by the tables gate: ${GATE_URL}\r\n`,
  );
}

const proxy = createServer((req, res) => {
  // Plain-HTTP proxying (http://chatgpt.com/...): send the browser to the gate,
  // or forward if open. Browsers upgrade these to HTTPS straight away.
  let target;
  try {
    target = new URL(req.url);
  } catch {
    res.writeHead(400).end();
    return;
  }
  const app = appFor(target.hostname);
  if (!app) {
    res.writeHead(403).end("Not a gated host");
    return;
  }
  if (!isOpen()) {
    // Plain HTTP can be redirected straight to the challenge.
    res.writeHead(302, { Location: `${GATE_URL}?app=${app}`, "Cache-Control": "no-store" }).end();
    return;
  }
  const up = httpRequest(target, { method: req.method, headers: req.headers }, (ur) => {
    res.writeHead(ur.statusCode ?? 502, ur.headers);
    ur.pipe(res);
  });
  up.on("error", () => res.writeHead(502).end());
  req.pipe(up);
});

proxy.on("connect", (req, client, head) => {
  const m = /^\[?([^\]]+?)\]?:(\d+)$/.exec(req.url ?? "");
  const host = m?.[1];
  const port = Number(m?.[2]);
  const app = host ? appFor(host) : null;
  client.on("error", () => {});
  // Only gated hosts, only web ports: this is not a general-purpose proxy.
  if (!app || (port !== 443 && port !== 80)) {
    refuse(client, null);
    return;
  }
  if (!isOpen()) {
    log(`blocked ${host} (${app})`);
    void onBlocked(app, client.remotePort).finally(() => refuse(client, app));
    return;
  }
  const upstream = net.connect(port, host, () => {
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head?.length) upstream.write(head);
    upstream.pipe(client);
    client.pipe(upstream);
  });
  tunnels.add(client);
  const done = () => {
    tunnels.delete(client);
    upstream.destroy();
    client.destroy();
  };
  upstream.on("error", done);
  upstream.on("close", done);
  client.on("close", done);
});

// ── Stream's public port ──
const streamGate = createServer((req, res) => {
  if (!isOpen()) {
    const back = `http://${HOST}:${STREAM_PORT}${req.url ?? "/"}`;
    res
      .writeHead(302, {
        Location: `${GATE_URL}?app=stream&next=${encodeURIComponent(back)}`,
        "Cache-Control": "no-store",
      })
      .end();
    return;
  }
  const up = httpRequest(
    { socketPath: STREAM_SOCKET, path: req.url, method: req.method, headers: req.headers },
    (ur) => {
      // no-store: a locked gate must not be bypassed by the browser's HTTP cache.
      res.writeHead(ur.statusCode ?? 502, { ...ur.headers, "cache-control": "no-store" });
      ur.pipe(res);
    },
  );
  up.on("error", () => {
    if (!res.headersSent) res.writeHead(502, { "Content-Type": "text/plain" });
    res.end("Stream is not running (systemctl --user status stream)");
  });
  req.pipe(up);
});

// ── the tables app itself ──
const dir = dirname(fileURLToPath(import.meta.url));
const app = next({ dev: false, dir, hostname: HOST, port: APP_PORT });
await app.prepare();
const handle = app.getRequestHandler();
const web = createServer((req, res) => {
  // A challenge page in use: don't open another one on top of it.
  // Only browsers send Sec-Fetch-Site; the startup warm-up below must not count.
  if (req.headers["x-tables-gate"] === "extension") {
    const b = /[?&]browser=(firefox|zen)\b/.exec(req.url ?? "")?.[1];
    if (b) extensionSeen.set(b, Date.now());
  } else if (req.url?.startsWith("/api/gate/") && req.headers["sec-fetch-site"]) lastGateVisit = Date.now();
  handle(req, res);
});

function listen(server, port, name) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, HOST, () => {
      log(`${name} on http://${HOST}:${port}`);
      resolve();
    });
  });
}

await listen(web, APP_PORT, "tables");
// Create the gate state now, so the proxies never see "missing" in normal running.
await fetch(`http://${HOST}:${APP_PORT}/api/gate/status`).catch(() => {});
if (!globalThis[GATE_KEY]) log("WARNING: gate state is not shared with this process; everything stays locked");
else
  globalThis[GATE_KEY].subscribe(() => {
    closeAllIfLocked();
    // After a pass, the next lock should open the challenge again straight away.
    if (isOpen()) lastOpened.clear();
  });

await listen(proxy, PROXY_PORT, "gate proxy");
await listen(streamGate, STREAM_PORT, "stream gate");

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    for (const s of tunnels) s.destroy();
    process.exit(0);
  });
}
