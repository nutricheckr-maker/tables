import { getGate, progressSource } from "@/lib/gate/instance";
import { fromGatePage, json } from "@/lib/gate/http";

export async function POST(req: Request) {
  if (!fromGatePage(req)) return json({ error: "Start the challenge from the gate page." }, 403);
  // Questions come from the facts introduced in the trainer, read here on the
  // server; nothing the page sends can change which facts are eligible.
  const out = getGate().start(progressSource());
  // Questions only — the answers stay in server memory.
  return "error" in out ? json(out, 409) : json(out);
}
