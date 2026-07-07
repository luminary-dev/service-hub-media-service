// Serves stored uploads (public through the gateway as /api/files/<namespace>/*).
// Only the image extensions we store are served. Bytes come from R2 (private
// bucket, streamed here) or local disk. In Vercel Blob mode these URLs are
// absolute Vercel URLs and this route is unused.
import { Hono } from "hono";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { isKnownNamespace, resolveFilePath } from "../lib/media";
import { r2Enabled, r2Get } from "../lib/r2";

export const filesRoutes = new Hono();

const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

// UUID-named files never change, so cache them hard.
const CACHE_CONTROL = "public, max-age=31536000, immutable";

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

  // R2: stream the object straight from the private bucket.
  if (r2Enabled()) {
    if (!isKnownNamespace(namespace)) {
      return c.json({ error: "Not found" }, 404);
    }
    const obj = await r2Get(`${namespace}/${rest}`);
    if (!obj) {
      return c.json({ error: "Not found" }, 404);
    }
    return c.body(new Uint8Array(obj.body), 200, {
      "content-type": obj.contentType ?? contentType,
      "cache-control": CACHE_CONTROL,
    });
  }

  // Local disk (traversal-guarded).
  const filePath = resolveFilePath(namespace, rest);
  if (!filePath) {
    return c.json({ error: "Not found" }, 404);
  }
  try {
    const data = await readFile(filePath);
    return c.body(new Uint8Array(data), 200, {
      "content-type": contentType,
      "cache-control": CACHE_CONTROL,
    });
  } catch {
    return c.json({ error: "Not found" }, 404);
  }
});
