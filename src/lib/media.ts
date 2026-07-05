// Media / image processing (extracted from provider- and review-service, #36
// et al.). This service owns the BYTES and the sharp pipeline; the DB rows
// that reference the URLs stay with their owning service. Namespaces map to
// the callers so their existing /api/files/<namespace>/... URLs keep working
// unchanged (the volumes are simply remounted here).
import { mkdir, writeFile, unlink, readdir, stat } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { put, del, list } from "@vercel/blob";
import sharp from "sharp";

export const MAX_UPLOAD_SIZE = 5 * 1024 * 1024; // 5MB
export const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
export const DEFAULT_GRACE_MS = 24 * 60 * 60_000;

// Root under which each namespace's files live. In compose the callers'
// original upload volumes are mounted at $MEDIA_DIR/<namespace>, so existing
// files resolve with no migration.
const MEDIA_DIR = process.env.MEDIA_DIR ?? "./data";
const NAMESPACES = new Set(["provider", "review"]);

// A prefix is a single path segment chosen by the calling service ("uploads",
// "reviews"). It is joined into the on-disk path and the Blob key, so it must
// not be able to contain path separators or `..` — otherwise a caller that
// derives the prefix from user input could write outside the namespace root
// (local) or escape the per-namespace key scoping the sweep relies on (Blob).
const PREFIX_RE = /^[a-zA-Z0-9_-]+$/;

export class InvalidNamespaceError extends Error {}

// Thrown when the prefix isn't a plain single-segment slug — mapped to 400.
export class InvalidPrefixError extends Error {}

// Thrown when a payload does not decode as a real JPEG/PNG/WebP — callers
// translate it into a 400.
export class InvalidImageError extends Error {}

// Decode-and-re-encode with sharp (#19/#132/#140): proves the payload really
// is an image in the claimed family (a polyglot or mislabeled file fails to
// decode), applies the EXIF orientation, and drops ALL metadata — EXIF GPS
// coordinates in tradespeople's phone photos would otherwise leak home
// locations.
export async function processImage(
  input: Buffer
): Promise<{ data: Buffer; ext: string }> {
  try {
    const img = sharp(input, { failOn: "error", limitInputPixels: 50_000_000 });
    const meta = await img.metadata();
    // rotate() bakes in the EXIF orientation BEFORE metadata is stripped, so
    // phone photos don't come out sideways.
    if (meta.format === "jpeg") {
      return { data: await img.rotate().jpeg({ quality: 85 }).toBuffer(), ext: "jpg" };
    }
    if (meta.format === "png") {
      return { data: await img.rotate().png().toBuffer(), ext: "png" };
    }
    if (meta.format === "webp") {
      return { data: await img.rotate().webp().toBuffer(), ext: "webp" };
    }
  } catch {
    // fall through
  }
  throw new InvalidImageError("Only JPEG, PNG or WebP images are allowed");
}

function nsDir(namespace: string): string {
  return path.join(MEDIA_DIR, namespace);
}

// Processes and stores an upload, returning the URL to persist: an absolute
// Vercel Blob URL in production, else a gateway-served /api/files/... path.
export async function storeFile(
  namespace: string,
  prefix: string,
  buffer: Buffer
): Promise<string> {
  if (!NAMESPACES.has(namespace)) {
    throw new InvalidNamespaceError(`unknown namespace: ${namespace}`);
  }
  if (!PREFIX_RE.test(prefix)) {
    throw new InvalidPrefixError(`invalid prefix: ${prefix}`);
  }
  const { data, ext } = await processImage(buffer);
  const filename = `${crypto.randomUUID()}.${ext}`;
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    // Namespaced key so the per-namespace sweep can scope safely on a shared
    // Blob store.
    const blob = await put(`${namespace}/${prefix}/${filename}`, data, {
      access: "public",
    });
    return blob.url;
  }
  const dir = path.join(nsDir(namespace), prefix);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, filename), data);
  return `/api/files/${namespace}/${prefix}/${filename}`;
}

// Best-effort deletion (errors swallowed) — resolves a local /api/files/...
// URL back to disk, or dels a Blob URL.
export async function deleteFile(url: string): Promise<void> {
  try {
    const m = /^\/api\/files\/([a-z]+)\/(.+)$/.exec(url);
    if (m && NAMESPACES.has(m[1])) {
      const target = resolveFilePath(m[1], m[2]);
      if (target) await unlink(target);
      return;
    }
    if (url.startsWith("http") && process.env.BLOB_READ_WRITE_TOKEN) {
      await del(url);
    }
  } catch {
    // best-effort
  }
}

// GET /files/<namespace>/<sub> handler support: resolve against the
// namespace root, refuse path traversal and unknown namespaces.
export function resolveFilePath(
  namespace: string,
  subpath: string
): string | null {
  if (!NAMESPACES.has(namespace)) return null;
  const root = path.resolve(nsDir(namespace));
  const resolved = path.resolve(
    root,
    path.normalize(subpath).replace(/^([/\\])+/, "")
  );
  if (!resolved.startsWith(root + path.sep)) return null;
  return resolved;
}

export type StoredFile = { key: string; url: string; modifiedAt: Date };

// Pure so the policy is unit-testable: an orphan is old enough to be outside
// the grace window (protects in-flight uploads racing their DB write) AND
// unreferenced by any database row.
export function findOrphans(
  files: StoredFile[],
  referenced: Set<string>,
  graceMs = DEFAULT_GRACE_MS,
  now = Date.now()
): StoredFile[] {
  return files.filter(
    (f) => now - f.modifiedAt.getTime() > graceMs && !referenced.has(f.url)
  );
}

async function listLocal(namespace: string): Promise<StoredFile[]> {
  const files: StoredFile[] = [];
  const root = nsDir(namespace);
  let prefixes: string[];
  try {
    prefixes = await readdir(root);
  } catch {
    return files; // nothing stored yet
  }
  for (const prefix of prefixes) {
    const dir = path.join(root, prefix);
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      continue; // not a directory
    }
    for (const name of names) {
      const full = path.join(dir, name);
      try {
        const s = await stat(full);
        if (!s.isFile()) continue;
        files.push({
          key: full,
          url: `/api/files/${namespace}/${prefix}/${name}`,
          modifiedAt: s.mtime,
        });
      } catch {
        // raced a delete — skip
      }
    }
  }
  return files;
}

async function listBlob(namespace: string): Promise<StoredFile[]> {
  const files: StoredFile[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ cursor, prefix: `${namespace}/` });
    for (const b of page.blobs) {
      files.push({ key: b.url, url: b.url, modifiedAt: new Date(b.uploadedAt) });
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return files;
}

// Removes stored files in a namespace that no DB row references. The caller
// (which owns the rows) supplies the referenced URL set; this service owns
// the store, so it lists and deletes. Removal is best-effort per file.
export async function sweep(
  namespace: string,
  referenced: Set<string>,
  graceMs = DEFAULT_GRACE_MS
): Promise<{ scanned: number; removed: number }> {
  if (!NAMESPACES.has(namespace)) {
    throw new InvalidNamespaceError(`unknown namespace: ${namespace}`);
  }
  const useBlob = Boolean(process.env.BLOB_READ_WRITE_TOKEN);
  const files = useBlob ? await listBlob(namespace) : await listLocal(namespace);
  const orphans = findOrphans(files, referenced, graceMs);
  let removed = 0;
  for (const f of orphans) {
    try {
      if (useBlob) {
        await del(f.url);
      } else {
        await unlink(f.key);
      }
      removed++;
    } catch {
      // best-effort — a failed delete just isn't counted
    }
  }
  return { scanned: files.length, removed };
}
