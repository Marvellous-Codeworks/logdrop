import { createFileRoute } from "@tanstack/react-router";
import { handleAdminVerify } from "@/lib/admin-verify-handler";

export const Route = createFileRoute("/admin/verify")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const secret = process.env.TOKEN_SECRET;
        if (!secret) return new Response("Server misconfigured", { status: 500 });
        return handleAdminVerify(url.searchParams.get("token"), secret, url.origin);
      },
    },
  },
});
