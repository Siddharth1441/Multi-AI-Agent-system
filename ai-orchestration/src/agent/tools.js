import axios from "axios";
import { tool } from "langchain";
import * as z from "zod";

function getSandboxAgentUrl(config) {
  if (process.env.SANDBOX_AGENT_URL) {
    return process.env.SANDBOX_AGENT_URL.replace(/\/+$/, "");
  }
  const projectId =
    config?.context?.projectId ||
    config?.configurable?.projectId ||
    config?.configurable?.context?.projectId;

  if (!projectId) {
    throw new Error("projectId is missing in tool execution config");
  }

  return `http://${projectId}.agent.localhost`;
}

export const listFiles = tool(
  async ({}, config) => {
    try {
      const writer = config.writer

      writer("Listing files in the project...\n");
      const sandboxAgentUrl = getSandboxAgentUrl(config);
      const response = await axios.get(`${sandboxAgentUrl}/list-files`, { timeout: 10000 });
      writer('files listed successfully'+"Files:"+response.data?.files.join(",")+"\n");
      return JSON.stringify(response.data?.files || []);
    } catch (err) {
      return `Error listing files: ${err.message}`;
    }
  },
  {
    name: "list_files",
    description: "List relative paths of all project files.",
    schema: z.object({}),
  },
);

export const readFiles = tool(
  async ({ files = [] }, config) => {
    if (!files || !files.length) return "No files specified.";
    const writer = config.writer
    try {
      const sandboxAgentUrl = getSandboxAgentUrl(config);
      const response = await axios.get(
        `${sandboxAgentUrl}/read-files?files=${encodeURIComponent(files.join(","))}`,
        { timeout: 15000 }
      );
      writer("Reading file contents..."+files.join(",")+"\n");
      const contents = {};
      if (Array.isArray(response.data?.results)) {
        for (const item of response.data.results) {
          Object.assign(contents, item);
        }
      }
      writer('files read successfully\n');
      return JSON.stringify(contents);
    } catch (err) {
      return `Error reading files: ${err.message}`;
    }
  },
  {
    name: "read_files",
    description: "Read contents of specified files.",
    schema: z.object({
      files: z.array(z.string()).describe("Paths of files to read"),
    }),
  },
);

export const updateFiles = tool(
  async ({ files = [] }, config) => {
    const writer = config.writer;
    
    if (!files || !files.length) return "No files provided for update.";
    try {
      writer("Updating files in the project..."+files.map(f => f.file).join(",")+"\n");
      const sandboxAgentUrl = getSandboxAgentUrl(config);
      const response = await axios.patch(
        `${sandboxAgentUrl}/update-file`,
        { updates: files },
        { timeout: 30000 }
      );
      
      const updatedFiles = files.map((f) => f.file);
      return `Successfully updated ${updatedFiles.length} file(s): ${updatedFiles.join(", ")}`;
      writer('files updated successfully\n');
    } catch (err) {
      return `Error updating files: ${err.message}`;
    }
  },
  {
    name: "update_files",
    description: "Create or overwrite files with complete code content.",
    schema: z.object({
      files: z
        .array(
          z.object({
            file: z.string().describe("File path"),
            content: z.string().describe("Full content to write"),
          }),
        )
        .describe("Files to update or create"),
    }),
  },
);

