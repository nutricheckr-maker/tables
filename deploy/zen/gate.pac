// tables gate — proxy auto-config for Zen.
//
// Installed root-owned beside Zen's policy, at /app/etc/zen/gate.pac inside the
// flatpak, so nothing in the home directory can change it. Zen's study-window
// filtering is the DeepWork Warden's job; this file only gates the protected
// apps. Keep GATED in sync with DW_GATED in study.pac and GATED in server.mjs.
//
// When the gate service is down, these hosts fail closed (the policy locks
// network.proxy.failover_direct = false); every other host is DIRECT.

var GATE = "PROXY 127.0.0.1:8898";
var GATED = [
    "chatgpt.com",
    "gemini.google.com",
    "youtube-nocookie.com",
    "googlevideo.com"
];

function FindProxyForURL(url, host) {
    host = host.toLowerCase();
    for (var i = 0; i < GATED.length; i++) {
        var a = GATED[i];
        if (host === a) return GATE;
        if (host.length > a.length &&
            host.substring(host.length - a.length - 1) === "." + a) return GATE;
    }
    return "DIRECT";
}
