import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

async function main() {
  const templatesPath = path.join(__dirname, 'templates.json');
  const templatesData = fs.readFileSync(templatesPath, 'utf-8');
  const templates = JSON.parse(templatesData);

  for (const template of templates) {
    await prisma.roleTemplate.upsert({
      where: { roleName: template.roleName },
      update: template,
      create: template,
    });
    console.log(`Upserted template for ${template.roleName} with ${template.bulletTemplates.length} bullets`);
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
