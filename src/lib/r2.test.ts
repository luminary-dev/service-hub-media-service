import { afterEach, describe, expect, it } from "vitest";
import { r2Enabled } from "./r2";

const KEYS = [
  "R2_ENDPOINT",
  "R2_BUCKET",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
] as const;

afterEach(() => KEYS.forEach((k) => delete process.env[k]));

// r2Enabled gates the whole backend selection (R2 > Blob > local), so it must
// only report true when the config is COMPLETE — a partial config has to fall
// back safely rather than half-initialise an S3 client.
describe("r2Enabled", () => {
  it("is false when nothing is set", () => {
    KEYS.forEach((k) => delete process.env[k]);
    expect(r2Enabled()).toBe(false);
  });

  it("is false when only some vars are set", () => {
    process.env.R2_ENDPOINT = "https://x.r2.cloudflarestorage.com";
    process.env.R2_BUCKET = "b";
    expect(r2Enabled()).toBe(false);
  });

  it("is true only when all four are set", () => {
    process.env.R2_ENDPOINT = "https://x.r2.cloudflarestorage.com";
    process.env.R2_BUCKET = "b";
    process.env.R2_ACCESS_KEY_ID = "id";
    process.env.R2_SECRET_ACCESS_KEY = "secret";
    expect(r2Enabled()).toBe(true);
  });
});
