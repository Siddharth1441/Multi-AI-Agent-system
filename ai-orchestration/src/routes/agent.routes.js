import { Router } from "express";
import agent from "../agent/code.agent.js";

const agentRouter = Router();

agentRouter.post("/invoke", async (req, res) => {
  try {
    const { message, projectId } = req.body;
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });
    const response = await agent.stream(
      {
        messages: [{ role: "user", content: message }],
        context: {
          projectId,
        },
      },
      {
        configurable: {
          projectId,
        },
        context: {
          projectId,
        },
        streamMode:"custom"
      }
    );
    for await (const chunk of response) {
        console.log(chunk)
        res.write(`data:${chunk}\n\n`);
      }
    res.json({ response });
  } catch (err) {
    console.error("Agent execution error:", err);
    const isRateLimit = err.message?.includes("Quota exceeded") || err.status === 429;
    res.status(isRateLimit ? 429 : 500).json({
      error: err.message,
      isRateLimit,
      retryAfterSeconds: isRateLimit ? 35 : undefined,
    });
  }
});

export default agentRouter;
