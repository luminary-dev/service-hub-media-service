import { describe, it, expect } from "vitest";
import { resolveFilePath } from "./media";

describe("resolveFilePath", () => {
  it("resolves a plain relative path inside a namespace root", () => {
    const resolved = resolveFilePath("provider", "uploads/abc.jpg");
    expect(resolved).not.toBeNull();
    expect(resolved).toContain("provider");
    expect(resolved).toContain("uploads");
  });

  it("refuses path traversal", () => {
    expect(resolveFilePath("provider", "../../etc/passwd")).toBeNull();
    expect(resolveFilePath("review", "reviews/../../secret.txt")).toBeNull();
  });

  it("refuses the namespace root itself", () => {
    expect(resolveFilePath("provider", "")).toBeNull();
    expect(resolveFilePath("provider", ".")).toBeNull();
  });

  it("rejects unknown namespaces", () => {
    expect(resolveFilePath("evil", "uploads/x.jpg")).toBeNull();
  });
});
