import { describe, it, expect } from "vitest";
import {
  storeFile,
  InvalidImageError,
  InvalidNamespaceError,
  InvalidPrefixError,
} from "./media";

// The store path joins `prefix` into the on-disk directory and the Blob key,
// so these guards run BEFORE any image processing or file write — a bad
// namespace/prefix must never reach the filesystem.
describe("storeFile input guards", () => {
  const dummy = Buffer.from("not-an-image");

  it("rejects an unknown namespace", async () => {
    await expect(storeFile("evil", "uploads", dummy)).rejects.toBeInstanceOf(
      InvalidNamespaceError
    );
  });

  it("rejects a traversal / multi-segment / whitespace prefix", async () => {
    await expect(
      storeFile("provider", "../../tmp/pwn", dummy)
    ).rejects.toBeInstanceOf(InvalidPrefixError);
    await expect(storeFile("provider", "a/b", dummy)).rejects.toBeInstanceOf(
      InvalidPrefixError
    );
    await expect(storeFile("provider", "..", dummy)).rejects.toBeInstanceOf(
      InvalidPrefixError
    );
    await expect(storeFile("review", "up loads", dummy)).rejects.toBeInstanceOf(
      InvalidPrefixError
    );
    await expect(storeFile("provider", "", dummy)).rejects.toBeInstanceOf(
      InvalidPrefixError
    );
  });

  it("accepts a plain slug prefix (then rejects the non-image payload)", async () => {
    // valid namespace + valid prefix → the guards pass and control reaches
    // processImage, which rejects the dummy buffer. Reaching InvalidImageError
    // proves the prefix guard let a legitimate slug through.
    await expect(storeFile("provider", "uploads", dummy)).rejects.toBeInstanceOf(
      InvalidImageError
    );
  });
});
