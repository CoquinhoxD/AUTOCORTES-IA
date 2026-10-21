# Viral Cut AI — Desktop

Aplicativo desktop (Windows) que transforma um vídeo em cortes ranqueados por
potencial viral.

## Como funciona

O app **não depende de servidor externo**. O backend Fastify é iniciado como
processo filho dentro do próprio aplicativo e serve a API e o build do Vite na
mesma porta:

```
┌──────────────────────────────────────────┐
│  Electron (processo principal)            │
│  ├── fork → backend Fastify              │
│  │     ├── SQLite via Prisma             │
│  │     ├── FFmpeg (resources/bin)        │
│  │     └── build do React (resources/web) │
│  └── BrowserWindow → http://localhost:N   │
└──────────────────────────────────────────┘
```

Fluxo de inicialização:

1. `fork` do backend com `PORT=0` (o sistema escolhe uma porta livre)
2. Backend imprime `SERVER_READY <porta>` no stdout
3. Main process lê a porta e cria a janela apontando para ela

Duas peculiarities do Electron só aparecem na versão empacotada — ambas
tratadas em `src/main.ts`:

- **`ELECTRON_RUN_AS_NODE=1`** é obrigatório no `fork`. Sem isso o filho
  executa o binário do Electron como um app completo, perde o single-instance
  lock e encerra em silêncio, sem stderr.
- **`stdio` precisa conter `'ipc'`**. `child_process.fork` lança
  `ERR_CHILD_PROCESS_IPC_REQUIRED` se o canal não estiver lá, e isso mata o
  app na tela de splash com "Não foi possível iniciar o Viral Cut AI".
- **`DATABASE_URL` é injetada** e o `resources/backend/prisma/dev.db` (schema
  já aplicado) é copiado para `%APPDATA%\viral-cut-ai-desktop\app.db` na
  primeira execução. O app instalado não roda `prisma db push`, então sem esse
  seed o banco não teria tabelas.

## Comandos

```bash
# Desenvolvimento — app com hot reload do React (backend e frontend em watch)
npm run dev

# Só abrir o app já compilado
npm start

# Gerar o instalador .exe (NSIS)
npm run dist

# Só a pasta descompactada (teste rápido, sem instalador)
npm run dist:dir
```

### Primeira vez

```bash
npm install
npm run fetch-ffmpeg   # baixa/copia o FFmpeg para bin/
```

O `fetch-ffmpeg` primeiro procura o FFmpeg já instalado no sistema (copia dali,
~435MB sem download). Se não achar, baixa o build *essentials* (~90MB).

> **Ambiente sem internet / install pulado.** Se `npm run dev` reclamar
> `Electron failed to install correctly`, o binário do Electron não foi baixado
> para `node_modules/electron`. Basta rodá-lo:
>
> ```bash
> node node_modules/electron/install.js
> ```
>
> O `electron-builder` usa o próprio cache, então `npm run dist` funciona
> mesmo com esse passo faltando.

## Pré-requisitos de build

O `electron-builder` empacota artefatos de outros projetos. Antes de gerar o
instalador, compile ambos:

```bash
cd ../backend  && npm run build   # gera backend/dist
cd ../frontend && npm run build   # gera frontend/dist
cd ../desktop  && npm run dist
```

Se algum faltar, `npm run dist` falha com a lista do que está faltando e o
comando que resolve.

## Configuração

As chaves de API são configuradas **dentro do app**, em `/settings` — não em
arquivo. Ficam em `config.json` na pasta de dados do usuário:

```
%APPDATA%\viral-cut-ai-desktop\config.json
```

O mesmo diretório guarda `app.db`, `uploads/`, `audio/`, `temp/` e `results/`,
então os vídeos não se perdem em atualizações do instalador.

Sem chaves, o app funciona em **modo local**: a transcrição é fictícia e a IA
agrupa a transcrição em blocos usando timestamps reais (sem inventar cortes
fora do vídeo).

## Estrutura

```
desktop/
├── src/
│   ├── main.ts         processo principal: sobe o backend, cria a janela
│   └── preload.ts      ponte contextBridge (exposta ao renderer)
├── scripts/
│   ├── fetch-ffmpeg.js  baixa/copia o FFmpeg para bin/
│   ├── make-db-seed.js  gera backend/prisma/seed.db (banco inicial vazio)
│   └── check-build.js   valida pré-requisitos antes de abrir
├── bin/                ffmpeg.exe e ffprobe.exe (não versionados)
├── electron-builder.yml
└── release/            instalador gerado (não versionado)
```

## Notas de implementação

**Porta dinâmica.** O app usa `PORT=0` para nunca conflitar com um servidor de
dev na 3000. A porta real vem no `SERVER_READY`.

**ABI do Prisma.** `npmRebuild: true` no `electron-builder.yml` reconstrói o
engine do Prisma contra a versão do Node do Electron — sem isso o backend falha
ao abrir o banco.

**SPA fallback.** O backend serve `index.html` para qualquer rota que não seja
`/api/*`, para o React Router funcionar em `/analysis/:id` e `/history`. Precisa
ser um hook `onRequest`, não `setNotFoundHandler` — o `fastifyStatic` responde
404 antes.

**FFmpeg.** `VIRAL_CUT_BIN_DIR` aponta para `resources/bin` quando empacotado. O
código cai para o `PATH` do sistema em desenvolvimento.