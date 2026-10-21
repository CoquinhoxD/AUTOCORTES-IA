const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe("ALTER TABLE AnalysisResult ADD COLUMN rejected TEXT DEFAULT '[]'");
  console.log('column added');
  const cols = await prisma.$queryRawUnsafe("PRAGMA table_info(AnalysisResult)");
  console.log(cols);
}

main().catch(e => console.error(e)).finally(() => prisma.$disconnect());