import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as storage from "../services/storage.js";

/**
 * DevOps-specific convenience tools that wrap the generic doc tools
 * with better context for on-call / incident / deployment scenarios.
 */
export function registerDevOpsTools(server: McpServer) {
  // ── get_runbook ────────────────────────────────────────────────────────────
  server.tool(
    "get_runbook",
    "Retrieve a runbook by service or incident type. Use during incidents.",
    {
      service: z.string().describe("Service name, e.g. 'api-gateway', 'postgres', 'redis'"),
    },
    async ({ service }) => {
      const results = await storage.searchDocs(service);
      const runbooks = results.filter(
        (d) => d.category === "runbook" || d.tags.includes("runbook")
      );

      if (runbooks.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No runbook found for "${service}". Consider creating one with save_doc.`,
            },
          ],
        };
      }

      // Return the most recently updated one
      const best = runbooks[0];
      const doc = await storage.getDoc(best.path);
      return {
        content: [
          {
            type: "text",
            text: `## Runbook: ${doc.meta.title}\n\n${doc.content}`,
          },
        ],
      };
    }
  );

  // ── list_runbooks ──────────────────────────────────────────────────────────
  server.tool(
    "list_runbooks",
    "List all runbooks available for on-call and incident response.",
    {},
    async () => {
      const docs = await storage.listDocs("runbook");
      return {
        content: [{ type: "text", text: JSON.stringify(docs, null, 2) }],
      };
    }
  );

  // ── get_devops_context ─────────────────────────────────────────────────────
  server.tool(
    "get_devops_context",
    "Get all DevOps-related documentation (architecture, runbooks, deploy processes) as context before making infrastructure changes.",
    {},
    async () => {
      const [devops, arch, runbooks] = await Promise.all([
        storage.listDocs("devops"),
        storage.listDocs("architecture"),
        storage.listDocs("runbook"),
      ]);

      const all = [...devops, ...arch, ...runbooks];
      if (all.length === 0) {
        return { content: [{ type: "text", text: "No DevOps documentation found." }] };
      }

      const lines = all.map(
        (d) => `- [${d.category}] **${d.title}** (\`${d.path}\`) — tags: ${d.tags.join(", ") || "none"}`
      );

      return {
        content: [
          {
            type: "text",
            text: `## Available DevOps Documentation\n\n${lines.join("\n")}\n\nUse \`get_doc\` with a path to read a specific document.`,
          },
        ],
      };
    }
  );

  // ── get_incident_docs ──────────────────────────────────────────────────────
  server.tool(
    "get_incident_docs",
    "Retrieve all incident post-mortems and incident-related documentation.",
    {},
    async () => {
      const docs = await storage.listDocs("incident");
      return {
        content: [{ type: "text", text: JSON.stringify(docs, null, 2) }],
      };
    }
  );
}
