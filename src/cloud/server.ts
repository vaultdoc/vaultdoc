import "node:process";
import express from "express";
import rateLimit from "express-rate-limit";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { jwtAuth, issueToken } from "./auth.js";
import { registerCloudTools } from "./mcpTools.js";
import { createWorkspace, getWorkspace, listWorkspaces, deleteWorkspace } from "./workspaces.js";
import { adminKeyAuth } from "../middleware/auth.js";
import { ensureDocsDir } from "../services/storage.js";

const PORT = parseInt(process.env.PORT ?? "3000", 10);

async function main() {
  await ensureDocsDir();

  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "4mb" }));

  app.use(rateLimit({ windowMs: 60_000, max: 100, standardHeaders: true, legacyHeaders: false }));

  app.get("/health", (_req, res) => res.json({ status: "ok", mode: "cloud", uptime: process.uptime() }));

  // ── Workspace management (admin only) ─────────────────────────────────────
  app.get("/admin/workspaces", adminKeyAuth, async (_req, res) => {
    res.json(await listWorkspaces());
  });

  app.post("/admin/workspaces", adminKeyAuth, async (req, res) => {
    const { name, ownerId } = req.body as { name?: string; ownerId?: string };
    if (!name || !ownerId) { res.status(400).json({ error: "Body must include { name, ownerId }" }); return; }
    const workspace = await createWorkspace(name, ownerId);
    res.status(201).json(workspace);
  });

  app.delete("/admin/workspaces/:id", adminKeyAuth, async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const removed = await deleteWorkspace(id);
    if (!removed) { res.status(404).json({ error: "Workspace not found" }); return; }
    res.json({ message: `Workspace ${id} deleted` });
  });

  // ── Token issuance (admin issues tokens for workspace members) ─────────────
  // In a full SaaS this would be driven by OAuth callback. For now, admin issues tokens.
  app.post("/admin/tokens", adminKeyAuth, async (req, res) => {
    const { workspaceId, userId, role } = req.body as {
      workspaceId?: string;
      userId?: string;
      role?: "owner" | "member";
    };
    if (!workspaceId || !userId || !role) {
      res.status(400).json({ error: "Body must include { workspaceId, userId, role }" });
      return;
    }
    const workspace = await getWorkspace(workspaceId);
    if (!workspace) { res.status(404).json({ error: "Workspace not found" }); return; }

    const token = issueToken({ workspaceId, userId, role });
    res.status(201).json({ token });
  });

  // ── MCP endpoint — JWT scoped to workspace ─────────────────────────────────
  app.post("/mcp", jwtAuth, async (req, res) => {
    const { workspaceId } = req.workspace!;

    const workspace = await getWorkspace(workspaceId);
    if (!workspace) { res.status(403).json({ error: "Workspace not found" }); return; }

    const server = new McpServer({ name: "vaultdoc-cloud", version: "0.1.0" });
    registerCloudTools(server, workspaceId);

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    res.on("close", () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`vaultdoc cloud listening on :${PORT}`);
    console.log(`  JWT secret : ${process.env.JWT_SECRET ? "configured" : "NOT SET — server will reject all requests"}`);
    console.log(`  Admin key  : ${process.env.ADMIN_KEY ? "configured" : "NOT SET"}`);
    console.log(`  Slack      : ${process.env.SLACK_WEBHOOK_URL ? "configured" : "not configured"}`);
  });
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
