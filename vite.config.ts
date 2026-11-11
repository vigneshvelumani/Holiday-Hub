import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// Same-origin RSS relay for `npm run dev` / `npm run preview`.
// Browsers cannot read most RSS feeds directly (no CORS headers), so the app asks
// this endpoint first and falls back to a public RSS→JSON service on static hosting.
// Only the hosts below can be fetched — it is not an open proxy.
const RSS_HOSTS = new Set(["news.google.com"]);

function rssRelay(): Plugin {
  const handler = async (req: any, res: any) => {
    try {
      const target = new URL(new URL(req.url, "http://x").searchParams.get("url") || "");
      if (target.protocol !== "https:" || !RSS_HOSTS.has(target.hostname)) {
        res.statusCode = 400;
        return res.end("feed host not allowed");
      }
      const r = await fetch(target, { headers: { "user-agent": "Mozilla/5.0 (rss reader)" } });
      res.statusCode = r.status;
      res.setHeader("content-type", "application/xml; charset=utf-8");
      res.setHeader("cache-control", "public, max-age=300");
      res.end(await r.text());
    } catch {
      res.statusCode = 502;
      res.end("feed unavailable");
    }
  };
  return {
    name: "rss-relay",
    configureServer(server) {
      server.middlewares.use("/api/rss", handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use("/api/rss", handler);
    },
  };
}

export default defineConfig({
  plugins: [react(), rssRelay()],
  server: { port: 5173 },
});
