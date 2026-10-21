import { PrismaClient } from "@prisma/client";
process.env.DATABASE_URL = "file:C:/Users/ander/AppData/Roaming/viral-cut-ai-desktop/app.db";
const prisma = new PrismaClient();
const v = await prisma.video.findFirst({ where: { duration: { gt: 8000 } } });
const t = await prisma.transcript.findUnique({ where: { videoId: v.id } });
const segs = await prisma.transcriptSegment.findMany({ where: { transcriptId: t.id }, orderBy: { segmentIndex: "asc" } });
console.log("video:", v.duration.toFixed(0), "s | status:", v.status);
console.log("provider:", t.provider, "| language:", t.language);
console.log("segments:", segs.length);
for (const s of segs) {
  console.log(`  [${s.startTime.toFixed(1)}-${s.endTime.toFixed(1)}] ${s.text.slice(0, 70)}`);
}
await prisma.$disconnect();
