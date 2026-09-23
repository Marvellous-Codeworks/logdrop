import { createFileRoute } from "@tanstack/react-router";
import { handleUpload } from "@/lib/upload-handler";

export const Route = createFileRoute("/api/upload")({
  server: {
    handlers: {
      POST: async ({ request }) => handleUpload(request),
    },
  },
});
