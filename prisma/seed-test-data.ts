import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

async function main() {
  console.log("Seeding test data for resumes, jobs, and profiles...");
  const passwordHash = await bcrypt.hash("password123", 10);

  // 1. Seed 5 Companies
  const companies = [];
  for (let i = 1; i <= 5; i++) {
    const company = await db.company.upsert({
      where: { slug: `company-${i}` },
      update: {},
      create: {
        name: `BIM Tech Company ${i}`,
        slug: `company-${i}`,
        location: 'New York, NY',
        verified: true,
      },
    });
    companies.push(company);
  }
  console.log("Seeded 5 Companies");

  // 2. Seed 5 Jobs
  const roles = ["BIM Manager", "BIM Coordinator", "Revit Modeler", "VDC Engineer", "BIM Technician"];
  const jobs = [];
  for (let i = 0; i < 5; i++) {
    const job = await db.job.upsert({
      where: { slug: `test-job-${i}` },
      update: { 
        qualityScore: 100,
        software: ["Revit", "Navisworks", "AutoCAD", "BIM 360", "Dynamo"],
        skills: ["Clash Detection", "BIM Coordination", "Parametric Modeling", "LOD 400", "COBie"]
      },
      create: {
        title: roles[i],
        slug: `test-job-${i}`,
        companyId: companies[i].id,
        companyName: companies[i].name,
        description: `This is a test job description for ${roles[i]}.`,
        bimRole: roles[i],
        status: "ACTIVE",
        qualityScore: 100,
        software: ["Revit", "Navisworks", "AutoCAD", "BIM 360", "Dynamo"],
        skills: ["Clash Detection", "BIM Coordination", "Parametric Modeling", "LOD 400", "COBie"],
      }
    });
    jobs.push(job);
  }
  console.log("Seeded 5 Jobs");

  // 3. Seed 5 Candidate Users with Profiles and Resumes
  for (let i = 1; i <= 5; i++) {
    const user = await db.user.upsert({
      where: { email: `candidate${i}@careerpoint.local` },
      update: {},
      create: {
        email: `candidate${i}@careerpoint.local`,
        name: `Test Candidate ${i}`,
        passwordHash,
        role: "CANDIDATE",
        emailVerifiedAt: new Date(),
      },
    });

    const profile = await db.bIMProfessionalProfile.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        userId: user.id,
        slug: `test-candidate-${i}`,
        headline: `${roles[i-1]} Professional`,
        summary: "An experienced BIM professional looking for new opportunities.",
        yearsExperience: i * 2,
        discipline: "Architecture",
      }
    });

    // Clean up old test resumes
    await db.resume.deleteMany({ where: { profileId: profile.id } });

    // Seed 1 Base Resume per Candidate
    const resume = await db.resume.create({
      data: {
        profileId: profile.id,
        title: `Base Resume - ${user.name}`,
        targetRole: roles[i-1],
        versions: {
          create: {
            version: 1,
            source: "MANUAL",
            content: {
              name: user.name,
              email: user.email,
              summary: profile.summary,
              experiences: [
                {
                  company: `Previous Company ${i}`,
                  title: roles[i-1],
                  description: "Managed BIM models and workflows.\nCoordinated with multiple disciplines.",
                  startDate: "2020-01"
                }
              ],
              software: ["Revit", "Navisworks"],
              skills: ["BIM Coordination"],
              certifications: [],
              educations: [],
              projects: [],
              links: [],
              languages: []
            }
          }
        }
      }
    });
    console.log(`Seeded User candidate${i}@careerpoint.local with profile and resume ${resume.id}`);
  }

  console.log("Test data seeding completed successfully!");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
}).finally(() => db.$disconnect());
