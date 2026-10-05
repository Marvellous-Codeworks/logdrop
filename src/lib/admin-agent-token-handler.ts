import { getAdminEmails } from "./admin-allowlist";
import { createAgentTokenFor, maskAgentToken, revokeAgentTokenFor } from "./agent-tokens";
import { getSessionEmail } from "./session";

// Lets the signed-in admin manage their own agent token. The plaintext token
// is only ever returned by "generate"; nothing else can read it back.
export async function handleAdminAgentToken(request: Request, secret: string): Promise<Response> {
  const email = getSessionEmail(request, secret, getAdminEmails());
  if (!email) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Malformed body" }, { status: 400 });
  }
  const action = typeof body === "object" && body !== null ? (body as { action?: unknown }).action : undefined;

  if (action === "generate") {
    const { token, record } = await createAgentTokenFor(email);
    return Response.json(
      { token, masked: maskAgentToken(record.hint), createdAt: record.createdAt },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  if (action === "revoke") {
    const revoked = await revokeAgentTokenFor(email);
    return Response.json({ ok: true, revoked });
  }
  return Response.json({ error: 'Expected { action: "generate" | "revoke" }' }, { status: 400 });
}
