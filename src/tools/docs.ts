import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as storage from "../services/storage.js";
import { improveDoc, summarizeChange } from "../services/ai.js";
import { notifyDocUpdated } from "../services/slack.js";

export function registerDocTools(server: McpServer) {
  // ── list_docs ──────────────────────────────────────────────────────────────
  server.tool(
    "list_docs",
    "List all documentation files. Optionally filter by category.",
    {
      category: z
        .enum(["runbook", "architecture", "onboarding", "incident", "devops", "api", "process", "general"])
        .optional()
        .describe("Filter by category"),
    },
    async ({ category }) => {
      const docs = await storage.listDocs(category);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(docs, null, 2),
          },
        ],
      };
    }
  );

  // ── get_doc ────────────────────────────────────────────────────────────────
  server.tool(
    "get_doc",
    "Retrieve the full content of a documentation file by its path.",
    {
      path: z.string().describe("Relative path to the doc, e.g. devops/deploy.md"),
    },
    async ({ path }) => {
      const doc = await storage.getDoc(path);
      return {
        content: [
          {
            type: "text",
            text: `# ${doc.meta.title}\n\n**Category:** ${doc.meta.category}\n**Tags:** ${doc.meta.tags.join(", ")}\n**Last updated:** ${doc.meta.updatedAt} by ${doc.meta.updatedBy}\n\n---\n\n${doc.content}`,
          },
        ],
      };
    }
  );

  // ── search_docs ────────────────────────────────────────────────────────────
  server.tool(
    "search_docs",
    "Search documentation by keyword. Searches titles, tags, categories, and content.",
    {
      query: z.string().describe("Search query"),
    },
    async ({ query }) => {
      const results = await storage.searchDocs(query);
      if (results.length === 0) {
        return { content: [{ type: "text", text: "No documents found matching your query." }] };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
      };
    }
  );

  // ── create_doc ─────────────────────────────────────────────────────────────
  server.tool(
    "create_doc",
    "Create a new documentation file. AI will polish the content before saving.",
    {
      path: z.string().describe("Relative path, e.g. devops/k8s-setup.md"),
      title: z.string().describe("Document title"),
      category: z
        .enum(["runbook", "architecture", "onboarding", "incident", "devops", "api", "process", "general"])
        .describe("Document category"),
      tags: z.array(z.string()).default([]).describe("Tags for searchability"),
      content: z.string().describe("Initial markdown content"),
      author: z.string().describe("Name or identifier of who is creating this doc"),
    },
    async ({ path, title, category, tags, content, author }) => {
      const improved = await improveDoc("", `Create a new document titled "${title}":\n\n${content}`, title);
      const doc = await storage.saveDoc(path, improved, { title, category, tags }, author);

      await notifyDocUpdated(path, title, author, `New documentation created: ${title}`, "created");

      return {
        content: [{ type: "text", text: `Created doc at \`${doc.path}\`\n\n${improved}` }],
      };
    }
  );

  // ── update_doc ─────────────────────────────────────────────────────────────
  server.tool(
    "update_doc",
    "Update an existing doc. Describe the change and AI will apply it, then notify Slack.",
    {
      path: z.string().describe("Path to the doc to update"),
      change_description: z
        .string()
        .describe("Describe what changed, e.g. 'Updated deploy steps for k8s 1.30, removed deprecated flags'"),
      author: z.string().describe("Name or identifier of who is making this change"),
      meta: z
        .object({
          title: z.string().optional(),
          category: z
            .enum(["runbook", "architecture", "onboarding", "incident", "devops", "api", "process", "general"])
            .optional(),
          tags: z.array(z.string()).optional(),
        })
        .optional()
        .describe("Optional metadata overrides"),
    },
    async ({ path, change_description, author, meta }) => {
      const existing = await storage.getDoc(path);
      const updated = await improveDoc(existing.content, change_description, existing.meta.title);
      const summary = await summarizeChange(existing.content, updated, existing.meta.title);

      const doc = await storage.saveDoc(path, updated, meta ?? {}, author);
      await notifyDocUpdated(path, doc.meta.title, author, summary, "updated");

      return {
        content: [
          {
            type: "text",
            text: `Updated \`${path}\`\n\n**Change summary:** ${summary}\n\n---\n\n${updated}`,
          },
        ],
      };
    }
  );

  // ── delete_doc ─────────────────────────────────────────────────────────────
  server.tool(
    "delete_doc",
    "Delete a documentation file.",
    {
      path: z.string().describe("Path to the doc to delete"),
      author: z.string().describe("Name or identifier of who is deleting this doc"),
    },
    async ({ path, author }) => {
      const existing = await storage.getDoc(path);
      await storage.deleteDoc(path);
      await notifyDocUpdated(path, existing.meta.title, author, "", "deleted");
      return { content: [{ type: "text", text: `Deleted \`${path}\`` }] };
    }
  );
}
