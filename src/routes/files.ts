// Serves locally-stored uploads (public through the gateway as
// /api/files/<namespace>/*). Only the image extensions we store are served.
// In Blob mode these URLs are absolute Vercel URLs and this route is unused.
import { Hono } from "hono";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveFilePath } from "../lib/media";

export const filesRoutes = new Hono();

const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

// /files/<namespace>/<subpath>
filesRoutes.get("/files/:namespace/*", async (c) => {
  const namespace = c.req.param("namespace");
  const rest = decodeURIComponent(
    c.req.path.slice(`/files/${namespace}/`.length)
  );
  const ext = path.extname(rest).slice(1).toLowerCase();
  const contentType = CONTENT_TYPES[ext];
  if (!contentType) {
    return c.json({ error: "Not found" }, 404);
  }

  const filePath = resolveFilePath(namespace, rest);
  if (!filePath) {
    return c.json({ error: "Not found" }, 404);
  }

  try {
    const data = await readFile(filePath);
    return c.body(new Uint8Array(data), 200, { "content-type": contentType });
  } catch {
    return c.json({ error: "Not found" }, 404);
  }
});
