import { createFileRoute } from "@tanstack/react-router";
import { handleAdminAnalyzed } from "@/lib/admin-analyzed-handler";

export const Route = createFileRoute("/api/admin/analyzed")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.TOKEN_SECRET;
        if (!secret) return new Response("Server misconfigured", { status: 500 });
        return handleAdminAnalyzed(request, secret);
      },
    },
  },
});
