import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as storage from "../services/storage.js";
import { notifyDocUpdated } from "../services/slack.js";

const CATEGORY = z.enum([
  "runbook", "architecture", "onboarding", "incident",
  "devops", "api", "process", "general",
]);

/** Same tools as self-hosted but every storage call is scoped to workspaceId. */
export function registerCloudTools(server: McpServer, workspaceId: string) {
  server.tool("list_docs", "List all docs, optionally filter by category.", {
    category: CATEGORY.optional(),
  }, async ({ category }) => {
    const docs = await storage.listDocs(category, workspaceId);
    return { content: [{ type: "text", text: JSON.stringify(docs, null, 2) }] };
  });

  server.tool("get_doc", "Retrieve full content of a doc by path.", {
    path: z.string(),
  }, async ({ path }) => {
    const doc = await storage.getDoc(path, workspaceId);
    return {
      content: [{
        type: "text",
        text: `# ${doc.meta.title}\n\n**Category:** ${doc.meta.category}\n**Tags:** ${doc.meta.tags.join(", ")}\n**Updated:** ${doc.meta.updatedAt} by ${doc.meta.updatedBy}\n\n---\n\n${doc.content}`,
      }],
    };
  });

  server.tool("search_docs", "Keyword search across titles, tags, and content.", {
    query: z.string(),
  }, async ({ query }) => {
    const results = await storage.searchDocs(query, workspaceId);
    if (results.length === 0) return { content: [{ type: "text", text: "No documents found." }] };
    return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
  });

  server.tool("save_doc", "Save a documentation file. Pass the final content — the AI agent calling this tool is responsible for writing good content.", {
    path: z.string().describe("Relative path, e.g. devops/k8s-setup.md"),
    title: z.string(),
    category: CATEGORY,
    tags: z.array(z.string()).default([]),
    content: z.string().describe("Full markdown content to save"),
    author: z.string().describe("Who is saving this doc"),
    change_summary: z.string().describe("One-line summary of what changed, sent to Slack"),
  }, async ({ path, title, category, tags, content, author, change_summary }) => {
    const isNew = await storage.getDoc(path, workspaceId).then(() => false).catch(() => true);
    const doc = await storage.saveDoc(path, content, { title, category, tags }, author, workspaceId);
    await notifyDocUpdated(path, doc.meta.title, author, change_summary, isNew ? "created" : "updated");
    return { content: [{ type: "text", text: `Saved \`${path}\`` }] };
  });

  server.tool("delete_doc", "Delete a doc.", {
    path: z.string(),
    author: z.string(),
  }, async ({ path, author }) => {
    const existing = await storage.getDoc(path, workspaceId);
    await storage.deleteDoc(path, workspaceId);
    await notifyDocUpdated(path, existing.meta.title, author, "", "deleted");
    return { content: [{ type: "text", text: `Deleted \`${path}\`` }] };
  });

  server.tool("get_runbook", "Fetch runbook by service name.", {
    service: z.string(),
  }, async ({ service }) => {
    const results = await storage.searchDocs(service, workspaceId);
    const runbooks = results.filter((d) => d.category === "runbook" || d.tags.includes("runbook"));
    if (runbooks.length === 0) return { content: [{ type: "text", text: `No runbook found for "${service}".` }] };
    const doc = await storage.getDoc(runbooks[0].path, workspaceId);
    return { content: [{ type: "text", text: `## Runbook: ${doc.meta.title}\n\n${doc.content}` }] };
  });

  server.tool("get_devops_context", "Load all DevOps, architecture, and runbook summaries.", {}, async () => {
    const [devops, arch, runbooks] = await Promise.all([
      storage.listDocs("devops", workspaceId),
      storage.listDocs("architecture", workspaceId),
      storage.listDocs("runbook", workspaceId),
    ]);
    const all = [...devops, ...arch, ...runbooks];
    if (all.length === 0) return { content: [{ type: "text", text: "No DevOps docs found." }] };
    const lines = all.map((d) => `- [${d.category}] **${d.title}** (\`${d.path}\`)`);
    return { content: [{ type: "text", text: `## DevOps Docs\n\n${lines.join("\n")}\n\nUse \`get_doc\` to read a specific document.` }] };
  });
}
