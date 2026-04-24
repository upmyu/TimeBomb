import express from "express";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import { attachRealtimeServer } from "./realtime";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function startDevServer(): Promise<void> {
  const app = express();
  const httpServer = createServer(app);

  attachRealtimeServer(app, httpServer);

  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
  });

  app.use(vite.middlewares);

  app.use(async (request, response, next) => {
    try {
      const url = request.originalUrl;
      const rawTemplate = await readFile(path.join(projectRoot, "index.html"), "utf-8");
      const template = await vite.transformIndexHtml(url, rawTemplate);
      response.status(200).set({ "Content-Type": "text/html" }).end(template);
    } catch (error) {
      vite.ssrFixStacktrace(error as Error);
      next(error);
    }
  });

  const port = Number(process.env.PORT ?? "5173");
  httpServer.listen(port, () => {
    console.log(`Timebomb dev server listening on http://localhost:${port}`);
  });
}

void startDevServer();
