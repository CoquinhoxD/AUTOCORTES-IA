#!/usr/bin/env python3
"""
Script Python para transcrição local usando faster-whisper.
Chamado pelo backend Node.js via child_process.
Recebe: audio_path, model, language, device, compute_type
Retorna: JSON com segments e fullText na stdout.

Modos de operação:
- Transcrição completa (arquivo único)
- Transcrição em chunks com progresso (arquivos longos)
- Diagnóstico de GPU/CUDA
"""

import sys
import json
import os
import time
import subprocess

def run_diagnostics():
    """Executa diagnóstico completo de GPU/CUDA/cuDNN."""
    result = {
        "gpu_detected": False,
        "gpu_name": None,
        "vram_total_mb": None,
        "driver_version": None,
        "cuda_available": False,
        "cuda_version": None,
        "cublas_available": False,
        "cudnn_available": False,
        "ctranslate2_cuda": False,
        "compute_types": [],
        "model_load_test": False,
        "inference_test": False,
        "device_used": "cpu",
        "errors": []
    }
    
    # Detectar GPU via nvidia-smi
    try:
        nvidia_smi = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.total,driver_version", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=10
        )
        if nvidia_smi.returncode == 0 and nvidia_smi.stdout.strip():
            lines = nvidia_smi.stdout.strip().split('\n')
            if lines:
                gpu_info = lines[0].split(', ')
                result["gpu_detected"] = True
                result["gpu_name"] = gpu_info[0].strip()
                result["vram_total_mb"] = int(gpu_info[1].strip())
                result["driver_version"] = gpu_info[2].strip()
    except Exception as e:
        result["errors"].append(f"nvidia-smi: {str(e)}")
    
    # Verificar CUDA via nvcc
    try:
        nvcc = subprocess.run(["nvcc", "--version"], capture_output=True, text=True, timeout=5)
        if nvcc.returncode == 0:
            result["cuda_available"] = True
            for line in nvcc.stdout.split('\n'):
                if "release" in line.lower():
                    parts = line.split("release")
                    if len(parts) > 1:
                        result["cuda_version"] = parts[1].split(",")[0].strip()
                        break
    except Exception as e:
        result["errors"].append(f"nvcc: {str(e)}")
    
    # Verificar bibliotecas CUDA
    try:
        import ctypes
        ctypes.CDLL("cublas64_12.dll")
        result["cublas_available"] = True
    except Exception as e:
        result["errors"].append(f"cublas64_12.dll: {str(e)}")
    
    try:
        import ctypes
        ctypes.CDLL("cudnn64_9.dll")  # ou cudnn64_8.dll
        result["cudnn_available"] = True
    except Exception as e:
        result["errors"].append(f"cudnn: {str(e)}")
    
    # Verificar ctranslate2
    try:
        import ctranslate2
        result["ctranslate2_cuda"] = "cuda" in ctranslate2.get_supported_compute_types("cuda")
        result["compute_types"] = ctranslate2.get_supported_compute_types("cuda")
    except Exception as e:
        result["errors"].append(f"ctranslate2: {str(e)}")
    
    # Teste de carregamento de modelo
    try:
        from faster_whisper import WhisperModel
        model = WhisperModel("tiny", device="cuda", compute_type="int8_float16")
        result["model_load_test"] = True
        
        # Teste de inferência rápida
        import tempfile
        import numpy as np
        import wave
        
        # Gerar áudio de teste silencioso (1 segundo)
        sample_rate = 16000
        duration = 1
        t = np.linspace(0, duration, sample_rate * duration, False)
        audio_data = np.sin(2 * np.pi * 440 * t) * 0.1
        audio_data = (audio_data * 32767).astype(np.int16)
        
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            with wave.open(tmp.name, 'wb') as wf:
                wf.setnchannels(1)
                wf.setsampwidth(2)
                wf.setframerate(sample_rate)
                wf.writeframes(audio_data.tobytes())
            tmp_path = tmp.name
        
        try:
            segments, _ = model.transcribe(tmp_path, language="en", beam_size=1)
            list(segments)  # Consumir o gerador
            result["inference_test"] = True
            result["device_used"] = "cuda"
        finally:
            os.unlink(tmp_path)
            
    except Exception as e:
        result["errors"].append(f"model_test: {str(e)}")
    
    return result


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Uso: python transcribe_faster_whisper.py <comando> [args...]"}))
        print(json.dumps({"commands": ["transcribe", "diagnose"]}))
        sys.exit(1)
    
    command = sys.argv[1]
    
    if command == "diagnose":
        result = run_diagnostics()
        print(json.dumps(result, ensure_ascii=False))
        return
    
    if command != "transcribe":
        print(json.dumps({"error": f"Comando desconhecido: {command}. Use 'transcribe' ou 'diagnose'"}))
        sys.exit(1)
    
    # Comando transcribe
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Uso: python transcribe_faster_whisper.py transcribe <audio_path> [model] [language] [device] [compute_type] [progress_callback]" }))
        sys.exit(1)
    
    audio_path = sys.argv[2]
    model_name = sys.argv[3] if len(sys.argv) > 3 else "small"
    language = sys.argv[4] if len(sys.argv) > 4 else "pt"
    device = sys.argv[5] if len(sys.argv) > 5 else "auto"
    compute_type = sys.argv[6] if len(sys.argv) > 6 else "auto"
    progress_callback = sys.argv[7] if len(sys.argv) > 7 else None
    
    # Verificar se arquivo existe
    if not os.path.exists(audio_path):
        print(json.dumps({"error": f"Arquivo de áudio não encontrado: {audio_path}"}))
        sys.exit(1)
    
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print(json.dumps({"error": "faster-whisper não instalado. Execute: pip install faster-whisper"}))
        sys.exit(1)
    
    # Configurar device e compute_type
    if device == "auto":
        try:
            import torch
            device = "cuda" if torch.cuda.is_available() else "cpu"
        except ImportError:
            device = "cpu"
    
    if compute_type == "auto":
        compute_type = "int8_float16" if device == "cuda" else "int8"
    
    # Validar combinação device/compute_type
    if device == "cuda" and compute_type not in ["float16", "int8_float16", "int8", "float32"]:
        compute_type = "int8_float16"
    elif device == "cpu" and compute_type not in ["int8", "float32"]:
        compute_type = "int8"
    
    print(f"[faster-whisper] Carregando modelo: {model_name} | device: {device} | compute_type: {compute_type}", file=sys.stderr)
    
    try:
        model = WhisperModel(model_name, device=device, compute_type=compute_type)
    except Exception as e:
        print(json.dumps({"error": f"Falha ao carregar modelo: {str(e)}"}))
        sys.exit(1)
    
    # Obter duração do áudio
    try:
        import subprocess
        ffprobe = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", 
             "-of", "default=noprint_wrappers=1:nokey=1", audio_path],
            capture_output=True, text=True, timeout=30
        )
        total_duration = float(ffprobe.stdout.strip()) if ffprobe.stdout.strip() else 0
    except Exception:
        total_duration = 0
    
    print(f"[faster-whisper] Transcrevendo: {audio_path} (duração: {total_duration:.1f}s)", file=sys.stderr)
    
    # Callback de progresso
    def send_progress(percent, message, extra=None):
        if progress_callback:
            progress_data = {
                "type": "progress",
                "percent": round(percent, 1),
                "message": message,
                "timestamp": time.time()
            }
            if extra:
                progress_data.update(extra)
            print(json.dumps(progress_data), flush=True)
    
    try:
        # Verificar se deve usar chunking (arquivos > 25MB ou > 10 min)
        file_size_mb = os.path.getsize(audio_path) / (1024 * 1024)
        duration = total_duration if total_duration > 0 else 0
        
        # Configuração de chunking
        CHUNK_MAX_SIZE_MB = 24
        CHUNK_MAX_DURATION_SEC = 600  # 10 min
        CHUNK_OVERLAP_SEC = 2
        
        needs_chunking = file_size_mb > CHUNK_MAX_SIZE_MB or duration > CHUNK_MAX_DURATION_SEC
        
        if not needs_chunking:
            send_progress(10, "Iniciando transcrição...", {"stage": "transcribing", "total_chunks": 1})
            
            segments, info = model.transcribe(
                audio_path,
                language=language if language != "auto" else None,
                beam_size=5,
                word_timestamps=True,
                vad_filter=True,
                vad_parameters=dict(min_silence_duration_ms=500),
            )
            
            send_progress(90, "Finalizando...", {"stage": "finalizing"})
            
            result_segments = []
            full_text_parts = []
            
            for i, segment in enumerate(segments):
                seg_data = {
                    "id": i,
                    "start": round(segment.start, 3),
                    "end": round(segment.end, 3),
                    "text": segment.text.strip()
                }
                result_segments.append(seg_data)
                full_text_parts.append(segment.text.strip())
            
            send_progress(100, "Transcrição concluída", {
                "stage": "complete",
                "segments": len(result_segments),
                "language": info.language,
                "language_probability": info.language_probability,
                "duration": info.duration
            })
            
            result = {
                "segments": result_segments,
                "fullText": " ".join(full_text_parts),
                "language": info.language,
                "language_probability": info.language_probability,
                "duration": info.duration
            }
            print(json.dumps(result, ensure_ascii=False))
            return
        
        # Chunking para arquivos longos
        send_progress(5, "Dividindo áudio em chunks...", {"stage": "chunking"})
        
        # Usar ffmpeg para dividir
        import tempfile
        temp_dir = tempfile.mkdtemp(prefix="whisper_chunks_")
        
        try:
            # Obter duração real
            ffprobe = subprocess.run(
                ["ffprobe", "-v", "error", "-show_entries", "format=duration", 
                 "-of", "default=noprint_wrappers=1:nokey=1", audio_path],
                capture_output=True, text=True, timeout=30
            )
            total_duration = float(ffprobe.stdout.strip()) if ffprobe.stdout.strip() else 0
            
            CHUNK_MAX_DURATION_SEC = 300  # 5 min por chunk
            CHUNK_OVERLAP_SEC = 2
            
            chunk_duration = min(CHUNK_MAX_DURATION_SEC, total_duration)
            step = chunk_duration - CHUNK_OVERLAP_SEC
            num_chunks = max(1, int(np.ceil(total_duration / step))) if total_duration > 0 else 1
            
            # Importar numpy aqui para evitar erro se não estiver instalado
            try:
                import numpy as np
            except ImportError:
                # Fallback sem numpy
                num_chunks = max(1, int(total_duration / step) + 1) if total_duration > 0 else 1
            
            chunk_paths = []
            chunk_start_times = []
            
            send_progress(10, f"Dividindo em {num_chunks} chunks...", {
                "stage": "chunking",
                "total_chunks": num_chunks,
                "total_duration": total_duration
            })
            
            for i in range(num_chunks):
                start_time = i * step
                actual_duration = min(chunk_duration, total_duration - start_time)
                if actual_duration <= 0:
                    break
                
                chunk_path = os.path.join(temp_dir, f"chunk_{i:03d}.mp3")
                
                # Usar ffmpeg para extrair chunk
                subprocess.run([
                    "ffmpeg", "-y",
                    "-ss", f"{start_time:.3f}",
                    "-i", audio_path,
                    "-t", f"{actual_duration:.3f}",
                    "-acodec", "libmp3lame",
                    "-b:a", "32k",
                    "-ar", "16000",
                    "-ac", "1",
                    chunk_path
                ], capture_output=True, timeout=60)
                
                chunk_paths.append(chunk_path)
                chunk_start_times.append(start_time)
            
            all_segments = []
            total_chunks = len(chunk_paths)
            
            for i, (chunk_path, chunk_start) in enumerate(zip(chunk_paths, chunk_start_times)):
                progress = 15 + (i / total_chunks) * 75
                send_progress(progress, f"Transcrevendo chunk {i+1}/{total_chunks}...", {
                    "stage": "transcribing",
                    "current_chunk": i + 1,
                    "total_chunks": total_chunks,
                    "chunk_start": chunk_start
                })
                
                segments, info = model.transcribe(
                    chunk_path,
                    language=language if language != "auto" else None,
                    beam_size=5,
                    word_timestamps=True,
                    vad_filter=True,
                    vad_parameters=dict(min_silence_duration_ms=500),
                )
                
                for seg in segments:
                    all_segments.append({
                        "id": len(all_segments),
                        "start": round(seg.start + chunk_start, 3),
                        "end": round(seg.end + chunk_start, 3),
                        "text": seg.text.strip()
                    })
                
                # Limpar chunk processado
                try:
                    os.unlink(chunk_path)
                except:
                    pass
            
            # Ordenar e mesclar segmentos sobrepostos
            all_segments.sort(key=lambda x: x["start"])
            
            merged = []
            for seg in all_segments:
                if not merged:
                    merged.append(seg)
                else:
                    prev = merged[-1]
                    overlap = min(prev["end"], seg["end"]) - max(prev["start"], seg["start"])
                    shorter = min(prev["end"] - prev["start"], seg["end"] - seg["start"])
                    
                    if shorter > 0 and overlap / shorter >= 0.2:
                        if seg["text"] != prev["text"]:
                            prev["text"] = f"{prev['text']} {seg['text']}".strip()
                        prev["end"] = max(prev["end"], seg["end"])
                    else:
                        seg["id"] = len(merged)
                        merged.append(seg)
            
            send_progress(95, "Finalizando...", {"stage": "finalizing", "segments": len(merged)})
            
            full_text = " ".join(s["text"] for s in merged)
            
            result = {
                "segments": merged,
                "fullText": full_text,
                "language": "pt",
                "language_probability": 1.0,
                "duration": total_duration
            }
            send_progress(100, "Transcrição concluída", {
                "stage": "complete",
                "segments": len(merged),
                "duration": total_duration
            })
            print(json.dumps(result, ensure_ascii=False))
            
        finally:
            # Limpar diretório temporário
            try:
                import shutil
                shutil.rmtree(temp_dir, ignore_errors=True)
            except:
                pass
    
    except Exception as e:
        import traceback
        print(json.dumps({"error": f"Erro na transcrição: {str(e)}", "traceback": traceback.format_exc()}))
        sys.exit(1)


if __name__ == "__main__":
    main()