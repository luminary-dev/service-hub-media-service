import { describe, it, expect } from "vitest";
import { findOrphans, DEFAULT_GRACE_MS, type StoredFile } from "./media";

const NOW = Date.parse("2026-07-04T12:00:00Z");
const OLD = new Date(NOW - DEFAULT_GRACE_MS - 60_000);
const FRESH = new Date(NOW - 60_000);

const file = (url: string, modifiedAt: Date): StoredFile => ({
  key: url,
  url,
  modifiedAt,
});

describe("findOrphans", () => {
  it("flags old unreferenced files", () => {
    const files = [file("/api/files/provider/uploads/a.jpg", OLD)];
    expect(findOrphans(files, new Set(), DEFAULT_GRACE_MS, NOW)).toHaveLength(1);
  });

  it("keeps referenced files regardless of age", () => {
    const url = "/api/files/provider/uploads/a.jpg";
    const files = [file(url, OLD)];
    expect(findOrphans(files, new Set([url]), DEFAULT_GRACE_MS, NOW)).toHaveLength(0);
  });

  it("keeps fresh files inside the grace window (in-flight uploads)", () => {
    const files = [file("/api/files/provider/uploads/b.jpg", FRESH)];
    expect(findOrphans(files, new Set(), DEFAULT_GRACE_MS, NOW)).toHaveLength(0);
  });

  it("mixes correctly", () => {
    const keepRef = file("/api/files/provider/uploads/ref.jpg", OLD);
    const keepFresh = file("/api/files/provider/uploads/fresh.jpg", FRESH);
    const orphan = file("/api/files/provider/uploads/orphan.jpg", OLD);
    const out = findOrphans(
      [keepRef, keepFresh, orphan],
      new Set([keepRef.url]),
      DEFAULT_GRACE_MS,
      NOW
    );
    expect(out.map((f) => f.url)).toEqual([orphan.url]);
  });
});
