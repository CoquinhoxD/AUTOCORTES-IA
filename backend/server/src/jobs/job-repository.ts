import type { VideoJobStatus, VideoProcessingJob } from '../types/job.js';
import type { JobRepository } from './job-queue.js';
import { prisma as defaultPrisma } from '../lib/prisma.js';
import { getStepDefinition } from '../types/job.js';

interface JobRow {
  id: string;
  videoId: string;
  status: string;
  progress: number;
  currentStep: string | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function mapRow(row: JobRow): VideoProcessingJob {
  return {
    id: row.id,
    videoId: row.videoId,
    status: row.status as VideoJobStatus,
    progress: row.progress,
    currentStep: row.currentStep,
    error: row.error,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const isTestDb = (): boolean => process.env.NODE_ENV === 'test';

let mockJobs = new Map<string, VideoProcessingJob>();

/**
 * Repositório de jobs backed pelo Prisma em desenvolvimento/produção.
 * Em testes (NODE_ENV=test), usa um Map em memória para não tocar no SQLite.
 */
export class PrismaJobRepository implements JobRepository {
  private prisma: any;

  constructor(prisma?: any) {
    if (isTestDb()) {
      this.prisma = null;
      return;
    }
    if (prisma) {
      this.prisma = prisma;
    } else {
      this.prisma = defaultPrisma;
    }
  }

  async create(job: { videoId: string }): Promise<VideoProcessingJob> {
    const now = new Date();

    if (this.prisma === null) {
      const created: VideoProcessingJob = {
        id: `job_${job.videoId}`,
        videoId: job.videoId,
        status: 'QUEUED',
        progress: 0,
        currentStep: null,
        error: null,
        createdAt: now,
        updatedAt: now,
      };
      mockJobs.set(job.videoId, created);
      return created;
    }

    const row = await this.prisma.job.create({
      data: { videoId: job.videoId, status: 'QUEUED', progress: 0 },
    });

    return mapRow(row);
  }

  async updateStatus(videoId: string, status: VideoJobStatus, error?: string | null): Promise<void> {
    const step = getStepDefinition(status);

    if (this.prisma === null) {
      const existing = mockJobs.get(videoId);
      if (existing) {
        existing.status = status;
        existing.progress = step.progress;
        existing.currentStep = status;
        existing.error = error ?? null;
        existing.updatedAt = new Date();
        mockJobs.set(videoId, existing);
      }
      return;
    }

    await this.prisma.job.update({
      where: { videoId },
      data: {
        status,
        progress: step.progress,
        currentStep: status,
        ...(error !== undefined ? { error } : {}),
      },
    });
  }

  async findByVideoId(videoId: string): Promise<VideoProcessingJob | null> {
    if (this.prisma === null) {
      return mockJobs.get(videoId) ?? null;
    }

    const row = await this.prisma.job.findUnique({ where: { videoId } });
    return row ? mapRow(row) : null;
  }

  async list(limit = 50): Promise<VideoProcessingJob[]> {
    if (this.prisma === null) {
      return Array.from(mockJobs.values()).slice(0, limit);
    }

    const rows = await this.prisma.job.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return rows.map(mapRow);
  }
}
