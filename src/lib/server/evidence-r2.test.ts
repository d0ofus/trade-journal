import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { evidenceStorageConfig, signEvidenceGet, signEvidencePut } from "./evidence-r2";
beforeEach(() => {
  vi.stubEnv("EVIDENCE_R2_ACCOUNT_ID", "isolated-test-account");
  vi.stubEnv("EVIDENCE_R2_BUCKET", "trade-journal-evidence-nonproduction");
  vi.stubEnv("EVIDENCE_R2_ACCESS_KEY_ID", "isolated-test-access");
  vi.stubEnv("EVIDENCE_R2_SECRET_ACCESS_KEY", "isolated-test-secret-not-a-credential");
  vi.stubEnv("VERCEL_ENV", "preview");
});
afterEach(() => vi.unstubAllEnvs());
describe("private object signing without network or provisioning", () => {
  it("signs immutable temporary uploads for five minutes with the exact content length and PNG type", async () => {
    const url = new URL(await signEvidencePut("pending/owner/upload.png", 5_000_000));
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("X-Amz-SignedHeaders")?.split(";")).toEqual(expect.arrayContaining(["content-type", "content-length", "if-none-match"]));
    await expect(signEvidencePut("originals/asset.png", 10)).rejects.toThrow(/temporary/);
    for (const bytes of [0, 20_000_001, NaN, 1.5]) await expect(signEvidencePut("pending/upload.png", bytes)).rejects.toThrow(/byte count/);
  });
  it("signs private original downloads, never a public bucket URL", async () => {
    const url = new URL(await signEvidenceGet("originals/asset.png", true));
    expect(url.searchParams.get("response-cache-control")).toBe("private, max-age=240");
    expect(url.searchParams.get("response-content-disposition")).toBe("attachment");
    expect(url.hostname).toContain("r2.cloudflarestorage.com");
  });
  it("rejects unavailable, shared and wrong-environment storage without falling back", () => {
    vi.stubEnv("EVIDENCE_R2_BUCKET", "chart-screener-artifacts"); expect(evidenceStorageConfig).toThrow(/dedicated/);
    vi.stubEnv("EVIDENCE_R2_BUCKET", "trade-journal-evidence-production"); expect(evidenceStorageConfig).toThrow(/Non-production/);
    vi.stubEnv("VERCEL_ENV", "production"); expect(evidenceStorageConfig().bucket).toBe("trade-journal-evidence-production");
    vi.stubEnv("EVIDENCE_R2_BUCKET", "trade-journal-evidence-nonproduction"); expect(evidenceStorageConfig).toThrow(/Production evidence/);
    vi.stubEnv("EVIDENCE_R2_SECRET_ACCESS_KEY", ""); expect(evidenceStorageConfig).toThrow(/not configured/);
  });
});
