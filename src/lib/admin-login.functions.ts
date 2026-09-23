import { createServerFn } from "@tanstack/react-start";
import { handleAdminLoginRequest } from "./admin-login-handler";
import { sanitizeNext } from "./safe-next";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const requestAdminMagicLink = createServerFn({ method: "POST" })
  .inputValidator((data: { email: string; next?: string }) => {
    if (typeof data.email !== "string" || !EMAIL_RE.test(data.email)) {
      throw new Error("Invalid email");
    }
    // An unsafe or unknown `next` is silently dropped, never an error.
    return { email: data.email, next: sanitizeNext(data.next) };
  })
  .handler(async ({ data }) => handleAdminLoginRequest(data.email, data.next));
