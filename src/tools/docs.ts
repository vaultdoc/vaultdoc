import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as storage from "../services/storage.js";
import { notifyDocUpdated } from "../services/slack.js";

const CATEGORY = z.enum(["runbook", "architecture", "onboarding", "incident", "devops", "api", "process", "general"]);

export function registerDocTools(server: McpServer) {
  server.tool(
    "list_docs",
    "List all documentation files. Optionally filter by category.",
    { category: CATEGORY.optional() },
    async ({ category }) => {
      const docs = await storage.listDocs(category);
      return { content: [{ type: "text", text: JSON.stringify(docs, null, 2) }] };
    }
  );

  server.tool(
    "get_doc",
    "Retrieve the full content of a documentation file by its path.",
    { path: z.string().describe("Relative path, e.g. devops/deploy.md") },
    async ({ path }) => {
      const doc = await storage.getDoc(path);
      return {
        content: [{
          type: "text",
          text: `# ${doc.meta.title}\n\n**Category:** ${doc.meta.category}\n**Tags:** ${doc.meta.tags.join(", ")}\n**Last updated:** ${doc.meta.updatedAt} by ${doc.meta.updatedBy}\n\n---\n\n${doc.content}`,
        }],
      };
    }
  );

  server.tool(
    "search_docs",
    "Search documentation by keyword. Searches titles, tags, categories, and content.",
    { query: z.string() },
    async ({ query }) => {
      const results = await storage.searchDocs(query);
      if (results.length === 0) return { content: [{ type: "text", text: "No documents found." }] };
      return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
    }
  );

  server.tool(
    "save_doc",
    "Save a documentation file. Pass the final content — the AI agent calling this tool is responsible for writing good content.",
    {
      path: z.string().describe("Relative path, e.g. devops/k8s-setup.md"),
      title: z.string(),
      category: CATEGORY,
      tags: z.array(z.string()).default([]),
      content: z.string().describe("Full markdown content to save"),
      author: z.string().describe("Who is saving this doc"),
      change_summary: z.string().describe("One-line summary of what changed, sent to Slack"),
    },
    async ({ path, title, category, tags, content, author, change_summary }) => {
      const isNew = await storage.getDoc(path).then(() => false).catch(() => true);
      const doc = await storage.saveDoc(path, content, { title, category, tags }, author);
      await notifyDocUpdated(path, doc.meta.title, author, change_summary, isNew ? "created" : "updated");
      return { content: [{ type: "text", text: `Saved \`${path}\`` }] };
    }
  );

  server.tool(
    "delete_doc",
    "Delete a documentation file.",
    {
      path: z.string(),
      author: z.string(),
    },
    async ({ path, author }) => {
      const existing = await storage.getDoc(path);
      await storage.deleteDoc(path);
      await notifyDocUpdated(path, existing.meta.title, author, "", "deleted");
      return { content: [{ type: "text", text: `Deleted \`${path}\`` }] };
    }
  );
}
