import { createFileRoute } from "@tanstack/react-router";
import { handleAdminDelete } from "@/lib/admin-delete-handler";

export const Route = createFileRoute("/api/admin/delete")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.TOKEN_SECRET;
        if (!secret) return new Response("Server misconfigured", { status: 500 });
        return handleAdminDelete(request, secret);
      },
    },
  },
});
