import { createFileRoute } from "@tanstack/react-router";
import { handleAdminLogout } from "@/lib/admin-logout-handler";

export const Route = createFileRoute("/api/admin/logout")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.TOKEN_SECRET;
        if (!secret) return new Response("Server misconfigured", { status: 500 });
        return handleAdminLogout(request, secret);
      },
    },
  },
});
