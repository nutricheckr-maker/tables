import { getGate } from "@/lib/gate/instance";
import { json } from "@/lib/gate/http";

/**
 * Anyone local may revoke: it only ever removes access. Used by the suspend
 * hook and `tables-gate lock`.
 */
export async function POST(req: Request) {
  const r = new URL(req.url).searchParams.get("reason");
  const reason = r === "login" || r === "suspend" ? r : "manual";
  getGate().revoke(reason);
  return json(getGate().status());
}
