import { generateSlug, isPlainText } from "./paste-validation";
import { computeExpiresAt } from "./retention";
import { savePaste } from "./storage";
import { verifyTurnstileToken } from "./turnstile";
import { areUploadsDisabled } from "./kill-switch";

const DEFAULT_MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const DEFAULT_RETENTION_DAYS = 7;

export async function handleUpload(request: Request): Promise<Response> {
  if (await areUploadsDisabled()) {
    return Response.json({ error: "Uploads are temporarily disabled" }, { status: 503 });
  }

  const turnstileSecret = process.env.TURNSTILE_SECRET_KEY;
  const siteUrl = process.env.SITE_URL;
  if (!turnstileSecret || !siteUrl) {
    return Response.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const formData = await request.formData();
  const turnstileToken = formData.get("turnstileToken");
  const fileField = formData.get("file");
  const contentField = formData.get("content");
  const label = formData.get("label");

  if (typeof turnstileToken !== "string" || !turnstileToken) {
    return Response.json({ error: "Missing verification token" }, { status: 400 });
  }

  const clientIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const verified = await verifyTurnstileToken(turnstileToken, clientIp, turnstileSecret);
  if (!verified) {
    return Response.json({ error: "Verification failed" }, { status: 400 });
  }

  let raw: Buffer;
  let originalFilename: string | null = null;
  if (fileField instanceof File) {
    raw = Buffer.from(await fileField.arrayBuffer());
    originalFilename = fileField.name;
  } else if (typeof contentField === "string") {
    raw = Buffer.from(contentField, "utf8");
  } else {
    return Response.json({ error: "No content provided" }, { status: 400 });
  }

  const maxBytes = Number(process.env.MAX_UPLOAD_BYTES) || DEFAULT_MAX_UPLOAD_BYTES;
  if (raw.length === 0 || raw.length > maxBytes) {
    return Response.json({ error: "Invalid upload size" }, { status: 400 });
  }
  if (!isPlainText(raw)) {
    return Response.json({ error: "Only plain text is accepted" }, { status: 400 });
  }

  const retentionDays = Number(process.env.RETENTION_DAYS) || DEFAULT_RETENTION_DAYS;
  const createdAt = new Date();
  const expiresAt = computeExpiresAt(createdAt, retentionDays);
  const slug = generateSlug();

  await savePaste({
    slug,
    content: raw.toString("utf8"),
    meta: {
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      sizeBytes: raw.length,
      originalFilename,
      label: typeof label === "string" && label.trim() ? label.trim().slice(0, 200) : null,
      uploaderIp: clientIp ?? null,
      uploaderCountry: request.headers.get("x-vercel-ip-country"),
      userAgent: request.headers.get("user-agent"),
    },
  });

  return Response.json({ url: `${siteUrl}/r/${slug}` });
}
