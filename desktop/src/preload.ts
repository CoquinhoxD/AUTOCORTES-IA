import { contextBridge, ipcRenderer } from 'electron';

/**
 * Ponte entre o renderer (React) e o processo principal.
 *
 * `contextIsolation` está ligado e o renderer não tem acesso ao Node —
 * esta é a única superfície exposta, e é intencionalmente mínima.
 */
contextBridge.exposeInMainWorld('desktop', {
  /** Abre o diálogo nativo de arquivos. Resolve para o caminho ou null. */
  pickVideo: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickVideo'),

  /** Versão e caminhos do app — exibidos na tela de configurações. */
  info: (): Promise<{ version: string; platform: string; dataPath: string }> =>
    ipcRenderer.invoke('app:info'),
});

export type DesktopBridge = {
  pickVideo: () => Promise<string | null>;
  info: () => Promise<{ version: string; platform: string; dataPath: string }>;
};