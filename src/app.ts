// Exports the app so tests can use app.request().
import { Hono } from "hono";
import { requireInternalSecret } from "./lib/http";
import { log } from "./lib/log";
import { getRequestId, requestLogger } from "./lib/logging";
import { filesRoutes } from "./routes/files";
import { internalRoutes } from "./routes/internal";

export const app = new Hono();

app.use(requestLogger(log));
app.get("/healthz", (c) => c.json({ ok: true, service: "media-service" }));
// Everything else (including /files/*, which the gateway supplies the secret
// for on behalf of browsers) is behind the internal secret.
app.use("*", requireInternalSecret);

app.route("/", filesRoutes);
app.route("/", internalRoutes);

app.notFound((c) => c.json({ error: "Not found" }, 404));
app.onError((err, c) => {
  log.error("unhandled error", { requestId: getRequestId(c), err });
  return c.json({ error: "Internal server error" }, 500);
});
