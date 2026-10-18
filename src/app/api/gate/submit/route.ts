import { getGate } from "@/lib/gate/instance";
import { fromGatePage, json } from "@/lib/gate/http";

export async function POST(req: Request) {
  if (!fromGatePage(req)) return json({ error: "Submit from the gate page." }, 403);
  const body: unknown = await req.json().catch(() => null);
  const b = typeof body === "object" && body !== null ? (body as { id?: unknown; answers?: unknown }) : {};
  const out = getGate().submit(b.id, b.answers);
  return out.ok ? json(out) : json(out, 409);
}
