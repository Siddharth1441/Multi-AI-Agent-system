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

  return `http://sandbox-service-${projectId}:3000`;
}

function getProgressWriter(config) {
  const writer = config?.context?.writer || config?.writer;
  return typeof writer === "function" ? writer : null;
}

export const listFiles = tool(
  async ({}, config) => {
    try {
      const writer = getProgressWriter(config);
      writer?.("Listing files in the project...\n");
      const sandboxAgentUrl = getSandboxAgentUrl(config);
      const response = await axios.get(`${sandboxAgentUrl}/list-files`, { timeout: 10000 });
      writer?.("Files listed successfully: " + (response.data?.files || []).join(",") + "\n");
      return JSON.stringify(response.data?.files || []);
    } catch (err) {
      throw new Error(`Could not list sandbox files: ${err.message}`, { cause: err });
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
    const writer = getProgressWriter(config);
    try {
      const sandboxAgentUrl = getSandboxAgentUrl(config);
      const response = await axios.get(
        `${sandboxAgentUrl}/read-files?files=${encodeURIComponent(files.join(","))}`,
        { timeout: 15000 }
      );
      writer?.("Reading file contents: " + files.join(",") + "\n");
      const contents = {};
      if (Array.isArray(response.data?.results)) {
        for (const item of response.data.results) {
          if (Object.values(item).some((value) => String(value).startsWith("Error reading file:"))) {
            throw new Error(`Sandbox could not read requested files: ${JSON.stringify(item)}`);
          }
          Object.assign(contents, item);
        }
      } else {
        throw new Error("Sandbox returned an invalid file-read response");
      }
      writer?.("Files read successfully\n");
      return JSON.stringify(contents);
    } catch (err) {
      throw new Error(`Could not read sandbox files: ${err.message}`, { cause: err });
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
    const writer = getProgressWriter(config);
    
    if (!files || !files.length) return "No files provided for update.";
    try {
      writer?.("Updating files in the project: " + files.map(f => f.file).join(",") + "\n");
      const sandboxAgentUrl = getSandboxAgentUrl(config);
      const response = await axios.patch(
        `${sandboxAgentUrl}/update-file`,
        { updates: files },
        { timeout: 30000 }
      );
      const results = response.data?.results;
      if (!Array.isArray(results) || results.length !== files.length) {
        throw new Error("Sandbox returned an incomplete file-update response");
      }
      const failures = results.filter((result) =>
        Object.values(result).some((value) => String(value).toLowerCase().startsWith("error"))
      );
      if (failures.length) {
        throw new Error(`Sandbox failed to update files: ${JSON.stringify(failures)}`);
      }
      const updatedFiles = files.map((f) => f.file);
      return `Successfully updated ${updatedFiles.length} file(s): ${updatedFiles.join(", ")}`;
    } catch (err) {
      throw new Error(`Could not update sandbox files: ${err.message}`, { cause: err });
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
