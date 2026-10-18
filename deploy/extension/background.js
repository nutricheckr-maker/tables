// tables gate extension — makes the gate visible in the tab you were using.
//
// 1. While the gate is locked, opening ChatGPT or Gemini sends the tab to the
//    challenge (like Stream does), with the page to return to after a pass.
// 2. When access ends, each open ChatGPT/Gemini tab asks whether to go back to
//    the challenge; yes takes that tab there.
//
// The server stays the only authority: the gate proxy still refuses these
// hosts while locked, whether or not this extension is installed.

/* global TABLES, appForUrl, gateUrlFor, expiredQuestion */

var granted = false;
var expiryTimer = null;
var asking = new Set();
var browserName = "firefox";

browser.runtime.getBrowserInfo().then(
  function (info) {
    browserName = /zen/i.test(info.name) ? "zen" : "firefox";
  },
  function () {}
);

/** Current gate status, or null if the tables service is unreachable. */
async function fetchStatus() {
  try {
    var r = await fetch(TABLES + "/api/gate/status?browser=" + browserName, {
      cache: "no-store",
      headers: { "X-Tables-Gate": "extension" },
    });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    return null;
  }
}

async function refresh() {
  var s = await fetchStatus();
  var now = Boolean(s && s.granted);
  var was = granted;
  granted = now;
  clearTimeout(expiryTimer);
  // Check again just after the grant runs out, so the question comes on time.
  if (now) expiryTimer = setTimeout(refresh, Math.max(1000, s.remainingMs + 500));
  if (was && !now) void askOpenTabs();
  return now;
}

// ── 1. locked: send the tab to the challenge ──
browser.webRequest.onBeforeRequest.addListener(
  async function (details) {
    var app = appForUrl(details.url);
    if (!app) return {};
    // Ask the server every time: a cached "granted" could outlive the grant.
    if (await refresh()) return {};
    return { redirectUrl: gateUrlFor(app, details.url) };
  },
  {
    urls: ["*://chatgpt.com/*", "*://*.chatgpt.com/*", "*://gemini.google.com/*"],
    types: ["main_frame"],
  },
  ["blocking"]
);

// ── 2. access ended: offer to go back ──
async function askOpenTabs() {
  var tabs = await browser.tabs.query({});
  for (var tab of tabs) {
    var app = appForUrl(tab.url || "");
    if (app && !asking.has(tab.id)) void ask(tab, app);
  }
}

async function ask(tab, app) {
  asking.add(tab.id);
  try {
    // A tab-modal prompt in the page itself; background tabs show it when you switch to them.
    var out = await browser.tabs.executeScript(tab.id, {
      code: "window.confirm(" + JSON.stringify(expiredQuestion(app)) + ")",
    });
    if (!out || !out[0]) return;
    // Unlocked in the meantime (another tab, another browser): just reload.
    if (await refresh()) await browser.tabs.reload(tab.id);
    else await browser.tabs.update(tab.id, { url: gateUrlFor(app, tab.url) });
  } catch (e) {
    // The tab closed or shows an error page: it will be redirected when reopened.
  } finally {
    asking.delete(tab.id);
  }
}

// Sleep, a manual lock or a restart also end access; poll to notice them.
setInterval(refresh, 15000);
void refresh();
