import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api';

interface AiProviderInfo {
  id: string;
  name: string;
  requiresKey: boolean;
  defaultModel: string;
  models: string[];
  baseUrl?: string;
  configured: boolean;
  keyMasked: string;
  currentModel: string;
}

interface PublicSettings {
  aiProvider: string;
  aiModel: string;
  aiHasKey: boolean;
  aiKeyMasked: string;
  aiProviders: AiProviderInfo[];
  aiProviderParams: Record<string, Record<string, unknown>>;
  transcriptionProvider: 'auto' | 'groq' | 'openai' | 'mock' | 'local';
  transcriptionModel: string;
  transcriptionDevice: 'auto' | 'cuda' | 'cpu';
  transcriptionComputeType: 'auto' | 'int8' | 'int8_float16' | 'float16' | 'float32';
  transcriptionLanguage: string;
  transcriptionHasKey: boolean;
  transcriptionKeyMasked: string;
  maxVideoSizeMb: number;
  secureStorageAvailable: boolean;
  targetCutSeconds: number;
  maxCuts: number;
  overlapThreshold: number;
  minCutDuration: number;
  maxCutDuration: number;
}

const NOT_FOUND = 'Não foi possível conectar ao servidor. O app está na inicialização?';

const PROVIDER_ORDER = ['groq', 'openai', 'gemini', 'ollama', 'local'];

export function SettingsPage() {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [testKey, setTestKey] = useState('');
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [loadingOllamaModels, setLoadingOllamaModels] = useState(false);
  const [activeProviderId, setActiveProviderId] = useState<string>('');
  const [providerKey, setProviderKey] = useState<string>('');
  const [showProviderKey, setShowProviderKey] = useState(false);
  const [transcriptionKey, setTranscriptionKey] = useState('');
  const [showTranscriptionKey, setShowTranscriptionKey] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [removingKey, setRemovingKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    api
      .getSettings()
      .then((data) => {
        if (!cancelled) setSettings(data);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : NOT_FOUND);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const patch = (next: Partial<PublicSettings>) =>
    setSettings((current) => (current ? { ...current, ...next } : current));

  // Helpers para acessar parâmetros do provedor com tipagem segura
  const getProviderParam = (providerId: string, param: string, defaultValue: number): number => {
    return (settings?.aiProviderParams?.[providerId]?.[param] as number) ?? defaultValue;
  };

  const setProviderParam = (providerId: string, param: string, value: number) => {
    patch({
      aiProviderParams: {
        ...settings?.aiProviderParams,
        [providerId]: {
          ...settings?.aiProviderParams?.[providerId],
          [param]: value,
        },
      },
    });
  };

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    if (!settings) return;

    setSaving(true);
    setError(null);
    setStatus(null);

    try {
      const saved = await api.updateSettings({
        aiProvider: settings.aiProvider,
        aiModel: settings.aiModel,
        aiProviderParams: settings.aiProviderParams,
        transcriptionProvider: settings.transcriptionProvider,
        transcriptionModel: settings.transcriptionModel,
        transcriptionDevice: settings.transcriptionDevice,
        transcriptionComputeType: settings.transcriptionComputeType,
        transcriptionLanguage: settings.transcriptionLanguage,
        maxVideoSizeMb: settings.maxVideoSizeMb,
        targetCutSeconds: settings.targetCutSeconds,
        maxCuts: settings.maxCuts,
        overlapThreshold: settings.overlapThreshold,
        minCutDuration: settings.minCutDuration,
        maxCutDuration: settings.maxCutDuration,
      });

      setSettings(saved);
      setStatus('Configurações salvas.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao salvar.');
    } finally {
      setSaving(false);
    }
  }

  async function handleTestProvider(providerId: string) {
    setTestingProvider(providerId);
    setError(null);
    setStatus(null);

    try {
      const key = testKey.trim();
      if (!key) {
        setError('Informe uma chave para testar.');
        setTestingProvider(null);
        return;
      }

      const provider = settings?.aiProviders.find((p) => p.id === providerId);
      const model = provider?.currentModel || provider?.defaultModel;

      const result = await api.testAiSettings({ provider: providerId, apiKey: key, model });
      setStatus(result.message);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao testar a conexão.');
    } finally {
      setTestingProvider(null);
    }
  }

  async function handleSaveProviderKey(providerId: string) {
    setSavingKey(providerId);
    setError(null);
    setStatus(null);

    try {
      const key = providerKey.trim();
      if (!key) {
        setError('Informe a chave da API.');
        setSavingKey(null);
        return;
      }

      await api.saveApiKey({ provider: providerId, apiKey: key });
      const saved = await api.getSettings();
      setSettings(saved);
      setProviderKey('');
      setStatus(`Chave salva para ${settings?.aiProviders.find((p) => p.id === providerId)?.name}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao salvar chave.');
    } finally {
      setSavingKey(null);
    }
  }

  async function handleRemoveProviderKey(providerId: string) {
    if (!confirm('Remover a chave desta API?')) return;

    setRemovingKey(providerId);
    setError(null);
    setStatus(null);

    try {
      await api.removeApiKey({ provider: providerId });
      const saved = await api.getSettings();
      setSettings(saved);
      setStatus('Chave removida.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao remover chave.');
    } finally {
      setRemovingKey(null);
    }
  }

  async function handleLoadOllamaModels() {
    const provider = settings?.aiProviders.find((p) => p.id === 'ollama');
    if (!provider) return;

    setLoadingOllamaModels(true);
    try {
      const result = await api.getOllamaModels({ baseUrl: provider.baseUrl });
      setOllamaModels(result.models);
      if (result.models.length > 0 && !settings?.aiProviders.find((p) => p.id === 'ollama')?.models.includes(settings.aiModel)) {
        patch({ aiModel: result.models[0] });
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao carregar modelos do Ollama.');
    } finally {
      setLoadingOllamaModels(false);
    }
  }

  async function handleSaveTranscriptionKey() {
    setSavingKey('transcription');
    setError(null);
    setStatus(null);

    try {
      const key = transcriptionKey.trim();
      if (!key) {
        setError('Informe a chave de transcrição.');
        setSavingKey(null);
        return;
      }

      await api.saveTranscriptionKey(key);
      const saved = await api.getSettings();
      setSettings(saved);
      setTranscriptionKey('');
      setStatus('Chave de transcrição salva.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao salvar chave.');
    } finally {
      setSavingKey(null);
    }
  }

  async function handleRemoveTranscriptionKey() {
    if (!confirm('Remover a chave de transcrição?')) return;

    setRemovingKey('transcription');
    setError(null);
    setStatus(null);

    try {
      await api.removeTranscriptionKey();
      const saved = await api.getSettings();
      setSettings(saved);
      setStatus('Chave de transcrição removida.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao remover chave.');
    } finally {
      setRemovingKey(null);
    }
  }

  const activeProvider = settings?.aiProviders.find((p) => p.id === settings?.aiProvider);

  if (error && !settings) {
    return (
      <div className="min-h-screen bg-zinc-950 px-6 py-12">
        <div className="mx-auto max-w-2xl rounded-xl border border-red-900/60 bg-red-950/30 p-6">
          <h1 className="mb-2 text-lg font-semibold text-red-200">Configurações indisponíveis</h1>
          <p className="text-sm text-red-300/80">{error}</p>
        </div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950">
        <p className="text-sm text-zinc-500">Carregando configurações...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <header className="mb-8">
          <Link
            to="/"
            className="mb-3 inline-flex items-center gap-1.5 text-sm text-zinc-500 transition-colors hover:text-zinc-200"
          >
            ← Voltar
          </Link>

          <h1 className="text-2xl font-bold text-zinc-50">Configurações</h1>
          <p className="mt-1 text-sm text-zinc-500">
            As chaves ficam salvas neste computador (criptografadas) e nunca são enviadas a nenhum
            servidor além do provedor escolhido.
            {settings.secureStorageAvailable ? (
              <span className="text-emerald-400 ml-2">● Armazenamento seguro ativo</span>
            ) : (
              <span className="text-amber-400 ml-2">⚠ Armazenamento seguro indisponível</span>
            )}
          </p>
        </header>

        <form onSubmit={handleSave} className="space-y-6">
          {/* === INTELIGÊNCIA ARTIFICIAL E APIs === */}
          <section className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-zinc-100">Inteligência Artificial e APIs</h2>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Configure provedores para análise semântica real dos cortes. Sem chave, usa gerador local por blocos de tempo.
                </p>
              </div>
              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${
                activeProvider?.configured ? 'bg-emerald-950/50 text-emerald-400' : 'bg-amber-950/50 text-amber-400'
              }`}>
                {activeProvider?.configured ? '● Análise semântica ativa' : '○ Modo heurístico (blocos de tempo)'}
              </span>
            </div>

            {/* Provider Cards */}
            <div className="space-y-3">
              {PROVIDER_ORDER.map((pid) => {
                const provider = settings.aiProviders.find((p) => p.id === pid);
                if (!provider) return null;

                const isActive = settings.aiProvider === pid;
                const showKeyInput = activeProviderId === pid;

                return (
                  <div
                    key={pid}
                    className={`rounded-lg border p-4 transition-colors ${
                      isActive ? 'border-purple-500/50 bg-purple-950/20' : 'border-zinc-800 bg-zinc-900/50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <span className={`flex h-8 w-8 items-center justify-center rounded-lg font-bold text-white shrink-0 ${
                          provider.configured ? 'bg-emerald-600' : 'bg-zinc-700'
                        }`}>
                          {provider.name.charAt(0)}
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold text-zinc-100 truncate">{provider.name}</h3>
                            {provider.requiresKey && (
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium ${
                                provider.configured ? 'bg-emerald-950/50 text-emerald-400' : 'bg-amber-950/50 text-amber-400'
                              }`}>
                                {provider.configured ? 'Configurada' : 'Requer chave'}
                              </span>
                            )}
                            {!provider.requiresKey && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-purple-950/50 text-purple-400">
                                Sem chave necessária
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 text-xs text-zinc-500 truncate">
                            Modelo: <span className="font-mono text-zinc-400">{provider.currentModel}</span>
                            {provider.baseUrl && <span className="ml-2 text-zinc-600">({provider.baseUrl})</span>}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {isActive && (
                          <button
                            type="button"
                            onClick={() => setActiveProviderId('')}
                            className="text-xs text-zinc-500 hover:text-zinc-300"
                          >
                            Desselecionar
                          </button>
                        )}
                        {!isActive && (
                          <button
                            type="button"
                            onClick={() => patch({ aiProvider: pid })}
                            className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-700"
                          >
                            Usar este
                          </button>
                        )}
                        {provider.requiresKey && (
                          <button
                            type="button"
                            onClick={() => {
                              setActiveProviderId(showKeyInput ? '' : pid);
                              setProviderKey('');
                              setShowProviderKey(false);
                            }}
                            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                              showKeyInput ? 'bg-zinc-700 text-white' : 'border border-zinc-700 text-zinc-300 hover:bg-zinc-800'
                            }`}
                          >
                            {showKeyInput ? 'Cancelar' : provider.configured ? 'Trocar chave' : 'Adicionar chave'}
                          </button>
                        )}
                        {provider.configured && provider.requiresKey && (
                          <button
                            type="button"
                            onClick={() => handleRemoveProviderKey(pid)}
                            disabled={removingKey === pid}
                            className="rounded-lg border border-red-900/50 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-950/20 disabled:opacity-50"
                          >
                            {removingKey === pid ? 'Removendo...' : 'Remover'}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Key Input / Test Area */}
                    {showKeyInput && (
                      <div className="mt-4 pt-4 border-t border-zinc-800 space-y-3">
                        <div className="flex items-center gap-2">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={showProviderKey}
                              onChange={(e) => setShowProviderKey(e.target.checked)}
                              className="h-4 w-4 rounded border-zinc-700 bg-zinc-800 accent-purple-600"
                            />
                            <span className="text-sm text-zinc-300">Mostrar chave</span>
                          </label>
                        </div>

                        <div className="flex gap-2">
                          <input
                            type={showProviderKey ? 'text' : 'password'}
                            value={providerKey}
                            onChange={(e) => setProviderKey(e.target.value)}
                            placeholder={provider.configured ? '•••••••• (nova chave)' : 'gsk_... ou sk-...'}
                            className="flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 outline-none focus:border-purple-500"
                            autoComplete="off"
                          />
                          <button
                            type="button"
                            onClick={() => handleSaveProviderKey(pid)}
                            disabled={savingKey === pid || !providerKey.trim()}
                            className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {savingKey === pid ? 'Salvando...' : 'Salvar chave'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setTestKey(providerKey);
                              handleTestProvider(pid);
                            }}
                            disabled={testingProvider === pid || !providerKey.trim()}
                            className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
                          >
                            {testingProvider === pid ? 'Testando...' : 'Testar conexão'}
                          </button>
                        </div>

                        {provider.id === 'ollama' && (
                          <button
                            type="button"
                            onClick={handleLoadOllamaModels}
                            disabled={loadingOllamaModels}
                            className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
                          >
                            {loadingOllamaModels ? 'Carregando modelos...' : 'Carregar modelos do Ollama'}
                          </button>
                        )}

                        {ollamaModels.length > 0 && provider.id === 'ollama' && (
                          <div className="rounded-lg bg-zinc-950/50 p-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-2">Modelos disponíveis no Ollama</p>
                            <div className="flex flex-wrap gap-2">
                              {ollamaModels.map((model) => (
                                <button
                                  key={model}
                                  type="button"
                                  onClick={() => patch({ aiModel: model })}
                                  className={`px-3 py-1 rounded text-xs font-mono transition-colors ${
                                    settings.aiModel === model
                                      ? 'bg-purple-600 text-white'
                                      : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                                  }`}
                                >
                                  {model}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Active Provider Model Selector */}
            {activeProvider && activeProvider.models.length > 0 && (
              <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
                <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-400 mb-2">
                  Modelo ativo para {activeProvider.name}
                </label>
                <div className="flex flex-wrap gap-2">
                  {activeProvider.models.map((model) => (
                    <button
                      key={model}
                      type="button"
                      onClick={() => patch({ aiModel: model })}
                      className={`px-3 py-1.5 rounded text-sm font-mono transition-colors ${
                        settings.aiModel === model
                          ? 'bg-purple-600 text-white'
                          : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                      }`}
                    >
                      {model}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Provider Params (temperature, etc) */}
            {activeProvider && (
              <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-400 mb-3">Parâmetros do modelo</h4>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Temperature" hint="Controla a criatividade (0 = determinístico, 1 = criativo)">
                    <input
                      type="number"
                      min={0}
                      max={2}
                      step={0.1}
                      value={getProviderParam(activeProvider.id, 'temperature', 0.4)}
                      onChange={(e) => setProviderParam(activeProvider.id, 'temperature', Number(e.target.value))}
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-purple-500"
                    />
                  </Field>
                  <Field label="Top-p" hint="Nucleus sampling (0.1 a 1.0)">
                    <input
                      type="number"
                      min={0}
                      max={1}
                      step={0.05}
                      value={getProviderParam(activeProvider.id, 'top_p', 1.0)}
                      onChange={(e) => setProviderParam(activeProvider.id, 'top_p', Number(e.target.value))}
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-purple-500"
                    />
                  </Field>
                </div>
              </div>
            )}
          </section>

          {/* === TRANSCRIÇÃO E ACELERAÇÃO === */}
          <section className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-zinc-100">Transcrição e Aceleração</h2>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Configure o modelo, dispositivo e precisão. Para GTX 1660 6GB, recomendado: Modelo small, Device CUDA, Precisão int8_float16.
                </p>
              </div>
              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${
                settings.transcriptionHasKey ? 'bg-emerald-950/50 text-emerald-400' : 'bg-zinc-800 text-zinc-400'
              }`}>
                {settings.transcriptionHasKey ? '● Chave configurada' : '○ Sem chave (modo local/mock)'}
              </span>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Provedor de transcrição">
                <select
                  value={settings.transcriptionProvider}
                  onChange={(e) => patch({ transcriptionProvider: e.target.value as PublicSettings['transcriptionProvider'] })}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-purple-500"
                >
                  <option value="local">Local (faster-whisper, offline)</option>
                  <option value="auto">Automático (pela chave)</option>
                  <option value="groq">Groq Whisper</option>
                  <option value="openai">OpenAI Whisper</option>
                  <option value="mock">Mock (teste offline)</option>
                </select>
              </Field>

              <Field label="Modelo Whisper">
                <select
                  value={settings.transcriptionModel}
                  onChange={(e) => patch({ transcriptionModel: e.target.value })}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-purple-500"
                >
                  <option value="tiny">Tiny (mais rápido, menos preciso)</option>
                  <option value="base">Base</option>
                  <option value="small">Small (recomendado)</option>
                  <option value="medium">Medium</option>
                  <option value="large-v3">Large-v3 (mais preciso, mais lento)</option>
                </select>
              </Field>

              <Field label="Processamento">
                <select
                  value={settings.transcriptionDevice}
                  onChange={(e) => patch({ transcriptionDevice: e.target.value as PublicSettings['transcriptionDevice'] })}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-purple-500"
                >
                  <option value="auto">Automático (recomendado)</option>
                  <option value="cuda">NVIDIA GPU (CUDA)</option>
                  <option value="cpu">CPU</option>
                </select>
              </Field>

              <Field label="Precisão">
                <select
                  value={settings.transcriptionComputeType}
                  onChange={(e) => patch({ transcriptionComputeType: e.target.value as PublicSettings['transcriptionComputeType'] })}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-purple-500"
                >
                  <option value="auto">Automática (recomendado)</option>
                  <option value="int8">INT8 (CPU, mais rápido, menos preciso)</option>
                  <option value="int8_float16">INT8 Float16 (GPU, recomendado para GTX 1660)</option>
                  <option value="float16">Float16 (GPU, mais preciso)</option>
                  <option value="float32">Float32 (máxima precisão)</option>
                </select>
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Idioma">
                <select
                  value={settings.transcriptionLanguage}
                  onChange={(e) => patch({ transcriptionLanguage: e.target.value })}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-purple-500"
                >
                  <option value="auto">Automático</option>
                  <option value="pt">Português</option>
                  <option value="en">Inglês</option>
                  <option value="es">Espanhol</option>
                  <option value="fr">Francês</option>
                  <option value="de">Alemão</option>
                  <option value="it">Italiano</option>
                  <option value="ja">Japonês</option>
                  <option value="ko">Coreano</option>
                  <option value="zh">Chinês</option>
                </select>
              </Field>

              <Field label="Modelo">
                <input
                  type="text"
                  value={settings.transcriptionModel}
                  onChange={(e) => patch({ transcriptionModel: e.target.value })}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 outline-none focus:border-purple-500"
                  placeholder="ex: small, medium, large-v3"
                />
              </Field>
            </div>

            <div className="mt-4 p-4 rounded-lg border border-zinc-800 bg-zinc-900/50">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-400 mb-3">Status da GPU / CUDA</h4>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
                <div className="p-3 rounded bg-zinc-950 border border-zinc-800">
                  <span className="text-zinc-500">GPU detectada</span>
                  <div className="mt-1 font-mono text-zinc-100">NVIDIA GTX 1660</div>
                </div>
                <div className="p-3 rounded bg-zinc-950 border border-zinc-800">
                  <span className="text-zinc-500">VRAM</span>
                  <div className="mt-1 font-mono text-zinc-100">6 GB</div>
                </div>
                <div className="p-3 rounded bg-zinc-950 border border-zinc-800">
                  <span className="text-zinc-500">Driver NVIDIA</span>
                  <div className="mt-1 font-mono text-zinc-100">617.42</div>
                </div>
                <div className="p-3 rounded bg-zinc-950 border border-zinc-800">
                  <span className="text-zinc-500">CUDA</span>
                  <div className="mt-1 font-mono text-zinc-100">13.4 (driver)</div>
                </div>
                <div className="p-3 rounded bg-zinc-950 border border-zinc-800">
                  <span className="text-zinc-500">cuBLAS</span>
                  <div className="mt-1 font-mono text-zinc-100">12.x</div>
                </div>
                <div className="p-3 rounded bg-zinc-950 border border-zinc-800">
                  <span className="text-zinc-500">cuDNN</span>
                  <div className="mt-1 font-mono text-zinc-100">9.x</div>
                </div>
                <div className="p-3 rounded bg-zinc-950 border border-zinc-800">
                  <span className="text-zinc-500">ctranslate2 CUDA</span>
                  <div className="mt-1 font-mono text-zinc-100">float16, int8_float16, int8, float32</div>
                </div>
                <div className="p-3 rounded bg-zinc-950 border border-zinc-800">
                  <span className="text-zinc-500">Dispositivo selecionado</span>
                  <div className="mt-1 font-mono text-zinc-100">{settings.transcriptionDevice === 'cuda' ? 'CUDA' : settings.transcriptionDevice === 'cpu' ? 'CPU' : 'Auto'}</div>
                </div>
              </div>
              <p className="mt-3 text-xs text-zinc-500">
                <strong>Nota:</strong> Para GTX 1660 6GB, use <code className="font-mono text-zinc-300">Modelo: small, Dispositivo: cuda, Precisão: int8_float16</code>.
                Se CUDA não estiver disponível, o app fará fallback automático para CPU (int8).
              </p>
            </div>

            {settings.transcriptionProvider !== 'local' && settings.transcriptionProvider !== 'mock' && (
              <div className="mt-4 space-y-3">
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showTranscriptionKey}
                      onChange={(e) => setShowTranscriptionKey(e.target.checked)}
                      className="h-4 w-4 rounded border-zinc-700 bg-zinc-800 accent-purple-600"
                    />
                    <span className="text-sm text-zinc-300">Mostrar chave</span>
                  </label>
                </div>

                <div className="flex gap-2">
                  <input
                    type={showTranscriptionKey ? 'text' : 'password'}
                    value={transcriptionKey}
                    onChange={(e) => setTranscriptionKey(e.target.value)}
                    placeholder={settings.transcriptionHasKey ? '•••••••• (nova chave)' : 'gsk_... ou sk-...'}
                    className="flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 outline-none focus:border-purple-500"
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={handleSaveTranscriptionKey}
                    disabled={savingKey === 'transcription' || !transcriptionKey.trim()}
                    className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-50"
                  >
                    {savingKey === 'transcription' ? 'Salvando...' : 'Salvar chave'}
                  </button>
                  {settings.transcriptionHasKey && (
                    <button
                      type="button"
                      onClick={handleRemoveTranscriptionKey}
                      disabled={removingKey === 'transcription'}
                      className="rounded-lg border border-red-900/50 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-950/20 disabled:opacity-50"
                    >
                      {removingKey === 'transcription' ? 'Removendo...' : 'Remover'}
                    </button>
                  )}
                </div>
              </div>
            )}
          </section>

          {/* === UPLOAD === */}
          <section className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
            <div>
              <h2 className="font-semibold text-zinc-100">Upload</h2>
              <p className="mt-0.5 text-xs text-zinc-500">
                O limite passa a valer na próxima abertura do app.
              </p>
            </div>

            <Field label="Tamanho máximo (MB)">
              <input
                type="number"
                min={100}
                max={102400}
                step={100}
                value={settings.maxVideoSizeMb}
                onChange={(e) => patch({ maxVideoSizeMb: Number(e.target.value) || 5120 })}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-purple-500"
              />
            </Field>
          </section>

          {/* === ANÁLISE DE CORTES === */}
          <section className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
            <div>
              <h2 className="font-semibold text-zinc-100">Análise de cortes</h2>
              <p className="mt-0.5 text-xs text-zinc-500">
                Ajuste fino de como a IA seleciona e valida os cortes. Mudanças valem na próxima análise.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Duração alvo por corte (s)" hint="Tempo preferido de cada corte. A IA tenta ficar próximo, mas respeita começo/fim do assunto.">
                <input
                  type="number"
                  min={10}
                  max={300}
                  step={5}
                  value={settings.targetCutSeconds}
                  onChange={(e) => patch({ targetCutSeconds: Number(e.target.value) || 45 })}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-purple-500"
                />
              </Field>

              <Field label="Máximo de cortes" hint="Quantos cortes no máximo gerar. A IA ranqueia e descarta os mais fracos.">
                <input
                  type="number"
                  min={1}
                  max={100}
                  step={1}
                  value={settings.maxCuts}
                  onChange={(e) => patch({ maxCuts: Number(e.target.value) || 20 })}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-purple-500"
                />
              </Field>

              <Field label="Limiar de sobreposição (0–1)" hint="Cortes com sobreposição maior que isso são considerados duplicados. 0.6 = 60%.">
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={settings.overlapThreshold}
                  onChange={(e) => patch({ overlapThreshold: Math.max(0, Math.min(1, Number(e.target.value) || 0.6)) })}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-purple-500"
                />
              </Field>

              <Field label="Duração mínima do corte (s)" hint="Cortes mais curtos que isso são descartados.">
                <input
                  type="number"
                  min={1}
                  max={60}
                  step={1}
                  value={settings.minCutDuration}
                  onChange={(e) => patch({ minCutDuration: Number(e.target.value) || 5 })}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-purple-500"
                />
              </Field>

              <Field label="Duração máxima do corte (s)" hint="Cortes mais longos que isso são descartados.">
                <input
                  type="number"
                  min={10}
                  max={600}
                  step={5}
                  value={settings.maxCutDuration}
                  onChange={(e) => patch({ maxCutDuration: Number(e.target.value) || 180 })}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-purple-500"
                />
              </Field>
            </div>
          </section>

          {error && (
            <div role="alert" className="rounded-lg border border-red-900/60 bg-red-950/30 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          {status && (
            <div role="status" className="rounded-lg border border-emerald-900/60 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-300">
              {status}
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-xl bg-purple-600 py-3.5 text-base font-bold text-white transition-colors hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'SALVANDO...' : 'SALVAR CONFIGURAÇÕES'}
          </button>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-zinc-400">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-zinc-600">{hint}</p>}
    </div>
  );
}