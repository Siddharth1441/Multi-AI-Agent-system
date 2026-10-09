import "dotenv/config";
import { ChatGoogle } from "@langchain/google";
import { createAgent } from "langchain";
import { listFiles, readFiles, updateFiles } from "./tools.js";

if (!process.env.GOOGLE_API_KEY) {
  throw new Error("GOOGLE_API_KEY is required to run the AI agent");
}

const model = new ChatGoogle({
  model: process.env.GEMINI_MODEL || "gemini-3.5-flash-lite",
  apiKey: process.env.GOOGLE_API_KEY,
  temperature: 0.3,
  maxRetries: 3,
});

const agent = createAgent({
  model,
  tools: [listFiles, readFiles, updateFiles],
  systemPrompt: `You are a senior frontend engineer building and improving polished websites in the user's existing project.

Use the available tools deliberately:
1. Call list_files to understand the project structure.
2. Call read_files for the files relevant to the user's request before changing them.
3. Use update_files to create or overwrite all required files. Supply complete file contents and batch related updates into as few calls as practical.
4. Report what you changed briefly. Never claim that files were changed unless update_files succeeded.

Follow the project's existing framework, language, conventions, and dependencies. Prefer focused changes, preserve unrelated behavior, and do not edit dependency manifests or project configuration unless the request requires it. For React and Vite projects, use the existing JavaScript/JSX and styling approach, build responsive accessible interfaces, and avoid placeholder content. You may update any project files needed for the requested task; do not limit changes to a fixed set of entry files.`,
}).withConfig({
  recursionLimit: 100,
});

function getMessageText(message) {
  if (typeof message?.content === "string") return message.content;
  if (Array.isArray(message?.content)) {
    return message.content
      .filter((part) => typeof part?.text === "string")
      .map((part) => part.text)
      .join("\n");
  }
  return "";
}

export async function buildWebsite({ message, projectId, onProgress = () => {} }) {
  const result = await agent.invoke(
    { messages: [{ role: "user", content: message }] },
    {
      context: { projectId, writer: onProgress },
    },
  );

  const messages = result.messages || [];
  const updatedFiles = messages
    .filter((item) => item.name === "update_files" && item.status !== "error")
    .flatMap((item) => {
      const content = typeof item.content === "string" ? item.content : "";
      const match = content.match(/Successfully updated \d+ file\(s\):\s*(.+)/);
      return match ? match[1].split(",").map((file) => file.trim()).filter(Boolean) : [];
    });
  const finalMessage = [...messages].reverse().find((item) => {
    const type = item._getType?.();
    return (type === "ai" || item.role === "assistant") && !item.tool_calls?.length;
  });
  const response = getMessageText(finalMessage);

  if (!response && !updatedFiles.length) {
    throw new Error("The agent completed without a response or successful file updates.");
  }

  return {
    files: [...new Set(updatedFiles)],
    response,
  };
}
