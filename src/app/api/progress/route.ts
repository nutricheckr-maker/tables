import { fromGatePage, json } from "@/lib/gate/http";
import { parseState } from "@/lib/persistence/schema";
import { clearProgress, readProgress, revision, saveMerged } from "@/lib/persistence/server-file";

export async function GET() {
  return json({ state: readProgress(), rev: revision() });
}

/** Body: an AppState whose `facts` may be only the records that changed. Merged, never replaced. */
export async function PUT(req: Request) {
  if (!fromGatePage(req)) return json({ error: "Same-origin requests only" }, 403);
  const parsed = parseState(await req.json().catch(() => null));
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const { rev } = saveMerged(parsed.state);
  return json({ ok: true, rev, warnings: parsed.warnings });
}

export async function DELETE(req: Request) {
  if (!fromGatePage(req)) return json({ error: "Same-origin requests only" }, 403);
  clearProgress();
  return json({ ok: true, rev: revision() });
}
