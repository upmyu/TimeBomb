import express from "express";
import path from "node:path";
import { createServer } from "node:http";
import { attachRealtimeServer } from "./realtime";

const app = express();
const httpServer = createServer(app);
const clientDistPath = path.resolve(process.cwd(), "dist");

attachRealtimeServer(app, httpServer);

app.use(express.static(clientDistPath));

app.get("/{*any}", (_request, response) => {
  response.sendFile(path.join(clientDistPath, "index.html"));
});

const port = Number(process.env.PORT ?? "3001");
httpServer.listen(port, () => {
  console.log(`Timebomb server listening on http://localhost:${port}`);
});
