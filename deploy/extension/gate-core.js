// tables gate extension: the parts that don't touch the browser (tested in
// tests/gate-extension.test.ts). Keep HOSTS in sync with GATED in server.mjs
// and the PAC files; Stream is left out because it redirects to the gate itself.

var TABLES = "http://127.0.0.1:5170";

/** Host suffix → protected app, as in server.mjs. */
var HOSTS = [
  ["chatgpt.com", "chatgpt"],
  ["gemini.google.com", "gemini"]
];

var LABELS = { chatgpt: "ChatGPT", gemini: "Gemini" };

/** The protected app a URL belongs to, or null. Only http(s) pages count. */
function appForUrl(url) {
  var u;
  try {
    u = new URL(url);
  } catch (e) {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  var h = u.hostname.toLowerCase().replace(/\.$/, "");
  for (var i = 0; i < HOSTS.length; i++) {
    var suffix = HOSTS[i][0];
    if (h === suffix || h.endsWith("." + suffix)) return HOSTS[i][1];
  }
  return null;
}

/** The challenge page for an app, returning to `back` after a pass (the gate page checks the origin). */
function gateUrlFor(app, back) {
  return TABLES + "/gate?app=" + app + (back ? "&next=" + encodeURIComponent(back) : "");
}

function expiredQuestion(app) {
  return (
    "Your " + LABELS[app] + " access from the tables gate has ended.\n\n" +
    "Go back to the Tables app to unlock it for another 30 minutes?"
  );
}
