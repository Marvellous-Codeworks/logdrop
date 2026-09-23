import { createFileRoute } from "@tanstack/react-router";
import { handleAdminDashboard } from "@/lib/admin-dashboard-handler";

export const Route = createFileRoute("/admin/")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const secret = process.env.TOKEN_SECRET;
        if (!secret) return new Response("Server misconfigured", { status: 500 });
        return handleAdminDashboard(request, secret);
      },
    },
  },
});
