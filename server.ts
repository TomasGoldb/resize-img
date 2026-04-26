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
    console.log(`[HF Proxy] Request received for model: ${req.headers['x-model-id']}`);
    
    const hfToken = req.headers['x-hf-token'] as string;
    const modelId = (req.headers['x-model-id'] as string) || "black-forest-labs/FLUX.1-schnell";

    if (!hfToken) {
      console.error("[HF Proxy] Missing HF Token");
      return res.status(400).json({ error: "Missing VITE_HF_API_TOKEN" });
    }

    const hf = new HfInference(hfToken);
    
    try {
      const bodyBuffer = Buffer.isBuffer(req.body) ? (req.body as Buffer) : Buffer.alloc(0);
      
      if (bodyBuffer.length === 0) {
        console.error("[HF Proxy] Empty body");
        return res.status(400).json({ error: "No image data provided" });
      }

      console.log(`[HF Proxy] Using SDK to call HF API for ${modelId} (${bodyBuffer.length} bytes)`);
      
      const task = (req.headers['x-hf-task'] as string) || "image-to-image";
      const prompt = (req.headers['x-hf-prompt'] as string) || "Professional photograph, high quality, detailed";
      const provider = req.headers['x-hf-provider'] as string;

      let result;
      
      // If it's image-to-image, use the specialized method which is more reliable
      if (task === "image-to-image") {
        console.log(`[HF Proxy] Specialized imageToImage call with prompt: "${prompt}"`);
        result = await hf.imageToImage({
          model: modelId,
          inputs: new Blob([bodyBuffer]),
          parameters: {
            prompt: prompt,
          },
          // @ts-ignore
          provider: provider || undefined,
        });
      } else {
        // Fallback to generic request
        result = await hf.request({
          model: modelId,
          data: bodyBuffer,
          method: "POST",
          // @ts-ignore
          task: task,
          // @ts-ignore
          provider: provider || undefined,
        });
      }

      // The result from SDK request for image models is typically a Blob or similar
      const resultBuffer = await (result as any).arrayBuffer();
      res.setHeader("Content-Type", "image/jpeg");
      console.log("[HF Proxy] Success, returning image");
      res.send(Buffer.from(resultBuffer));

    } catch (error: any) {
      console.error("[HF Proxy] SDK error:", error.message);
      // Try to parse the error message if it's JSON
      res.status(error.response?.status || 500).json({ 
        error: error.message || "Internal server error" 
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
