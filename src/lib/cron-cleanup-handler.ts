import { deleteExpiredPastes } from "./storage";

export async function handleCronCleanup(request: Request, cronSecret: string): Promise<Response> {
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const deleted = await deleteExpiredPastes(new Date());
  return Response.json({ deleted });
}
