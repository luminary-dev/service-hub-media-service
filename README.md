# media-service

> [!WARNING]
> This repository is a **read-only mirror** of [`services/media-service`](https://github.com/luminary-dev/service-hub/tree/main/services/media-service) in the service-hub monorepo. Do not push or open PRs here — changes land via monorepo PRs and are synced out with `npm run sync:repos`. Direct pushes are blocked by branch protection.

Media / image-processing service for Service Hub (Baas.lk), listening on `:4006`. It owns the upload **bytes** and the `sharp` pipeline; the database rows that reference the stored URLs stay with their owning service (provider-service, review-service).

## What it does

- **Processing** (`POST /internal/media/store`, multipart `namespace`/`prefix`/`file`): decodes and re-encodes every upload with `sharp`, proving it's a real JPEG/PNG/WebP, baking in EXIF orientation, and stripping all metadata (EXIF GPS in phone photos would otherwise leak home locations). Returns the URL to persist. `400` for non-images.
- **Deletion** (`POST /internal/media/delete` `{ url }`): best-effort removal.
- **Orphan sweep** (`POST /internal/media/sweep` `{ namespace, referenced[] }`): the caller (which owns the rows) supplies the referenced URL set; this service lists its store and removes anything unreferenced older than a 24h grace window.
- **Serving** (`GET /files/<namespace>/*`): serves locally-stored files (public through the gateway as `/api/files/<namespace>/*`). In Blob mode the URLs are absolute Vercel URLs and this route is unused.

Storage backend: Vercel Blob when `BLOB_READ_WRITE_TOKEN` is set, else local disk under `$MEDIA_DIR/<namespace>/`. Namespaces (`provider`, `review`) map to the callers so their existing `/api/files/<namespace>/...` URLs keep resolving unchanged.
