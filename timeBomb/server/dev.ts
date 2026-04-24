import express from "express";
import { createServer } from "node:http";
import { createServer as createViteServer } from "vite";
import { attachRealtimeServer } from "./realtime";

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
      const template = await vite.transformIndexHtml(url, `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>タイムボム MVP</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`);
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
