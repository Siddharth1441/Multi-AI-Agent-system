import { Router } from "express";
import { buildWebsite } from "../agent/code.agent.js";

const agentRouter = Router();

agentRouter.post("/invoke", async (req, res) => {
  try {
    const { message, projectId } = req.body;
    if (typeof message !== "string" || !message.trim() || typeof projectId !== "string" || !projectId.trim()) {
      return res.status(400).json({ error: "message and projectId are required" });
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const heartbeat = setInterval(() => {
      res.write(": generation in progress\n\n");
    }, 15_000);

    res.on("close", () => clearInterval(heartbeat));

    const result = await buildWebsite({
      message: message.trim(),
      projectId: projectId.trim(),
      onProgress: (progress) => {
        if (!res.writableEnded && !res.destroyed) {
          res.write(`data: ${JSON.stringify(progress)}\n\n`);
        }
      },
    });
    clearInterval(heartbeat);
    res.write(`event: done\ndata: ${JSON.stringify(result)}\n\n`);
    res.end();
  } catch (err) {
    console.error("Agent execution error:", err);
    const isRateLimit = err.message?.includes("Quota exceeded") || err.status === 429;
    const payload = {
      error: err.message,
      isRateLimit,
      retryAfterSeconds: isRateLimit ? 35 : undefined,
    };
    if (res.headersSent) {
      res.write(`event: error\ndata: ${JSON.stringify(payload)}\n\n`);
      return res.end();
    }
    return res.status(isRateLimit ? 429 : 500).json(payload);
  }
});

export default agentRouter;
