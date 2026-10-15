import { createFileRoute } from "@tanstack/react-router";
import { handleAdminVerify, handleAdminVerifyPage } from "@/lib/admin-verify-handler";

function formString(form: FormData, name: string): string | null {
  const value = form.get(name);
  return typeof value === "string" ? value : null;
}

export const Route = createFileRoute("/admin/verify")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        return handleAdminVerifyPage(url.searchParams.get("token"), url.origin, url.searchParams.get("next"));
      },
      POST: async ({ request }) => {
        const url = new URL(request.url);
        const secret = process.env.TOKEN_SECRET;
        if (!secret) return new Response("Server misconfigured", { status: 500 });
        const form = await request.formData().catch(() => new FormData());
        return handleAdminVerify(formString(form, "token"), secret, url.origin, formString(form, "next"));
      },
    },
  },
});
