/**
 * The mental-math gate's rules, in one place. The server enforces all of them;
 * the page only displays them.
 */
export const GATE = {
  questions: 10,
  /** Whole session, measured on the server from start to submission. Inclusive. */
  timeLimitMs: 40_000,
  /** 75% of 10. Inclusive. */
  passCorrect: 8,
  /** How long a pass unlocks the protected apps. Suspend, restart and login end it early. */
  grantMs: 30 * 60_000,
  /** Wall clock running this far ahead of the monotonic clock means the machine slept. */
  suspendJumpMs: 15_000,
  /** Smallest factor asked: ×1 tests nothing. */
  minFactor: 2,
} as const;

export type ProtectedApp = "chatgpt" | "gemini" | "stream";

export interface AppInfo {
  id: ProtectedApp;
  label: string;
  /** Where "Continue" goes after a pass. */
  url: string;
}

export const APPS: Record<ProtectedApp, AppInfo> = {
  chatgpt: { id: "chatgpt", label: "ChatGPT", url: "https://chatgpt.com/" },
  gemini: { id: "gemini", label: "Gemini", url: "https://gemini.google.com/" },
  stream: { id: "stream", label: "Stream", url: "http://127.0.0.1:5180/" },
};

export function isProtectedApp(v: unknown): v is ProtectedApp {
  return v === "chatgpt" || v === "gemini" || v === "stream";
}
