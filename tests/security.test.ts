import { describe, expect, it } from "vitest";
import { ALL_ROLES, canAccess, homeFor, isStaff, SELF_REGISTER_ROLES } from "@/lib/auth/rbac";
import { safeNext } from "@/lib/auth/next";
import { sanitizeFilename, sniffMime, validateUpload } from "@/lib/files/validate";
import { generateToken, hashPassword, hashToken, passwordSchema, verifyPassword } from "@/lib/auth/password";
import { rateLimit } from "@/lib/auth/rate-limit";
import { assertPublicHttpUrl } from "@/lib/jobs/http";

describe("rbac", () => {
  it("restricts each area to the right roles", () => {
    expect(canAccess("CANDIDATE", "app")).toBe(true);
    expect(canAccess("CANDIDATE", "employer")).toBe(false);
    expect(canAccess("CANDIDATE", "admin")).toBe(false);
    for (const r of ["EMPLOYER", "RECRUITER", "EMPLOYER_ADMIN"] as const) {
      expect(canAccess(r, "employer")).toBe(true);
      expect(canAccess(r, "admin")).toBe(false);
      expect(canAccess(r, "app")).toBe(false);
    }
    expect(canAccess("MODERATOR", "admin")).toBe(true);
    expect(canAccess("MODERATOR", "admin-users")).toBe(false);
    expect(canAccess("ADMIN", "admin-users")).toBe(true);
    expect(canAccess("ADMIN", "employer")).toBe(false);
  });
  it("never lets staff roles self-register", () => {
    expect(SELF_REGISTER_ROLES.some((r) => isStaff(r))).toBe(false);
  });
  it("routes every role somewhere", () => {
    for (const r of ALL_ROLES) expect(homeFor(r)).toMatch(/^\//);
  });
});

describe("open redirect guard", () => {
  it("allows only same-site relative paths", () => {
    expect(safeNext("/dashboard")).toBe("/dashboard");
    expect(safeNext("/jobs?q=revit")).toBe("/jobs?q=revit");
    for (const bad of ["//evil.com", "https://evil.com", "/\\evil.com", "javascript:alert(1)", "evil", "/ok\nSet-Cookie:x=1", null, undefined]) {
      expect(safeNext(bad as never)).toBeNull();
    }
  });
});

describe("file validation", () => {
  const pdf = Buffer.from("%PDF-1.7\n1 0 obj");
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)]);
  const exe = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(100, 1)]);
  it("detects types by content, not by name", () => {
    expect(sniffMime(pdf)).toBe("application/pdf");
    expect(sniffMime(png)).toBe("image/png");
    expect(sniffMime(Buffer.from("hello resume text"))).toBe("text/plain");
    expect(sniffMime(exe)).toBeNull();
  });
  it("accepts allowed kinds and rejects wrong ones", () => {
    expect(validateUpload("RESUME", pdf)).toEqual({ ok: true, mime: "application/pdf" });
    expect(validateUpload("PORTFOLIO_IMAGE", png).ok).toBe(true);
    expect(validateUpload("PROFILE_IMAGE", pdf).ok).toBe(false);
    expect(validateUpload("RESUME", png).ok).toBe(false);
    expect(validateUpload("RESUME", exe).ok).toBe(false);
    expect(validateUpload("RESUME", Buffer.alloc(0)).ok).toBe(false);
  });
  it("enforces size limits", () => {
    expect(validateUpload("RESUME", Buffer.concat([pdf, Buffer.alloc(5 * 1024 * 1024)])).ok).toBe(false);
    expect(validateUpload("PROFILE_IMAGE", Buffer.concat([png, Buffer.alloc(3 * 1024 * 1024)])).ok).toBe(false);
  });
  it("rejects SVG/HTML disguised as images", () => {
    expect(validateUpload("PORTFOLIO_IMAGE", Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script></svg>")).ok).toBe(false);
  });
  it("sanitises filenames", () => {
    expect(sanitizeFilename("../../etc/passwd")).not.toContain("/");
    expect(sanitizeFilename("a\"b<c>.pdf")).toBe("abc.pdf");
  });
});

describe("passwords & tokens", () => {
  it("hashes and verifies", async () => {
    const h = await hashPassword("Correct-Horse-9");
    expect(h).not.toContain("Correct");
    expect(await verifyPassword("Correct-Horse-9", h)).toBe(true);
    expect(await verifyPassword("wrong-password-1", h)).toBe(false);
  });
  it("enforces password policy", () => {
    expect(passwordSchema.safeParse("short1").success).toBe(false);
    expect(passwordSchema.safeParse("alllettersnonumber").success).toBe(false);
    expect(passwordSchema.safeParse("long-enough-123").success).toBe(true);
  });
  it("generates unique tokens and stores only hashes", () => {
    const a = generateToken();
    expect(a).not.toBe(generateToken());
    expect(hashToken(a)).toHaveLength(64);
    expect(hashToken(a)).not.toContain(a);
  });
});

describe("rate limit", () => {
  it("blocks after the limit", () => {
    const key = `t-${Math.random()}`;
    for (let i = 0; i < 3; i++) expect(rateLimit(key, 3, 60_000).ok).toBe(true);
    expect(rateLimit(key, 3, 60_000).ok).toBe(false);
  });
});

describe("SSRF guard for job feeds", () => {
  it("blocks private and non-http targets", async () => {
    for (const u of ["http://localhost/feed", "http://127.0.0.1/x", "http://10.0.0.5/x", "http://192.168.1.1/x", "http://169.254.169.254/latest/meta-data", "http://[::1]/x", "ftp://example.com/x", "file:///etc/passwd"]) {
      await expect(assertPublicHttpUrl(u)).rejects.toThrow();
    }
  });
});
