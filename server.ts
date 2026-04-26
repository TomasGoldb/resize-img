import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { HfInference } from "@huggingface/inference";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // API health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Hugging Face Proxy with per-route body parsing
  app.post("/api/hf-proxy", express.raw({ type: "*/*", limit: "50mb" }), async (req, res) => {
    const hfToken = (req.headers['x-hf-token'] as string) || process.env.VITE_HF_API_TOKEN;
    const modelId = (req.headers['x-model-id'] as string) || "runwayml/stable-diffusion-v1-5";
    const prompt = (req.headers['x-hf-prompt'] as string) || "Professional high-resolution photograph, highly detailed, extending background";

    console.log(`[HF Proxy] Request for model: ${modelId}`);
    
    if (!hfToken) {
      console.error("[HF Proxy] Missing HF Token");
      return res.status(401).json({ error: "Missing Hugging Face API Token. Please configure VITE_HF_API_TOKEN in your settings." });
    }

    const hf = new HfInference(hfToken);
    
    try {
      const bodyBuffer = Buffer.isBuffer(req.body) ? (req.body as Buffer) : Buffer.alloc(0);
      
      if (bodyBuffer.length === 0) {
        return res.status(400).json({ error: "No image data provided" });
      }

      console.log(`[HF Proxy] Calling SDK for ${modelId} (${bodyBuffer.length} bytes)`);
      
      let result;
      // Stable Diffusion 3.5 Large might be better handled via generic request depending on the endpoint configuration
      // but imageToImage is the standard for extension tasks.
      try {
        result = await hf.imageToImage({
          model: modelId,
          inputs: new Blob([bodyBuffer]),
          parameters: {
            prompt: prompt,
            // @ts-ignore
            negative_prompt: "blurry, low quality, distorted, bad anatomy, borders, frames",
            strength: 0.8,
          },
        });
      } catch (e: any) {
        console.log("[HF Proxy] imageToImage failed, attempting generic request...");
        result = await hf.request({
          model: modelId,
          data: bodyBuffer,
          method: "POST",
          headers: {
            "x-wait-for-model": "true"
          }
        });
      }

      const resultBuffer = await (result as any).arrayBuffer();
      res.setHeader("Content-Type", "image/jpeg");
      console.log("[HF Proxy] Success, returning image");
      res.send(Buffer.from(resultBuffer));

    } catch (error: any) {
      console.error("[HF Proxy] Request error:", error.message);
      
      // Check for specific HF errors
      if (error.message.includes("is currently loading")) {
        return res.status(503).json({ error: "El modelo se está cargando en Hugging Face. Por favor, reintenta en unos segundos." });
      }
      
      res.status(error.response?.status || 500).json({ 
        error: error.message || "Error interno al procesar la imagen con IA" 
      });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    console.log("[Server] Starting Vite in middleware mode");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
