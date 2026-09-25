import { createFileRoute } from "@tanstack/react-router";
import { handleAgentPasteRead } from "@/lib/agent-paste-handler";

export const Route = createFileRoute("/api/agent/paste/$slug")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const secret = process.env.AGENT_API_TOKEN;
        if (!secret) return new Response("Server misconfigured", { status: 500 });
        return handleAgentPasteRead(request, params.slug, secret);
      },
    },
  },
});
