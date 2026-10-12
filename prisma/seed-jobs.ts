import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const jobs = [
    {
      title: 'Senior BIM Manager',
      slug: 'senior-bim-manager-1',
      companyName: 'Global Architects Inc.',
      description: 'We are looking for a Senior BIM Manager to lead our digital delivery team. You will be responsible for implementing BIM standards, managing clash detection, and ensuring high-quality model delivery.',
      status: 'ACTIVE',
      bimRole: 'BIM Manager',
      city: 'New York',
      country: 'USA',
      remote: false,
      skills: ['Revit', 'Navisworks', 'BIM 360', 'Leadership'],
    },
    {
      title: 'BIM Coordinator - Infrastructure',
      slug: 'bim-coordinator-infra-1',
      companyName: 'BuildRight Construction',
      description: 'Join our infrastructure team as a BIM Coordinator. Your primary focus will be multidisciplinary model coordination, running clash reports in Navisworks, and assisting with the BIM Execution Plan.',
      status: 'ACTIVE',
      bimRole: 'BIM Coordinator',
      city: 'London',
      country: 'UK',
      remote: true,
      skills: ['Navisworks', 'Civil 3D', 'Clash Detection', 'Coordination'],
    },
    {
      title: 'Revit Modeler / Architectural Draftsperson',
      slug: 'revit-modeler-arch-1',
      companyName: 'Design Studio LLC',
      description: 'We need an experienced Revit Modeler to create high LOD 3D models for commercial projects. Must have strong family creation skills and attention to detail.',
      status: 'ACTIVE',
      bimRole: 'Revit Modeler',
      city: 'Toronto',
      country: 'Canada',
      remote: true,
      skills: ['Revit Architecture', 'Family Creation', 'Drafting'],
    }
  ];

  for (const job of jobs) {
    await prisma.job.upsert({
      where: { slug: job.slug },
      update: job,
      create: job,
    });
    console.log(`Upserted job: ${job.title}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
