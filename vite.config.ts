import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  // SITE_URL is public (the deployed address); exposing it lets og:image be an absolute URL.
  envPrefix: ["VITE_", "SITE_URL"],
  plugins: [
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tanstackStart(),
    nitro({ preset: "vercel" }),
    viteReact(),
  ],
});
