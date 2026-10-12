import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Role, SourceType } from "@prisma/client";
import { db } from "@/lib/db";
import { ensureProfile } from "@/lib/services/profile";

// Integration tests talk to the real database (DATABASE_URL) but only ever touch rows they create themselves,
// identified by a unique per-run prefix, and delete them afterwards.

export const RUN = `it${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
export const STORAGE = mkdtempSync(path.join(tmpdir(), "careerpoint-test-"));
process.env.STORAGE_DIR = STORAGE;

const createdUsers: string[] = [];
const createdCompanies: string[] = [];
const createdSources: string[] = [];

export async function makeUser(label: string, role: Role = "CANDIDATE", opts: { profile?: boolean } = {}) {
  const user = await db.user.create({ data: { email: `${RUN}.${label}@test.local`, name: `Test ${label}`, passwordHash: "x", role, emailVerifiedAt: new Date() } });
  createdUsers.push(user.id);
  const profile = opts.profile === false ? null : await ensureProfile(user);
  return { user, profile: profile! };
}

export async function makeEmployer(label: string, verified: boolean) {
  const { user } = await makeUser(label, "EMPLOYER_ADMIN", { profile: false });
  const company = await db.company.create({ data: { name: `${RUN} ${label}`, slug: `${RUN}-${label}`, verified } });
  createdCompanies.push(company.id);
  await db.employerUser.create({ data: { userId: user.id, companyId: company.id, role: "EMPLOYER_ADMIN" } });
  const full = await db.user.findUniqueOrThrow({ where: { id: user.id }, include: { employerUsers: { include: { company: true } } } });
  return { user: full, company };
}

export async function makeSource(type: SourceType, config: Record<string, unknown>, opts: { reliability?: number; url?: string; name?: string; expireAfterDays?: number } = {}) {
  const s = await db.jobSource.create({ data: { name: opts.name ?? `${RUN} ${type}`, type, config: config as never, url: opts.url ?? null, reliability: opts.reliability ?? 90, minIntervalMs: 0, expireAfterDays: opts.expireAfterDays ?? 4 } });
  createdSources.push(s.id);
  return s;
}

export const asViewer = async (userId: string) => db.user.findUniqueOrThrow({ where: { id: userId }, include: { employerUsers: { include: { company: true } } } });

export async function cleanup() {
  await db.job.deleteMany({ where: { OR: [{ companyId: { in: createdCompanies } }, { sourceId: { in: createdSources } }, { companyName: { contains: RUN } }] } });
  await db.jobSource.deleteMany({ where: { id: { in: createdSources } } });
  await db.queueJob.deleteMany({ where: { queue: { startsWith: `test.${RUN}` } } });
  await db.user.deleteMany({ where: { id: { in: createdUsers } } });
  await db.company.deleteMany({ where: { id: { in: createdCompanies } } });
  rmSync(STORAGE, { recursive: true, force: true });
}

export const txtFile = (name: string, body: string) => new File([body], name, { type: "text/plain" });

export { SAMPLE } from "../sample";
