import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { APPS } from "@/lib/gate/policy";

const coreSource = readFileSync(new URL("../deploy/extension/gate-core.js", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("../deploy/extension/manifest.json", import.meta.url), "utf8"));
const serverSource = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
const core = new Function(`${coreSource}; return { HOSTS, appForUrl, gateUrlFor, expiredQuestion };`)() as {
  HOSTS: [string, string][];
  appForUrl: (url: string) => string | null;
  gateUrlFor: (app: string, back?: string) => string;
  expiredQuestion: (app: string) => string;
};

describe("gate extension", () => {
  it("recognises ChatGPT and Gemini pages, and nothing else", () => {
    expect(core.appForUrl("https://chatgpt.com/c/abc")).toBe("chatgpt");
    expect(core.appForUrl("https://CHATGPT.COM./")).toBe("chatgpt");
    expect(core.appForUrl("https://ab.chatgpt.com/")).toBe("chatgpt");
    expect(core.appForUrl("https://gemini.google.com/app")).toBe("gemini");
    for (const u of ["https://google.com/", "https://notchatgpt.com/", "https://chatgpt.com.evil.io/", "http://127.0.0.1:5170/gate", "about:blank", "nonsense"]) {
      expect(core.appForUrl(u)).toBeNull();
    }
  });

  it("sends the tab to the challenge with a way back the gate page accepts", () => {
    const url = new URL(core.gateUrlFor("chatgpt", "https://chatgpt.com/c/a?b=1#c"));
    expect(url.origin + url.pathname).toBe("http://127.0.0.1:5170/gate");
    expect(url.searchParams.get("app")).toBe("chatgpt");
    const back = new URL(url.searchParams.get("next")!);
    expect(back.toString()).toBe("https://chatgpt.com/c/a?b=1#c");
    expect(back.origin).toBe(new URL(APPS.chatgpt.url).origin);
  });

  it("asks about the right app", () => {
    expect(core.expiredQuestion("gemini")).toContain("Gemini");
    expect(core.expiredQuestion("gemini")).toContain("30 minutes");
  });

  it("covers the server's ChatGPT and Gemini hosts, with permissions for each", () => {
    const serverHosts = [...serverSource.matchAll(/\["([a-z0-9.-]+)", "(?:chatgpt|gemini)"\]/g)].map((m) => m[1]).sort();
    expect(core.HOSTS.map(([h]) => h).sort()).toEqual(serverHosts);
    for (const [h] of core.HOSTS) expect(manifest.permissions).toContain(`*://${h}/*`);
    expect(manifest.permissions).toContain("http://127.0.0.1:5170/*");
  });
});
