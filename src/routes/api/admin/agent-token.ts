import { createFileRoute } from "@tanstack/react-router";
import { handleAdminAgentToken } from "@/lib/admin-agent-token-handler";

export const Route = createFileRoute("/api/admin/agent-token")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.TOKEN_SECRET;
        if (!secret) return new Response("Server misconfigured", { status: 500 });
        return handleAdminAgentToken(request, secret);
      },
    },
  },
});
