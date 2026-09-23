import { createServerFn } from "@tanstack/react-start";
import { handleAdminLoginRequest } from "./admin-login-handler";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const requestAdminMagicLink = createServerFn({ method: "POST" })
  .inputValidator((data: { email: string }) => {
    if (typeof data.email !== "string" || !EMAIL_RE.test(data.email)) {
      throw new Error("Invalid email");
    }
    return data;
  })
  .handler(async ({ data }) => handleAdminLoginRequest(data.email));
