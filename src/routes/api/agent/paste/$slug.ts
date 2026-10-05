import { createFileRoute } from "@tanstack/react-router";
import { handleAgentPasteRead } from "@/lib/agent-paste-handler";

export const Route = createFileRoute("/api/agent/paste/$slug")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        // AGENT_API_TOKEN is the optional, deprecated instance-wide token;
        // per-admin tokens are checked inside the handler.
        return handleAgentPasteRead(request, params.slug, process.env.AGENT_API_TOKEN || undefined);
      },
    },
  },
});
