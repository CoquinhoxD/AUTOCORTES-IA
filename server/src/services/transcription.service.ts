import fs from 'fs';

// Interface que garante que qualquer provedor futuro funcione igual
export interface TranscriptionProvider {
  transcribe(audioPath: string): Promise<TranscriptionResult>;
}

export interface TranscriptSegment {
  id: number;
  start: number;
  end: number;
  text: string;
}

export interface TranscriptionResult {
  fullText: string;
  segments: TranscriptSegment[];
}

export class TranscriptionService implements TranscriptionProvider {
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.TRANSCRIPTION_API_KEY || '';
    if (!this.apiKey) {
      console.warn("⚠️ AVISO: TRANSCRIPTION_API_KEY não configurada no arquivo .env");
    }
  }

  async transcribe(audioPath: string): Promise<TranscriptionResult> {
    if (!this.apiKey) {
      throw new Error("API de transcrição não configurada. Verifique as chaves no seu arquivo .env");
    }

    if (!fs.existsSync(audioPath)) {
      throw new Error(`Arquivo de áudio não encontrado para transcrição: ${audioPath}`);
    }

    try {
      // 💡 Arquitetura preparada: Aqui entra a chamada real multipart/form-data para a API do Whisper
      // Usando streams para não carregar áudios pesados inteiros na memória do Node
      const audioStream = fs.createReadStream(audioPath);

      // Simulando a resposta estruturada exigida na Fase 1 pós-processamento da API
      // Substitua pelo retorno do seu cliente HTTP/Fetch integrado ao Whisper
      const rawSegments: TranscriptSegment[] = []; 

      // Lógica de Normalização Exigida (Item 9 do seu prompt)
      const normalizedSegments = rawSegments
        .filter(seg => seg.text && seg.text.trim().length > 0) // Remove segmentos vazios
        .map(seg => ({
          ...seg,
          text: seg.text.replace(/\s+/g, ' ').trim() // Normaliza espaços
        }))
        .sort((a, b) => a.start - b.start); // Garante a ordem cronológica

      const fullText = normalizedSegments.map(s => s.text).join(' ');

      return {
        fullText,
        segments: normalizedSegments
      };
    } catch (error: any) {
      console.error("Falha no serviço de transcrição Whisper:", error.message);
      throw error;
    }
  }
}
