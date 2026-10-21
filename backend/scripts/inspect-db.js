/**
 * Sonda de diagnóstico: mostra, por vídeo, o alcance real da transcrição
 * (primeiro/último segmento) e quantos cortes sobreviveram à validação.
 *
 * Uso: node scripts/inspect-db.js [caminho/do/banco.db]
 */
import { PrismaClient } from '@prisma/client';
import path from 'node:path';

const db = path.resolve(process.argv[2] ?? './prisma/dev.db');
process.env.DATABASE_URL = `file:${db.replace(/\\/g, '/')}`;

const prisma = new PrismaClient();

const videos = await prisma.video.findMany({
  orderBy: { createdAt: 'desc' },
  take: 12,
});

console.log(`banco: ${db}\n`);

for (const video of videos) {
  const transcript = await prisma.transcript.findUnique({
    where: { videoId: video.id },
  });

  const segs = transcript
    ? await prisma.transcriptSegment.findMany({
        where: { transcriptId: transcript.id },
        orderBy: { segmentIndex: 'asc' },
      })
    : [];

  const cuts = await prisma.cut.findMany({
    where: { videoId: video.id },
    orderBy: { rank: 'asc' },
  });

  const first = segs[0] ?? null;
  const last = segs.length > 0 ? segs[segs.length - 1] : null;

  let maxGap = 0;
  for (let i = 1; i < segs.length; i++) {
    const gap = segs[i].startTime - segs[i - 1].endTime;
    if (gap > maxGap) maxGap = gap;
  }

  const span =
    first && last ? `${first.startTime.toFixed(1)}s -> ${last.endTime.toFixed(1)}s` : '-';

  console.log(
    `${video.status.padEnd(13)} ${video.duration.toFixed(0).padStart(6)}s  ${video.originalName
      .slice(0, 44)
      .padEnd(44)}`
  );
  console.log(
    `   transcricao: ${transcript ? `${segs.length} segs, ` : 'NENHUM, '}${span}` +
      `  maior lacuna: ${maxGap.toFixed(1)}s`
  );
  console.log(`   cortes salvos: ${cuts.length}`);
  for (const c of cuts.slice(0, 5)) {
    console.log(
      `     #${c.rank} [${c.startTime.toFixed(1)}-${c.endTime.toFixed(1)}s] viral=${c.viralPotential} ${c.theme.slice(0, 44)}`
    );
  }
  console.log();
}

await prisma.$disconnect();