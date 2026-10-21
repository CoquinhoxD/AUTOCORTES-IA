const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({ datasources: { db: { url: 'file:C:/Users/ander/AppData/Local/Temp/vca-p0/app.db' } } });
async function main() {
  const ar = await prisma.analysisResult.findFirst({ orderBy: { createdAt: 'desc' } });
  console.log('rejected raw:', ar.rejected);
  console.log('rejected parsed:', JSON.parse(ar.rejected));
  const cuts = await prisma.cut.findMany({ orderBy: { rank: 'asc' } });
  console.log('cuts count:', cuts.length);
}
main().catch(e => console.error(e)).finally(() => prisma.$disconnect());
