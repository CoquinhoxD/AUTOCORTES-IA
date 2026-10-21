export interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  duration?: string;
  bit_rate?: string;
  channels?: number;
  sample_rate?: string;
}

export interface ProbeFormat {
  filename?: string;
  format_name?: string;
  duration?: string;
  size?: string;
  bit_rate?: string;
  nb_streams?: number;
}

export interface ProbeResult {
  streams: ProbeStream[];
  format: ProbeFormat;
}

export interface VideoTechnicalInfo {
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  hasVideo: boolean;
  videoCodec: string | null;
  audioCodec: string | null;
  sizeBytes: number;
}
