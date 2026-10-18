import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pacSource = readFileSync(new URL("../deploy/zen/gate.pac", import.meta.url), "utf8");
const serverSource = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
const findProxy = new Function(`${pacSource}; return FindProxyForURL;`)() as (url: string, host: string) => string;
const GATE = "PROXY 127.0.0.1:8898";

describe("Zen gate PAC", () => {
  it("routes the protected apps and their subdomains to the gate", () => {
    for (const h of ["chatgpt.com", "CHATGPT.COM", "ab.chatgpt.com", "gemini.google.com", "www.youtube-nocookie.com", "rr3---sn-x.googlevideo.com"]) {
      expect(findProxy(`https://${h}/`, h)).toBe(GATE);
    }
  });

  it("leaves everything else direct, including look-alikes and the tables app", () => {
    for (const h of ["google.com", "mail.google.com", "notchatgpt.com", "chatgpt.com.evil.io", "claude.ai", "127.0.0.1", "localhost"]) {
      expect(findProxy(`https://${h}/`, h)).toBe("DIRECT");
    }
  });

  it("gates exactly the hosts the server will tunnel", () => {
    const pacHosts = [...pacSource.matchAll(/^\s+"([a-z0-9.-]+)",?$/gm)].map((m) => m[1]).sort();
    const serverHosts = [...serverSource.matchAll(/\["([a-z0-9.-]+)", "(?:chatgpt|gemini|stream)"\]/g)].map((m) => m[1]).sort();
    expect(pacHosts.length).toBe(4);
    expect(pacHosts).toEqual(serverHosts);
  });
});
