# Viral Cut AI

Ferramenta que encontra automaticamente os melhores cortes virais em vídeos longos.

```
UPLOAD → FFMPEG → ÁUDIO → WHISPER → TRANSCRIÇÃO (timestamps) → ANÁLISE IA → 20 CORTES → PLAYER
```

---

## Índice

1. [Requisitos](#1-requisitos)
2. [Instalação do FFmpeg no Windows](#2-instalação-do-ffmpeg-no-windows)
3. [Configuração do `.env`](#3-configuração-do-env)
4. [Instalação das dependências](#4-instalação-das-dependências)
5. [Banco de dados](#5-banco-de-dados)
6. [Como iniciar](#6-como-iniciar)
7. [Como usar](#7-como-usar)
8. [Como testar](#8-como-testar)
9. [Diagnóstico](#9-diagnóstico)
10. [Scripts disponíveis](#10-scripts-disponíveis)
11. [API](#11-api)
12. [Arquitetura](#12-arquitetura)
13. [Solução de problemas](#13-solução-de-problemas)
14. [Roadmap](#14-roadmap)

---

## 1. Requisitos

| Item | Versão | Obrigatório |
|------|--------|-------------|
| Node.js | ≥ 18.20 | Sim |
| npm | ≥ 9 | Sim |
| FFmpeg + FFprobe | recente | Sim |
| Chave de API (Groq ou OpenAI) | — | Para análise real |

---

## 2. Instalação do FFmpeg no Windows

O FFmpeg é **obrigatório** — o backend não sobe sem ele. Os erros são explícitos, nunca escondidos.

### Opção A — Chocolatey (recomendado)

Abra o PowerShell como administrador:

```powershell
choco install ffmpeg
```

### Opção B — Scoop

```powershell
scoop install ffmpeg
```

### Opção C — Manual

1. Baixe em <https://ffmpeg.org/download.html> (ou <https://www.gyan.dev/ffmpeg/builds/> no Windows)
2. Extraia para um local permanente, ex.: `C:\ffmpeg`
3. Adicione `C:\ffmpeg\bin` ao PATH do sistema:
   - `Win + R` → digite `sysdm.cpl` → **Avançado** → **Variáveis de Ambiente**
   - Em *Variáveis do Sistema*, edite **Path** → **Novo** → `C:\ffmpeg\bin`
4. **Feche e abra o terminal novamente**

### Verificando a instalação

```powershell
ffmpeg -version
ffprobe -version
```

Ambos devem mostrar a versão.

### Linux / macOS

```bash
# Ubuntu / Debian
sudo apt update && sudo apt install -y ffmpeg

# macOS
brew install ffmpeg
```

---

## 3. Configuração do `.env`

```powershell
copy backend\.env.example backend\.env
```

> No PowerShell use `copy`. No CMD/bash use `cp`.

Edite `backend/.env`:

```env
# ---------- Banco de dados ----------
DATABASE_URL="file:./dev.db"

# ---------- Análise com IA ----------
AI_API_KEY=
AI_MODEL=
AI_PROVIDER=groq

# ---------- Transcrição (Whisper) ----------
TRANSCRIPTION_PROVIDER=groq
TRANSCRIPTION_API_KEY=
TRANSCRIPTION_MODEL=whisper-large-v3

# ---------- Upload ----------
MAX_VIDEO_SIZE_MB=5120

# ---------- Servidor ----------
PORT=3000
HOST=0.0.0.0
LOG_LEVEL=info
```

### Onde obter as chaves

| Serviço | Link | Preço |
|---------|------|-------|
| **Groq** (IA + Whisper) | <https://console.groq.com/keys> | Gratuito |
| **OpenAI** | <https://platform.openai.com/api-keys> | Pago |
| Together AI | <https://api.together.xyz/settings/api-keys> | Pago |
| OpenRouter | <https://openrouter.ai/keys> | Varia |

**Groq é a melhor opção para começar**: mesma chave serve para análise e transcrição, e tem plano gratuito.

### Modelos por provider

**Groq** — consulte os disponíveis em <https://console.groq.com/docs/models>:

```env
AI_PROVIDER=groq
AI_MODEL=openai/gpt-oss-120b
```

**OpenAI**:

```env
AI_PROVIDER=openai
AI_MODEL=gpt-4o
```

> O modelo **nunca** é fixo no código. Sempre vem de `AI_MODEL`.

### Transcrição local (sem limite de tamanho)

Para vídeos muito longos, a API tem limite de payload (25 MB no Groq). O sistema já divide o áudio automaticamente, mas para uso illimitado:

```env
TRANSCRIPTION_PROVIDER=local
```

Instale o [whisper.cpp](https://github.com/ggerganov/whisper.cpp) ou `faster-whisper` e garanta que o binário esteja no PATH.

---

## 4. Instalação das dependências

```powershell
npm install
```

Instala a raiz (orquestrador), o backend e o frontend de uma vez.

Instalação manual, se preferir:

```powershell
npm install --prefix backend
npm install --prefix frontend
```

---

## 5. Banco de dados

SQLite via Prisma. Criado automaticamente:

```powershell
npm run prisma:setup
```

Equivale a `prisma db push && prisma generate`.

Para inspecionar os dados:

```powershell
npm run prisma:studio --prefix backend
```

Para começar do zero (apaga todos os dados):

```powershell
npm run prisma:reset --prefix backend
```

### Tabelas

| Tabela | Descrição |
|--------|-----------|
| `videos` | Vídeo original + metadados + status |
| `jobs` | Fila de processamento com progresso |
| `transcripts` | Texto completo da transcrição |
| `transcript_segments` | Segmentos individuais com timestamps |
| `cuts` | Cortes com scores, headlines e ranking |
| `analysis_results` | Polêmicas, TOP 5 e avisos |

---

## 6. Como iniciar

### Desenvolvimento (frontend + backend)

```powershell
npm run dev
```

Sobe simultaneamente:

- **API** → <http://localhost:3000>
- **Web** → <http://localhost:5173>

Para iniciar separadamente:

```powershell
npm run dev:backend
npm run dev:frontend
```

### Produção

```powershell
npm run build
npm start
```

O backend serve a API em `:3000` e os arquivos estáticos do frontend em `frontend/dist` (configure o servidor web para isso).

---

## 7. Como usar

1. Abra <http://localhost:5173>
2. Arraste o vídeo ou clique em **SELECIONAR VÍDEO**
3. Clique em **ANALISAR VÍDEO**
4. Acompanhe o progresso em tempo real
5. Ao concluir, veja os 20 cortes com ranking, scores e headlines
6. Clique em um corte para reproduzir **exatamente** aquele trecho
7. Na aba **Transcrição**, clique em qualquer segmento para pular ao timestamp

Formatos aceitos: `.mp4`, `.mov`, `.webm`, `.mkv`

---

## 8. Como testar

```powershell
npm test
```

Ou separado:

```powershell
npm run test:backend
npm run test:frontend
```

Cobre:

| Área | Testes |
|------|--------|
| Duração de cortes | `computeDuration` |
| Validação de timestamps | `start >= 0`, `end > start`, `end <= duração` |
| Anti-alucinação | timestamp deve existir na transcrição |
| Corte duplicado | detecção de sobreposição > 60% |
| Ranking global | exatamente 20, nunca 20-por-bloco |
| Validação de JSON da IA | Zod + segunda tentativa |
| Estados do job | transições válidas e terminais |
| Criação de job | fila em memória |
| Normalização | vazios, espaços, ordem cronológica |
| Chunking | offsets e remoção de duplicatas |
| **Integração** | upload real → ffprobe → ffmpeg → stream → validação |

---

## 9. Diagnóstico

```powershell
npm run doctor
```

Verifica e reporta:

```
Runtime
  ✓ Node v20.x
  ✓ npm 10.x

FFmpeg
  ✓ ffmpeg 6.1
  ✓ ffprobe 6.1

Banco de dados
  ✓ DATABASE_URL file:./dev.db
  ✓ banco SQLite backend\prisma\dev.db (108 KB)
  ✓ Prisma Client gerado

Análise com IA
  ✓ AI_API_KEY gsk_RD…MtdH
  ✓ modelo openai/gpt-oss-120b respondeu com sucesso

Transcrição (Whisper)
  ✓ TRANSCRIPTION_API_KEY gsk_RD…MtdH
  ✓ provider groq · modelo whisper-large-v3
```

O comando faz uma **chamada real** à API para validar a chave e o modelo. Nenhuma chave é exibida por completo e nenhuma é gravada em log.

---

## 10. Scripts disponíveis

### Raiz

| Script | Descrição |
|--------|-----------|
| `npm run dev` | Backend + frontend juntos |
| `npm run dev:backend` | Só a API |
| `npm run dev:frontend` | Só o frontend |
| `npm run build` | Compila ambos |
| `npm start` | Executa o backend compilado |
| `npm test` | Todos os testes |
| `npm run doctor` | Diagnóstico completo |
| `npm run prisma:setup` | Cria o banco e gera o client |
| `npm run clean` | Remove builds e temporários (preserva vídeos) |

### Backend (`--prefix backend`)

| Script | Descrição |
|--------|-----------|
| `npm run dev --prefix backend` | API com watch |
| `npm run build --prefix backend` | Compila TypeScript |
| `npm run typecheck --prefix backend` | Verifica tipos sem emitir |
| `npm run test --prefix backend` | Testes |
| `npm run doctor --prefix backend` | Diagnóstico |
| `npm run prisma:studio --prefix backend` | Prisma Studio |
| `npm run prisma:reset --prefix backend` | Reseta o banco |

### Frontend (`--prefix frontend`)

| Script | Descrição |
|--------|-----------|
| `npm run dev --prefix frontend` | Vite dev server |
| `npm run build --prefix frontend` | Build de produção |
| `npm run test --prefix frontend` | Testes |

---

## 11. API

Base: `http://localhost:3000`

### `POST /api/videos`

Envia um vídeo (multipart, campo `file`).

```bash
curl -X POST -F "file=@video.mp4" http://localhost:3000/api/videos
```

```json
{ "videoId": "abc-123", "status": "QUEUED" }
```

Resposta `202`. O processamento segue em background.

### `GET /api/videos/:id/status`

```json
{
  "status": "TRANSCRIBING",
  "progress": 50,
  "message": "Gerando transcrição...",
  "error": null
}
```

### `GET /api/videos/:id/result`

```json
{
  "video": {
    "id": "abc-123",
    "originalName": "podcast.mp4",
    "duration": 3600,
    "width": 1920,
    "height": 1080,
    "fps": 30,
    "streamUrl": "/api/videos/abc-123/stream"
  },
  "cuts": [ { "rank": 1, "startTime": 125.4, "endTime": 187.2, "...": "..." } ],
  "controversies": ["..."],
  "top5": [1, 2, 3, 4, 5],
  "requestedCuts": 20,
  "generatedCuts": 20,
  "notice": null
}
```

Quando o conteúdo não tem material para 20 cortes, `generatedCuts` é menor e `notice` explica. **Cortes nunca são inventados.**

### `GET /api/videos/:id/transcript`

```json
{
  "language": "pt",
  "provider": "groq",
  "fullText": "...",
  "segments": [{ "id": "...", "start": 0, "end": 4.25, "text": "..." }]
}
```

### `GET /api/videos/:id/stream`

Vídeo original com suporte a **Range requests** (o player pula direto para o corte).

### `GET /api/videos`

Histórico com TOP 1 e potencial de cada vídeo.

### `GET /api/health`

```json
{ "status": "ok", "storage": "...", "maxVideoSizeMb": 5120 }
```

---

## 12. Arquitetura

```
viral-cut-ai/
├── frontend/                    React + TypeScript + Vite + Tailwind
│   └── src/
│       ├── components/          UploadPage, VideoClipPlayer, CutCard,
│       │                        CutsRanking, TranscriptViewer,
│       │                        ProcessingProgress
│       ├── pages/               AnalysisPage, HistoryPage
│       ├── hooks/               usePolling
│       ├── services/            api
│       ├── types/               tipos espelhando o backend
│       └── utils/               format, validation
│
├── backend/                     Node.js + Fastify + TypeScript
│   ├── prisma/
│   │   └── schema.prisma        videos, jobs, transcripts,
│   │                            transcript_segments, cuts,
│   │                            analysis_results
│   ├── scripts/
│   │   └── doctor.js            diagnóstico completo
│   └── server/src/
│       ├── config/paths.ts      caminhos centralizados
│       ├── routes/videos.ts     API + pipeline de processamento
│       ├── services/
│       │   ├── fmpeg.service            ffprobe, extração, cortes
│       │   ├── transcription.service    providers (Groq/OpenAI/local)
│       │   ├── transcription-pipeline    chunking + mesclagem
│       │   ├── transcript-normalizer     limpeza + diagnósticos
│       │   ├── ai-analysis.service      LLM + retry de JSON
│       │   ├── ai-analysis.schema       schemas Zod
│       │   ├── cut-validation.service   schema dos cortes
│       │   └── cut-validator.service    anti-alucinação + ranking
│       ├── jobs/
│       │   ├── job-queue.ts             fila (interface pronta p/ BullMQ)
│       │   └── job-repository.ts        persistência dos jobs
│       ├── prompts/
│       │   └── cut-analysis.prompt.ts   prompt da IA
│       ├── types/                job, ffmpeg, dto
│       ├── lib/prisma.ts
│       └── index.ts
│
├── storage/                     uploads, audio, temp, results
├── scripts/clean.js             limpeza segura
└── package.json                 orquestrador
```

### Estados do job

```
QUEUED (0%)
  → PROCESSING_VIDEO (10%)
  → EXTRACTING_AUDIO (30%)
  → TRANSCRIBING (50%)
  → ANALYZING (70%)
  → GENERATING_CUTS (90%)
  → COMPLETED (100%)
```

Qualquer etapa pode ir para `FAILED`, com a causa explícita.

### Segurança contra alucinação

O backend **nunca salva** timestamps inventados. Antes de persistir:

| Regra | Implementação |
|-------|---------------|
| `startTime >= 0` | rejeitado |
| `endTime > startTime` | rejeitado |
| `endTime <= duração do vídeo` | rejeitado |
| `duration = endTime - startTime` | **recalculado**, nunca aceito da IA |
| timestamp existe na transcrição | verificado com tolerância de 1,5 s |
| duração entre 5 s e 180 s | rejeitado fora da faixa |
| sem duplicatas (> 60% sobreposição) | removido |
| schema Zod na saída | validação final obrigatória |

Cortes reprovados são registrados com o motivo. Se o material não permitir 20 cortes, o sistema retorna menos e **informa claramente** — nunca inventa.

### Fila de processamento

`InMemoryJobQueue` implementa o contrato que o BullMQ usará. Para migrar:

```ts
import { Queue } from 'bullmq';
const queue = new Queue(buildQueueName(), {
  connection: { url: process.env.REDIS_URL },
});

await queue.add(buildJobName(videoId), { videoId }, {
  jobId: buildJobId(videoId),
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: 100,
});
```

Os serviços de transcrição e análise não mudam.

### Progresso em tempo real

Hoje: **polling** a cada 2 s (`usePolling`). O hook já expõe `{ data, error, loading, refetch }` — trocar por SSE ou WebSocket significa só reimplementar o hook, sem tocar nos componentes.

---

## 13. Solução de problemas

### `FFmpeg ou ffprobe não encontrado`

```
[FFMPEG] Instale o FFmpeg: https://ffmpeg.org/download.html
```

Instale e adicione `bin` ao PATH. Feche e abra o terminal.

### `O modelo X não existe neste provider`

O `npm run doctor` lista os modelos disponíveis. Ajuste `AI_MODEL` no `.env`.

Exemplo Groq: `openai/gpt-oss-120b`, `qwen/qwen3.8-27b`, `whisper-large-v3`.

### `Configure sua API de IA para realizar a análise.`

`AI_API_KEY` ausente, vazia ou ainda com o placeholder. O app **sobe normalmente** — só falha ao analisar.

### `Configure sua API de transcrição...`

`TRANSCRIPTION_API_KEY` ausente ou `TRANSCRIPTION_PROVIDER` sem correspondência. Use `groq`, `openai` ou `local`.

### `Transcrição inválida ou vazia`

O vídeo não tem áudio audível, ou a transcrição retornou velocidade de fala implausível. Verifique se o áudio original é claro.

### Arquivo maior que o limite

```env
MAX_VIDEO_SIZE_MB=10240   # 10 GB
```

Reinicie o backend. Erro explícito: `FST_REQ_FILE_TOO_LARGE` vira `413` com a mensagem em português.

### Upload lento com vídeos grandes

- Use disco SSD
- Feche outros programas pesados
- O upload é por stream — o arquivo nunca é carregado inteiro na memória

### Transcrição falha em vídeos > 2 h

O chunking já divide o áudio (10 min por chunk, 2 s de sobreposição). Se ainda falhar, use `TRANSCRIPTION_PROVIDER=local`.

### Erro de porta em uso

```powershell
# Matar processo na 3000 (Windows)
Get-NetTCPConnection -LocalPort 3000 | ForEach-Object {
  Stop-Process -Id $_.OwningProcess -Force
}
```

### Limpar tudo e recomeçar

```powershell
npm run clean
npm run prisma:reset
```

---

## 14. Roadmap

A arquitetura já está preparada para:

- **Fase 2** — corte automático definitivo (`ffmpegCutClip` já existe no serviço)
- **Fase 3** — editor de vídeo com timeline
- **Fase 4** — legendas estilizadas
- **Fase 5** — reenquadramento automático 9:16
- **Fase 6** — tracking facial
- **Fase 7** — publicação em redes sociais
- **Fase 8** — fila BullMQ + Redis
- **Fase 9** — SSE/WebSocket no lugar do polling

---

## Licença

MIT
