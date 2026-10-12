/* Seed: bootstrap admin (always) + optional demo employer account (dev only; no fake jobs are ever created).
 *   npm run db:seed                 → admin only
 *   SEED_DEMO=1 npm run db:seed     → admin + a verified demo employer account (never use in production)
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

async function main() {
  const email = (process.env.SEED_ADMIN_EMAIL ?? "admin@careerpoint.local").toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password || password.length < 10) throw new Error("Set SEED_ADMIN_PASSWORD (10+ characters) before seeding.");
  if (process.env.NODE_ENV === "production" && password === "ChangeMe-Admin-123") throw new Error("Refusing to seed the example admin password in production.");

  const passwordHash = await bcrypt.hash(password, 12);
  await db.user.upsert({
    where: { email },
    update: {},
    create: { email, name: "CareerPoint Admin", passwordHash, role: "ADMIN", emailVerifiedAt: new Date() },
  });
  console.log(`Admin ready: ${email}`);

  if (process.env.SEED_DEMO !== "1") return;
  if (process.env.NODE_ENV === "production") throw new Error("SEED_DEMO is not allowed in production.");

  const owner = await db.user.upsert({
    where: { email: "employer@careerpoint.local" },
    update: {},
    create: { email: "employer@careerpoint.local", name: "Demo Employer", passwordHash, role: "EMPLOYER_ADMIN", emailVerifiedAt: new Date() },
  });
  const company = await db.company.upsert({
    where: { slug: "demo-aec-studio" },
    update: {},
    create: { name: "Demo AEC Studio", slug: "demo-aec-studio", website: "https://example.com", location: "London, UK", description: "Demo employer account created by the development seed.", verified: true },
  });
  await db.employerUser.upsert({ where: { userId_companyId: { userId: owner.id, companyId: company.id } }, update: {}, create: { userId: owner.id, companyId: company.id, role: "EMPLOYER_ADMIN" } });

  console.log("Demo employer: employer@careerpoint.local (same password as admin), verified, with no jobs — post real ones from /employer/jobs/new.");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
