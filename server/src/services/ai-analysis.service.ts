import { CUT_ANALYSIS_PROMPT } from '../prompts/cut-analysis.prompt';
import { TranscriptSegment } from './transcription.service';

export class AiAnalysisService {
  private apiKey: string;
  private modelName: string;

  constructor() {
    this.apiKey = process.env.AI_API_KEY || '';
    this.modelName = process.env.AI_MODEL || 'gpt-4o'; // ou modelo equivalente selecionado
  }

  async analyzeTranscriptAndGetCuts(segments: TranscriptSegment[]): Promise<any> {
    if (!this.apiKey) {
      throw new Error("Chave de API de IA (AI_API_KEY) não configurada no .env");
    }

    // Estratégia de Contexto para Vídeos Longos (Item 21 do seu prompt)
    const formattedTranscript = segments
      .map(s => `[${s.start.toFixed(2)}s - ${s.end.toFixed(2)}s] ${s.text}`)
      .join('\n');

    const fullPrompt = `${CUT_ANALYSIS_PROMPT}\n${formattedTranscript}`;

    try {
      // Aqui você faz o disparo para a API escolhida (OpenAI, Anthropic, Gemini, etc.)
      // passando o 'fullPrompt' e forçando o 'response_format: { type: "json_object" }'
      
      console.log(`Enviando transcrição de ${segments.length} segmentos para análise global de IA...`);
      
      // O retorno deve ser parseado diretamente para o formato JSON estruturado dos 20 cortes
      return {
        // Exemplo da estrutura que retornará da IA
        cuts: [] 
      };
    } catch (error: any) {
      console.error("Erro durante a análise de IA dos cortes:", error.message);
      throw error;
    }
  }
}
