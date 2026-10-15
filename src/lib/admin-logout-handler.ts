import { clearSessionCookie, endSession } from "./session";

export async function handleAdminLogout(request: Request, secret: string): Promise<Response> {
  const url = new URL(request.url);
  try {
    await endSession(request, secret);
  } catch (err) {
    // Still clear the cookie; the record expires on its own after 8 hours.
    console.error("Failed to delete session", err);
  }
  const headers = new Headers();
  headers.set("Location", new URL("/admin/login", url.origin).toString());
  headers.append("Set-Cookie", clearSessionCookie());
  return new Response(null, { status: 302, headers });
}
