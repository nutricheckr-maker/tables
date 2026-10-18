/**
 * Starting and submitting a challenge must come from the gate page itself.
 * Browsers always send Sec-Fetch-Site on fetch(); another website (or a page
 * on another local port) gets "cross-site"/"same-site" and is refused.
 */
export function fromGatePage(req: Request): boolean {
  return req.headers.get("sec-fetch-site") === "same-origin";
}

export const NO_STORE = { "Cache-Control": "no-store" };

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}
