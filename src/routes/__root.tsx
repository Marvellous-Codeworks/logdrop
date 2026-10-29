import { Outlet, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { THEME_INIT_JS } from "@/lib/html-shell";

const DESCRIPTION = "A plain-text drop-off for logs, configs and snippets that expires automatically.";
// Paste views (/r/:slug) are server-rendered outside this root, so they never get a preview card.
const OG_IMAGE = `${import.meta.env.SITE_URL ?? ""}/og-image.png`;

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "logdrop" },
      { name: "description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:title", content: "logdrop" },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:image", content: OG_IMAGE },
      { property: "og:image:width", content: "1280" },
      { property: "og:image:height", content: "640" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "stylesheet", href: "/app.css" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap",
      },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <html lang="en">
      <head>
        {/* Must run before first paint, and before HeadContent's stylesheet
            is applied, so an explicit stored preference never flashes the
            wrong theme first. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_JS }} />
        <HeadContent />
      </head>
      <body>
        <Outlet />
        <Scripts />
      </body>
    </html>
  );
}
