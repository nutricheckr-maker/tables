import { getGate } from "@/lib/gate/instance";
import { json } from "@/lib/gate/http";

export async function GET() {
  const gate = getGate();
  return json({ ...gate.status(), history: gate.history().slice(-10) });
}
