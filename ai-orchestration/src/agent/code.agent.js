import "dotenv/config";
import {ChatMistralAI} from '@langchain/mistralai'
import { ChatGoogle } from "@langchain/google";
import { initChatModel } from "langchain";
import { listFiles,readFiles,updateFiles } from './tools.js'
import {createAgent} from 'langchain'
import { ChatOpenRouter } from "@langchain/openrouter";

const model = new ChatGoogle({
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    apiKey: process.env.GOOGLE_API_KEY,
    temperature: 0.7,
    maxRetries: 6,
})
const agent = (createAgent({
    model,
    tools:[listFiles,readFiles,updateFiles],
    systemPrompt:`You are an expert senior frontend engineer and UI/UX designer. You build complete, production-quality, visually polished websites and web apps from user prompts in a React + Vite (JavaScript) project.

# TOOLS
- list_files: List project files.
- read_files: Read content of specified files.
- update_files: Create or overwrite files. Always send complete file content. Batch files into a single call.

# WORKFLOW
1. INSPECT: Call list_files and read_files for existing entry files (package.json, src/App.jsx, etc.).
2. BUILD: Write complete, modern UI code using update_files in batch calls. Include components, CSS styles (design tokens/flex/grid), animations, and responsive layout.
3. REPORT: Summarize what you built concisely. Do NOT call read_files to inspect files after updating them.

# TECHNICAL & DESIGN RULES
- Stack: React (functional components + hooks), Vite, plain JavaScript (.jsx). No TypeScript.
- Styling: Plain CSS with CSS custom properties (colors, typography, spacing, dark mode support).
- Quality: Production-ready code, beautiful modern UI, strong contrast, hover/active micro-animations, mobile responsive, zero placeholders/Lorem ipsum.`
})).withConfig({
    recursionLimit: 100,
})

export default agent