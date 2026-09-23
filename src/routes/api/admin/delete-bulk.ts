import { createFileRoute } from "@tanstack/react-router";
import { handleAdminDeleteBulk } from "@/lib/admin-delete-bulk-handler";

export const Route = createFileRoute("/api/admin/delete-bulk")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.TOKEN_SECRET;
        if (!secret) return new Response("Server misconfigured", { status: 500 });
        return handleAdminDeleteBulk(request, secret);
      },
    },
  },
});
