import { describe, it, expect } from '@jest/globals';
import {
  JOB_STEPS,
  getStepDefinition,
  canTransition,
  isTerminalStatus,
  buildProgressUpdate,
  buildJobId,
  buildQueueName,
  contentHash,
  VALID_TRANSITIONS,
  type VideoJobStatus,
} from '../server/src/types/job.js';

describe('estados do job', () => {
  it('define todos os estados exigidos', () => {
    const statuses = JOB_STEPS.map((s) => s.status);

    expect(statuses).toContain('QUEUED');
    expect(statuses).toContain('PROCESSING_VIDEO');
    expect(statuses).toContain('EXTRACTING_AUDIO');
    expect(statuses).toContain('TRANSCRIBING');
    expect(statuses).toContain('ANALYZING');
    expect(statuses).toContain('GENERATING_CUTS');
    expect(statuses).toContain('COMPLETED');
  });

  it('cada estado possui percentual', () => {
    for (const step of JOB_STEPS) {
      expect(step.progress).toBeGreaterThanOrEqual(0);
      expect(step.progress).toBeLessThanOrEqual(100);
    }
  });

  it('cada estado possui mensagem', () => {
    for (const step of JOB_STEPS) {
      expect(step.message.length).toBeGreaterThan(0);
    }
  });

  it('percentual cresce monotonicamente', () => {
    for (let i = 1; i < JOB_STEPS.length; i++) {
      expect(JOB_STEPS[i].progress).toBeGreaterThanOrEqual(JOB_STEPS[i - 1].progress);
    }
  });

  it('COMPLETED tem 100%', () => {
    expect(getStepDefinition('COMPLETED').progress).toBe(100);
  });
});

describe('getStepDefinition', () => {
  it('retorna a mensagem correta para cada estado', () => {
    expect(getStepDefinition('TRANSCRIBING').message).toBe('Gerando transcrição...');
    expect(getStepDefinition('ANALYZING').message).toContain('IA');
  });

  it('retorna mensagem de falha para FAILED', () => {
    expect(getStepDefinition('FAILED').message).toBe('Processamento falhou');
  });
});

describe('transições de estado', () => {
  it('permite o fluxo completo feliz', () => {
    const flow: VideoJobStatus[] = [
      'QUEUED',
      'PROCESSING_VIDEO',
      'EXTRACTING_AUDIO',
      'TRANSCRIBING',
      'ANALYZING',
      'GENERATING_CUTS',
      'COMPLETED',
    ];

    for (let i = 0; i < flow.length - 1; i++) {
      expect(canTransition(flow[i], flow[i + 1])).toBe(true);
    }
  });

  it('permite falhar a partir de qualquer etapa ativa', () => {
    const active: VideoJobStatus[] = [
      'QUEUED',
      'PROCESSING_VIDEO',
      'EXTRACTING_AUDIO',
      'TRANSCRIBING',
      'ANALYZING',
      'GENERATING_CUTS',
    ];

    for (const status of active) {
      expect(canTransition(status, 'FAILED')).toBe(true);
    }
  });

  it('impede pular etapas', () => {
    expect(canTransition('QUEUED', 'COMPLETED')).toBe(false);
    expect(canTransition('TRANSCRIBING', 'GENERATING_CUTS')).toBe(false);
  });

  it('estados terminais não avançam', () => {
    expect(VALID_TRANSITIONS.COMPLETED).toHaveLength(0);
    expect(VALID_TRANSITIONS.FAILED).toHaveLength(0);
    expect(canTransition('COMPLETED', 'QUEUED')).toBe(false);
  });

  it('permite reatribuir o mesmo estado', () => {
    expect(canTransition('ANALYZING', 'ANALYZING')).toBe(true);
  });
});

describe('isTerminalStatus', () => {
  it('COMPLETED e FAILED são terminais', () => {
    expect(isTerminalStatus('COMPLETED')).toBe(true);
    expect(isTerminalStatus('FAILED')).toBe(true);
  });

  it('estados intermediários não são terminais', () => {
    expect(isTerminalStatus('QUEUED')).toBe(false);
    expect(isTerminalStatus('TRANSCRIBING')).toBe(false);
  });
});

describe('buildProgressUpdate', () => {
  it('usa a mensagem canônica quando não há customizada', () => {
    const update = buildProgressUpdate('EXTRACTING_AUDIO');
    expect(update.message).toBe('Extraindo áudio...');
    expect(update.progress).toBe(30);
  });

  it('permite mensagem customizada', () => {
    const update = buildProgressUpdate('TRANSCRIBING', 'Gerando transcrição...');
    expect(update.message).toBe('Gerando transcrição...');
  });
});

describe('identidade do job', () => {
  it('gera id determinístico para BullMQ', () => {
    expect(buildJobId('video-123')).toBe('video:video-123:1');
    expect(buildJobId('video-123', 2)).toBe('video:video-123:2');
  });

  it('usa o nome de fila configurado', () => {
    const original = process.env.JOB_QUEUE_NAME;
    process.env.JOB_QUEUE_NAME = 'minha-fila';
    expect(buildQueueName()).toBe('minha-fila');

    delete process.env.JOB_QUEUE_NAME;
    expect(buildQueueName()).toBe('viral-cut-processing');

    if (original) process.env.JOB_QUEUE_NAME = original;
  });

  it('gera hash estável do conteúdo', () => {
    expect(contentHash('abc')).toBe(contentHash('abc'));
    expect(contentHash('abc')).not.toBe(contentHash('abd'));
    expect(contentHash('abc')).toHaveLength(64);
  });
});
