# ViralCut AI - Plano de Testes Fase 1 MVP

## ✅ Funcionalidades Implementadas

### Backend (FastAPI + Python)
- [x] **Upload de vídeo** - POST `/api/videos` com multipart/form-data
- [x] **Extração de áudio** - FFmpeg para MP3 mono 16kHz
- [x] **Transcrição** - 3 provedores:
  - Groq Whisper API
  - OpenAI Whisper API
  - **Local faster-whisper (Python)** - NOVO!
  - Mock (fallback sem API key)
- [x] **Chunking de áudio** - Divide áudios >25MB ou >10min
- [x] **Análise com IA** - Map-reduce para vídeos longos
- [x] **Validação de cortes** - Anti-alucinação, timestamps reais
- [x] **Ranking viral** - Scores 0-100, top 20 cortes
- [x] **Exportação de cortes** - POST `/api/videos/:id/export-cut`
- [x] **Exportação em lote** - POST `/api/videos/:id/export-batch`
- [x] **Crop vertical 9:16** - 3 modos: center, blur, face
- [x] **Geração SRT** - POST `/api/videos/:id/generate-srt`
- [x] **Queima de legendas** - 6 estilos: viral, word, minimal, gamer, podcast, custom
- [x] **Importação SRT/VTT** - POST `/api/videos/:id/import-srt`
- [x] **Download de resultados** - GET `/api/videos/:id/download/:filename`
- [x] **Configurações persistidas** - JSON em userData (desktop) / .env (dev)
- [x] **Health check** - GET `/api/health`

### Frontend (React + TypeScript + Vite + Tailwind)
- [x] **Upload Page** - Drag & drop, validação, SRT import
- [x] **Analysis Page** - Player, ranking, transcrição, polling
- [x] **Editor Page** - Preview, ajustes de tempo, legendas, enquadramento, metadados
- [x] **History Page** - Lista de vídeos processados
- [x] **Settings Page** - API keys, modelos, parâmetros de análise
- [x] **Componentes reutilizáveis** - VideoClipPlayer, TranscriptViewer, CutCard, etc.

### Desktop (Electron)
- [x] **Processo principal** - Inicia backend embutido, janela BrowserWindow
- [x] **FFmpeg embutido** - Script fetch-ffmpeg para binários
- [x] **Banco SQLite seed** - Copia seed.db na primeira execução
- [x] **Instância única** - Single instance lock
- [x] **Build Windows** - electron-builder configurado

## 🧪 Testes Manuais Necessários

### 1. Teste Básico - Vídeo Curto (2-5 min)
```
1. Iniciar backend: npm run dev:backend
2. Iniciar frontend: npm run dev:frontend
3. Acessar http://localhost:5173
4. Upload de vídeo MP4 curto (ex: 3 min)
5. Aguardar processamento (transcrição + análise)
6. Verificar ranking de cortes na Analysis Page
7. Clicar em "Editar e Exportar"
8. No Editor, ajustar início/fim de um corte
9. Exportar corte único (vertical + legendas)
10. Verificar download do MP4
```

### 2. Teste Local faster-whisper
```
1. Configurar TRANSCRIPTION_PROVIDER=local no .env ou Settings
2. Upload de vídeo com áudio em português
3. Verificar logs: [WHISPER] Iniciando transcrição local (faster-whisper)
4. Confirmar transcrição real (não mock)
```

### 3. Teste Importação SRT
```
1. Na Upload Page, selecionar vídeo + arquivo .srt
2. Clicar "Importar vídeo + legenda"
3. Verificar que pula transcrição e vai direto para análise
```

### 4. Teste Exportação em Lote
```
1. No Editor, clicar "Exportar todos (N)"
2. Aguardar processamento
3. Verificar arquivos em storage/results/
```

### 5. Teste Desktop (Electron)
```
1. cd desktop && npm run build
2. cd desktop && npm run dist
3. Instalar .exe gerado
4. Testar fluxo completo no app instalado
```

## ⚠️ Pendências Conhecidas

1. **Face tracking real** - Atualmente usa crop central como fallback. Requer modelo DNN do OpenCV.
2. **Word-level highlighting** - Estilo "word" usa mesmo SRT do "viral". Precisa de timestamps por palavra.
3. **Reprocessamento de corte único** - Botão "Gerar novamente" não implementado no Editor.
4. **Validação de espaço em disco** - Não implementada antes de exportar.
5. **Cancelamento de job** - Backend tem job queue mas cancelamento não exposto na API.
6. **Retomada após falha** - Pipeline não salva checkpoints intermediários.

## 📋 Checklist de Validação Fase 1

- [ ] Build backend sem erros TypeScript
- [ ] Build frontend sem erros TypeScript
- [ ] Build desktop (electron-builder) gera .exe
- [ ] Teste com vídeo 10+ min (chunking)
- [ ] Teste com vídeo 2+ horas (map-reduce IA)
- [ ] Teste faster-whisper local (GPU se disponível)
- [ ] Teste fallback CPU (sem CUDA)
- [ ] Teste todos estilos de legenda
- [ ] Teste todos modos de enquadramento
- [ ] Teste importação SRT/VTT
- [ ] Verificar logs estruturados no console
- [ ] Verificar limpeza de arquivos temporários

## 🚀 Próximos Passos (Fase 2)

1. Editor de timeline visual (arrastar bordas do corte)
2. Face tracking com OpenCV DNN
3. Word-level subtitle animation
4. Processamento em lote (múltiplos vídeos)
5. Integração com APIs de upload (TikTok, YouTube, Instagram)
6. Aprendizado com feedback do usuário (thumbs up/down nos cortes)