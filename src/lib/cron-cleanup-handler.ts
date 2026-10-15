import { deleteExpiredPastes } from "./storage";
import { deleteExpiredAuthRecords } from "./auth-store";

export async function handleCronCleanup(request: Request, cronSecret: string): Promise<Response> {
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const now = new Date();
  const deleted = await deleteExpiredPastes(now);
  const authRecordsDeleted = await deleteExpiredAuthRecords(now);
  return Response.json({ deleted, authRecordsDeleted });
}
