import { createFileRoute } from "@tanstack/react-router";
import { handlePasteView } from "@/lib/paste-view-handler";

export const Route = createFileRoute("/r/$slug")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const secret = process.env.TOKEN_SECRET;
        if (!secret) return new Response("Server misconfigured", { status: 500 });
        return handlePasteView(request, params.slug, secret);
      },
    },
  },
});
