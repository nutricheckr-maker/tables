// Builds the Next.js standalone server that the desktop app runs:
// .next-desktop/standalone with .next-desktop/static and public copied in (server.js serves them).

import { spawnSync } from "node:child_process";
import { cpSync, rmSync } from "node:fs";

rmSync(".next-desktop", { recursive: true, force: true });
const r = spawnSync("npx", ["next", "build"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, NEXT_PUBLIC_TABLES_DESKTOP: "1" },
});
if (r.status !== 0) process.exit(r.status ?? 1);

cpSync(".next-desktop/static", ".next-desktop/standalone/.next-desktop/static", { recursive: true });
cpSync("public", ".next-desktop/standalone/public", { recursive: true });
