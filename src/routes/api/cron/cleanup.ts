import { createFileRoute } from "@tanstack/react-router";
import { handleCronCleanup } from "@/lib/cron-cleanup-handler";

export const Route = createFileRoute("/api/cron/cleanup")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const cronSecret = process.env.CRON_SECRET;
        if (!cronSecret) return new Response("Server misconfigured", { status: 500 });
        return handleCronCleanup(request, cronSecret);
      },
    },
  },
});
