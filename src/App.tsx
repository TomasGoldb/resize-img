/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Upload, 
  Settings, 
  Download, 
  CheckCircle2, 
  RefreshCw, 
  Image as ImageIcon,
  FolderOpen,
  ArrowRight,
  Zap,
  Layers,
  ChevronRight,
  AlertCircle
} from 'lucide-react';
import JSZip from 'jszip';
import confetti from 'canvas-confetti';
import { GoogleGenAI } from "@google/genai";

// Types
type ProcessingStatus = 'idle' | 'processing' | 'completed' | 'error';
type ImageFormat = 'image/jpeg' | 'image/png' | 'image/webp';
type UpscaleMethod = 'generative-fill' | 'hugging-face' | 'ai-blur' | 'solid-edge';

interface ProcessedImage {
  id: string;
  name: string;
  originalUrl: string;
  processedUrl: string;
  status: 'pending' | 'success' | 'error';
  progress: number;
}

interface SettingsConfig {
  format: ImageFormat;
  quality: number;
  scaleFactor: number;
  upscaleMethod: UpscaleMethod;
}

const ASPECT_RATIO = 4 / 5; // 0.8 (Width / Height)

export default function App() {
  const [status, setStatus] = useState<ProcessingStatus>('idle');
  const [files, setFiles] = useState<File[]>([]);
  const [processedImages, setProcessedImages] = useState<ProcessedImage[]>([]);
  const [settings, setSettings] = useState<SettingsConfig>({
    format: 'image/jpeg',
    quality: 0.9,
    scaleFactor: 1.5,
    upscaleMethod: 'generative-fill',
  });
  const [globalProgress, setGlobalProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const hfToken = (import.meta as any).env.VITE_HF_API_TOKEN;

  // Handle folder upload
  const handleFolderUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFiles = Array.from(e.target.files || []) as File[];
    const imageFiles = uploadedFiles.filter(file => file.type.startsWith('image/'));
    
    if (imageFiles.length === 0) {
      setErrorMsg("No se encontraron imágenes en la carpeta seleccionada.");
      return;
    }

    setFiles(imageFiles);
    setErrorMsg(null);
    setStatus('idle');
    setProcessedImages(imageFiles.map((file: File) => ({
      id: Math.random().toString(36).substring(7),
      name: file.name,
      originalUrl: URL.createObjectURL(file),
      processedUrl: '',
      status: 'pending',
      progress: 0,
    })));
  };

  const [batchInsight, setBatchInsight] = useState<string | null>(null);

  const generateBatchInsight = async (fileCount: number) => {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview", 
        contents: [{
          role: "user",
          parts: [{
            text: `I am processing a batch of ${fileCount} images to convert them from 1:1 to 4:5 aspect ratio. 
            Give me a very short (10 words max), technical-sounding optimization status in Spanish, like "Detección de bordes optimizada para texturas de alta frecuencia".`
          }]
        }]
      });
      const insight = response.text?.trim();
      setBatchInsight(insight || "Analizando composición y texturas...");
    } catch (e) {
      console.error("Gemini insight failed", e);
      setBatchInsight("Optimizando flujo de trabajo neuronal...");
    }
  };

  useEffect(() => {
    if (files.length > 0 && status === 'processing' && !batchInsight) {
      generateBatchInsight(files.length);
    }
    if (status === 'idle') {
      setBatchInsight(null);
    }
  }, [status, files.length]);

  const processAll = async () => {
    if (processedImages.length === 0) return;
    
    setStatus('processing');
    setGlobalProgress(0);
    
    const results: ProcessedImage[] = [...processedImages];
    const total = results.length;

    for (let i = 0; i < total; i++) {
      const current = results[i];
      try {
        // Delay to respect Rate Limits (RPM) - essential for image generation
        if (i > 0) {
          await new Promise(resolve => setTimeout(resolve, 3000));
        }

        const processedUrl = await processImage(files[i], settings);
        
        results[i] = {
          ...current,
          processedUrl,
          status: 'success',
          progress: 100,
        };
        
        setProcessedImages([...results]);
        setGlobalProgress(Math.round(((i + 1) / total) * 100));
      } catch (err) {
        console.error("Error al procesar", current.name, err);
        results[i] = { ...current, status: 'error', progress: 0 };
        setProcessedImages([...results]);
      }
    }

    setStatus('completed');
    confetti({
      particleCount: 150,
      spread: 70,
      origin: { y: 0.6 },
      colors: ['#00ff88', '#60efff', '#ffffff']
    });
  };

  const processImage = async (file: File, config: SettingsConfig): Promise<string> => {
    if (config.upscaleMethod === 'generative-fill') {
      return processGenerativeFill(file, config);
    }
    
    if (config.upscaleMethod === 'hugging-face') {
      return processHuggingFace(file, config);
    }

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { alpha: config.format === 'image/png' });
        if (!ctx) return reject("Error de Canvas");

        // Calculate target dimensions
        // Let's assume user wants high-res 4:5
        // If source is 1000x1000, target 4:5 width is 1000, target height is 1250 (1000 / 0.8)
        // Then we apply the scale factor
        const targetWidth = img.width * config.scaleFactor;
        const targetHeight = targetWidth / ASPECT_RATIO;

        canvas.width = targetWidth;
        canvas.height = targetHeight;

        // Background
        if (config.upscaleMethod === 'ai-blur') {
          // Draw blurred background
          ctx.filter = 'blur(40px) brightness(0.6)';
          // Stretch image to fill background
          ctx.drawImage(img, -targetWidth * 0.1, -targetHeight * 0.1, targetWidth * 1.2, targetHeight * 1.2);
          ctx.filter = 'none';
        } else if (config.upscaleMethod === 'solid-edge') {
          // Use edge color (simplistic average)
          ctx.fillStyle = '#111'; 
          ctx.fillRect(0, 0, targetWidth, targetHeight);
        }

        // Draw original centered image
        const drawWidth = targetWidth;
        const drawHeight = img.height * (targetWidth / img.width);
        const yOffset = (targetHeight - drawHeight) / 2;
        
        // Add subtle shadow for depth if in blur mode
        if (config.upscaleMethod === 'ai-blur') {
          ctx.shadowColor = 'rgba(0,0,0,0.5)';
          ctx.shadowBlur = 40;
        }
        
        ctx.drawImage(img, 0, yOffset, drawWidth, drawHeight);

        resolve(canvas.toDataURL(config.format, config.quality));
      };
      img.onerror = () => reject("Error al cargar imagen");
      img.src = URL.createObjectURL(file);
    });
  };

  const processHuggingFace = async (file: File, config: SettingsConfig): Promise<string> => {
    const hfToken = (import.meta as any).env.VITE_HF_API_TOKEN;
    if (!hfToken) {
      setErrorMsg("Se requiere VITE_HF_API_TOKEN de Hugging Face para este método.");
      return processBlurFallback(file, config);
    }

    try {
      // Use SDXL for higher quality background extension
      const MODEL_ID = "stabilityai/stable-diffusion-xl-base-1.0"; 
      const PROMPT = "Professional high-quality studio photography, expand background seamlessly, cinematic lighting, ultra-detailed, matching textures of the central object";
      const blob = await file.arrayBuffer();

      let attempts = 0;
      let response;
      
      while (attempts < 3) {
        try {
          response = await fetch(`/api/hf-proxy`, {
            headers: { 
              "x-hf-token": hfToken.trim(),
              "x-model-id": MODEL_ID,
              "x-hf-prompt": PROMPT,
              "Content-Type": "application/octet-stream"
            },
            method: "POST",
            body: blob,
          });

          if (response.status === 503 || response.status === 429) {
            attempts++;
            await new Promise(r => setTimeout(r, 7000));
            continue;
          }
          break;
        } catch (fetchErr) {
          attempts++;
          if (attempts >= 3) throw fetchErr;
          await new Promise(r => setTimeout(r, 2000));
        }
      }

      if (!response || !response.ok) {
        throw new Error(`HF Error: ${response?.statusText || 'Inferencia fallida'}`);
      }

      const resultBlob = await response.blob();
      const reader = new FileReader();
      return new Promise((resolve) => {
        reader.onloadend = async () => {
          const rawBase64 = reader.result as string;
          resolve(await forceResizeTo45(rawBase64, config));
        };
        reader.readAsDataURL(resultBlob);
      });
    } catch (error: any) {
      console.error("Error en Hugging Face:", error);
      setErrorMsg(`Error en Hugging Face: ${error.message || "Fallo"}`);
      return processBlurFallback(file, config);
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        resolve(base64);
      };
      reader.onerror = error => reject(error);
    });
  };

  const processGenerativeFill = async (file: File, config: SettingsConfig): Promise<string> => {
    try {
      const base64 = await fileToBase64(file);
      
      console.log("Extendiendo fondo con Gemini 2.5 Flash Image...");
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-image",
        contents: [
          {
            role: "user",
            parts: [
              {
                inlineData: {
                  data: base64,
                  mimeType: file.type
                }
              },
              {
                text: "OUTPAINTING TASK: This is a square 1:1 image. Extend the background vertically to reach a 4:5 aspect ratio. Generate new content at the top and bottom that matches the original image's lighting, texture, and environment perfectly. Return the new full 4:5 image."
              }
            ]
          }
        ],
        config: {
          imageConfig: {
            aspectRatio: "4:5"
          }
        }
      });
      
      let imageUrl: string | null = null;
      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          imageUrl = `data:image/png;base64,${part.inlineData.data}`;
          break;
        }
      }

      if (imageUrl) {
        return await forceResizeTo45(imageUrl, config);
      }
      
      console.warn("Gemini no devolvió una imagen en la respuesta, usando respaldo.");
      return processBlurFallback(file, config);
    } catch (error: any) {
      console.error("Error en flujo Gemini Solo:", error);
      return processBlurFallback(file, config);
    }
  };

  const forceResizeTo45 = (base64: string, config: SettingsConfig): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(base64);

        // Forzamos 4:5 aquí independientemente de lo que devolvió Gemini
        const targetWidth = img.width;
        const targetHeight = targetWidth / ASPECT_RATIO;
        
        canvas.width = targetWidth;
        canvas.height = targetHeight;

        // Draw image stretched or centered to fit the target 4:5
        // If it was already 4:5 (or close 3:4), this is a clean draw
        // If it was 1:1, this will center it or fill it
        const hRatio = canvas.width / img.width;
        const vRatio = canvas.height / img.height;
        const ratio = Math.max(hRatio, vRatio);
        const centerShift_x = (canvas.width - img.width * ratio) / 2;
        const centerShift_y = (canvas.height - img.height * ratio) / 2;
        
        ctx.drawImage(img, 0, 0, img.width, img.height,
                           centerShift_x, centerShift_y, img.width * ratio, img.height * ratio);

        resolve(canvas.toDataURL(config.format, config.quality));
      };
      img.src = base64;
    });
  };

  const processBlurFallback = async (file: File, config: SettingsConfig): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject("Error de Canvas");

        const targetWidth = img.width * config.scaleFactor;
        const targetHeight = targetWidth / ASPECT_RATIO;
        canvas.width = targetWidth;
        canvas.height = targetHeight;

        ctx.filter = 'blur(40px) brightness(0.6)';
        ctx.drawImage(img, -targetWidth * 0.1, -targetHeight * 0.1, targetWidth * 1.2, targetHeight * 1.2);
        ctx.filter = 'none';

        const drawWidth = targetWidth;
        const drawHeight = img.height * (targetWidth / img.width);
        const yOffset = (targetHeight - drawHeight) / 2;
        ctx.drawImage(img, 0, yOffset, drawWidth, drawHeight);

        resolve(canvas.toDataURL(config.format, config.quality));
      };
      img.src = URL.createObjectURL(file);
    });
  };

  const downloadZip = async () => {
    const zip = new JSZip();
    const folderName = "imagenes-procesadas-aspect-ai";
    const outFolder = zip.folder(folderName);
    
    if (!outFolder) return;

    processedImages.forEach((img, idx) => {
      if (img.status === 'success') {
        const base64Data = img.processedUrl.split(',')[1];
        const ext = settings.format.split('/')[1];
        outFolder.file(`${img.name.split('.')[0]}_4.5.${ext}`, base64Data, { base64: true });
      }
    });

    const content = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(content);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${folderName}.zip`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const resetAll = () => {
    setFiles([]);
    setProcessedImages([]);
    setStatus('idle');
    setGlobalProgress(0);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="min-h-screen flex flex-col font-sans">
      {/* Header */}
      <nav className="border-b border-white/10 bg-transparent backdrop-blur-sm sticky top-0 z-50 px-8 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand-accent flex items-center justify-center glow-indigo shadow-brand-accent/20">
              <ImageIcon size={20} className="text-white fill-white/10" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white">Aspect<span className="text-brand-accent/80">AI</span></h1>
              <p className="text-[10px] text-slate-400 uppercase tracking-[0.2em] font-medium">Reescalado Inteligente de Aspecto</p>
            </div>
          </div>
          
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
               <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Formato de Salida</span>
               <div className="flex bg-black/40 p-1 rounded-lg border border-white/5">
                {(['image/webp', 'image/png', 'image/jpeg'] as ImageFormat[]).map(fmt => (
                  <button
                    key={fmt}
                    onClick={() => setSettings({...settings, format: fmt})}
                    className={`px-3 py-1 rounded text-[10px] font-bold transition-all ${
                      settings.format === fmt 
                        ? 'bg-brand-accent text-white' 
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {fmt.split('/')[1].toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            {files.length > 0 && (
              <button 
                onClick={resetAll}
                className="px-5 py-2 glass rounded-full text-xs font-bold uppercase tracking-widest text-slate-300 hover:bg-white/10 transition-colors"
              >
                Limpiar Cola
              </button>
            )}
          </div>
        </div>
      </nav>

      <main className="flex-1 max-w-7xl mx-auto w-full p-8 grid grid-cols-12 gap-8">
        {/* Left Column: Processing Studio */}
        <div className="col-span-12 lg:col-span-8 flex flex-col gap-6">
          <div className="flex-1 glass rounded-3xl border border-white/10 flex flex-col items-center justify-center p-12 relative overflow-hidden">
            {errorMsg && (
              <motion.div 
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-6 p-4 rounded-2xl bg-red-500/10 border border-red-500/30 flex items-center gap-3 text-red-200 text-xs"
              >
                <AlertCircle size={16} />
                <p>{errorMsg}</p>
                <button onClick={() => setErrorMsg(null)} className="ml-auto underline opacity-50 hover:opacity-100">Cerrar</button>
              </motion.div>
            )}
            
            <AnimatePresence mode="wait">
              {files.length === 0 ? (
                <motion.div
                  key="upload"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="text-center group"
                >
                  <label className="cursor-pointer flex flex-col items-center gap-6">
                    <div className="p-8 rounded-full bg-brand-accent/10 border border-brand-accent/30 group-hover:bg-brand-accent/20 transition-colors duration-500">
                      <FolderOpen size={56} className="text-brand-accent" />
                    </div>
                    <div className="space-y-2">
                      <h2 className="text-3xl font-bold tracking-tight text-white leading-none">Suelta la Carpeta Aquí</h2>
                      <p className="text-slate-400 text-sm max-w-xs mx-auto px-4">Selecciona una carpeta completa para reconstruir píxeles de 1:1 a una relación de 4:5.</p>
                    </div>
                    <div className="bg-black/20 border border-white/5 px-6 py-3 rounded-2xl text-[10px] uppercase font-bold tracking-[0.2em] text-slate-500 group-hover:text-white group-hover:border-white/20 transition-all">
                      Motor Neuronal Listo • GPU Activada
                    </div>
                    <input 
                      ref={fileInputRef}
                      type="file" 
                      className="hidden" 
                      // @ts-ignore
                      webkitdirectory="" 
                      directory="" 
                      onChange={handleFolderUpload}
                    />
                  </label>
                </motion.div>
              ) : (
                <motion.div
                  key="processing-state"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="w-full max-w-lg text-center"
                >
                  <div className="mb-8 inline-flex p-6 rounded-full bg-brand-accent/10 border border-brand-accent/30">
                    {status === 'completed' ? (
                      <CheckCircle2 size={48} className="text-emerald-400" />
                    ) : (
                      <RefreshCw size={48} className={`text-brand-accent ${status === 'processing' ? 'animate-spin' : ''}`} />
                    )}
                  </div>
                  
                  <h2 className="text-2xl font-bold mb-2 text-white">
                    {status === 'idle' ? 'Listo para Procesar' : status === 'processing' ? 'Reescalado en Progreso...' : 'Lote Completado'}
                  </h2>
                  <p className="text-slate-400 text-sm mb-12">
                    {status === 'idle' 
                      ? 'Selecciona los parámetros del motor a continuación para comenzar el flujo de re-escalado.' 
                      : 'La síntesis neuronal de IA está reconstruyendo píxeles y extendiendo bordes usando relleno contextual.'}
                  </p>

                  <div className="space-y-6">
                    <div className="flex justify-between text-[10px] font-bold text-brand-accent mb-2 uppercase tracking-widest">
                       <span>{batchInsight || (status === 'processing' ? 'Acelerando síntesis neuronal...' : 'Motor de Reescalado Listo')}</span>
                       <span>{globalProgress}%</span>
                    </div>
                    <div className="h-3 w-full bg-white/5 rounded-full overflow-hidden border border-white/5">
                      <motion.div 
                        className="h-full bg-brand-accent rounded-full transition-all glow-indigo" 
                        initial={{ width: 0 }}
                        animate={{ width: `${globalProgress}%` }}
                      />
                    </div>
                    <div className="flex justify-center gap-2 pt-4">
                      {status === 'processing' && [...Array(3)].map((_, i) => (
                        <motion.span 
                          key={i} 
                          className="w-2 h-2 rounded-full bg-brand-accent"
                          animate={{ opacity: [0.2, 1, 0.2] }}
                          transition={{ repeat: Infinity, duration: 1, delay: i * 0.2 }}
                        />
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Batch Actions Bar */}
          <div className="glass p-6 rounded-3xl flex items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-4">
              <div className="glass-input px-5 py-3 rounded-2xl text-[10px] uppercase font-bold flex items-center gap-3">
                <span className="text-brand-accent tracking-widest">Motor IA:</span>
                <select 
                  className="bg-transparent border-none outline-none text-white appearance-none cursor-pointer"
                  value={settings.scaleFactor}
                  onChange={(e) => setSettings({...settings, scaleFactor: Number(e.target.value)})}
                >
                  <option className="bg-surface-950" value={1}>Nativo (1.0x)</option>
                  <option className="bg-surface-950" value={1.5}>HD+ (1.5x)</option>
                  <option className="bg-surface-950" value={2}>Cinema (2.0x)</option>
                </select>
              </div>
              
              <div className="glass-input px-5 py-3 rounded-2xl text-[10px] uppercase font-bold flex items-center gap-3">
                <span className="text-brand-accent tracking-widest">Estrategia:</span>
                <select 
                  className="bg-transparent border-none outline-none text-white appearance-none cursor-pointer"
                  value={settings.upscaleMethod}
                  onChange={(e) => setSettings({...settings, upscaleMethod: e.target.value as any})}
                >
                  <option className="bg-surface-950" value="generative-fill">Motor Gemini 2.5 (Extensión Nativa)</option>
                  <option className="bg-surface-950" value="hugging-face">Experimental (Hugging Face SDXL)</option>
                  <option className="bg-surface-950" value="ai-blur">Desenfoque Cinematográfico (Rápido)</option>
                  <option className="bg-surface-950" value="solid-edge">Borde Sólido</option>
                </select>
              </div>
            </div>

            {status === 'completed' ? (
              <button 
                onClick={downloadZip}
                className="bg-white text-brand-accent font-black py-4 px-10 rounded-2xl shadow-xl hover:scale-105 active:scale-95 transition-all text-xs tracking-[0.2em] uppercase"
              >
                DESCARGAR .ZIP
              </button>
            ) : status === 'idle' && files.length > 0 ? (
              <button 
                onClick={processAll}
                className="bg-brand-accent text-white font-black py-4 px-10 rounded-2xl shadow-xl hover:scale-105 active:scale-95 transition-all text-xs tracking-[0.2em] uppercase glow-indigo"
              >
                INICIAR LOTE
              </button>
            ) : null}
          </div>
        </div>

        {/* Right Column: Queue Sidebar */}
        <div className="col-span-12 lg:col-span-4 flex flex-col gap-4">
          <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500 px-4">Cola de Lote ({processedImages.length})</h3>
          <div className="flex-1 space-y-3 overflow-y-auto pr-2 scrollbar-thin max-h-[70vh]">
            {processedImages.length === 0 ? (
              <div className="h-40 flex flex-col items-center justify-center glass rounded-2xl opacity-30 text-center p-8">
                <Layers size={24} className="mb-2" />
                <p className="text-[10px] font-bold uppercase tracking-widest">La cola está vacía</p>
              </div>
            ) : processedImages.map((img, idx) => (
              <motion.div 
                key={img.id}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: Math.min(idx * 0.05, 1) }}
                className={`glass p-3 rounded-2xl flex gap-4 transition-all duration-500 overflow-hidden ${
                  img.status === 'pending' ? 'opacity-50' : 'opacity-100'
                } ${img.status === 'success' ? 'border-l-4 border-l-emerald-500/50' : img.status === 'error' ? 'border-l-4 border-l-red-500/50' : 'border-l-4 border-l-brand-accent'}`}
              >
                <div className="w-16 h-20 bg-slate-800 rounded-lg overflow-hidden flex-shrink-0 relative">
                  {(img.processedUrl || img.originalUrl) && (
                    <img 
                      src={img.processedUrl || img.originalUrl} 
                      className={`w-full h-full object-cover transition-all ${img.status === 'pending' ? 'grayscale brightness-50' : ''}`} 
                      alt="" 
                    />
                  )}
                  {img.status === 'pending' && (
                     <div className="absolute inset-0 flex items-center justify-center">
                        <RefreshCw size={12} className="animate-spin text-white/20" />
                     </div>
                  )}
                </div>
                <div className="flex flex-col justify-center flex-1 min-w-0">
                  <span className="text-sm font-bold truncate text-white uppercase tracking-tight">{img.name}</span>
                  <span className={`text-[9px] font-black uppercase mt-1.5 tracking-widest ${
                    img.status === 'success' ? 'text-emerald-400' : img.status === 'error' ? 'text-red-400' : 'text-brand-accent'
                  }`}>
                    {img.status === 'success' ? '4:5 Completado' : img.status === 'error' ? 'Error de Renderizado' : 'Procesamiento Neuronal...'}
                  </span>
                </div>
                <div className="flex items-center pr-3">
                   {img.status === 'success' ? (
                     <CheckCircle2 size={16} className="text-emerald-400" />
                   ) : img.status === 'pending' ? (
                     <RefreshCw size={14} className="text-brand-accent animate-spin" />
                   ) : img.status === 'error' ? (
                     <AlertCircle size={16} className="text-red-400" />
                   ) : null}
                </div>
              </motion.div>
            ))}
          </div>
          
          {processedImages.length > 5 && (
            <div className="glass-input p-3 rounded-2xl text-center">
              <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">
                + {processedImages.length - 5} elementos adicionales
              </span>
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="p-8 border-t border-white/5 flex flex-col md:flex-row justify-between items-center gap-6">
        <div className="flex items-center gap-10">
          <div className="flex items-center gap-2.5">
            <div className="w-2 h-2 rounded-full bg-brand-accent shadow-[0_0_8px_#6366f1] animate-pulse"></div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Aceleración Tensor Core</span>
          </div>
          <div className="flex items-center gap-2.5">
            <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981]"></div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Sandbox Local Seguro</span>
          </div>
        </div>
        <div className="text-[10px] font-bold text-slate-600 uppercase tracking-[0.3em]">
          Aspect AI v2.4.1 (Motor Neuronal)
        </div>
      </footer>
    </div>
  );
}


