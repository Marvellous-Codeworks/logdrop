import { get } from "@vercel/edge-config";

export async function areUploadsDisabled(): Promise<boolean> {
  try {
    return (await get("uploadsDisabled")) === true;
  } catch {
    // An optional safety valve failing shouldn't take the whole upload
    // flow down with it — fail open rather than closed.
    return false;
  }
}
