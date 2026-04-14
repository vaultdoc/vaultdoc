import "node:process";
import express, { type Request, type Response, type NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { ipAllowlist, apiKeyAuth, adminKeyAuth } from "./middleware/auth.js";
import { registerDocTools } from "./tools/docs.js";
import { registerDevOpsTools } from "./tools/devops.js";
import { registerIngestTools } from "./tools/ingest.js";
import { ensureDocsDir } from "./services/storage.js";
import { initKeyStore, listKeyNames, addKey, removeKey } from "./services/keyStore.js";

const PORT = parseInt(process.env.PORT ?? "3000", 10);

// CORS — needed for Electron-based agents (Cursor, Windsurf) and web clients
function mcpCors(req: Request, res: Response, next: NextFunction) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept, Mcp-Session-Id");
  if (req.method === "OPTIONS") { res.sendStatus(204); return; }
  next();
}

// SSE sessions — for legacy MCP clients (older Cursor, Continue.dev, etc.)
const sseSessions = new Map<string, { server: McpServer; transport: SSEServerTransport }>();

async function main() {
  await ensureDocsDir();
  await initKeyStore();

  const app = express();

  app.set("trust proxy", 1);
  app.use(express.json({ limit: "4mb" }));

  // Rate limiting — 100 req/min per IP
  app.use(
    rateLimit({
      windowMs: 60_000,
      max: 100,
      standardHeaders: true,
      legacyHeaders: false,
    })
  );

  // Health check — no auth, accessible from inside VPN for probes
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", uptime: process.uptime() });
  });

  // Admin key management — separate ADMIN_KEY, not mixed with client keys
  app.get("/admin/keys", adminKeyAuth, async (_req, res) => {
    const names = await listKeyNames();
    res.json({ keys: names });
  });

  app.post("/admin/keys", adminKeyAuth, async (req, res) => {
    const { name, key } = req.body as { name?: string; key?: string };
    if (!name || !key) {
      res.status(400).json({ error: "Body must include { name, key }" });
      return;
    }
    try {
      await addKey(name, key);
      res.status(201).json({ message: `Key "${name}" added` });
    } catch (err) {
      res.status(409).json({ error: (err as Error).message });
    }
  });

  app.delete("/admin/keys/:name", adminKeyAuth, async (req, res) => {
    const paramName = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
    const removed = await removeKey(paramName);
    if (!removed) {
      res.status(404).json({ error: `Key "${paramName}" not found` });
      return;
    }
    res.json({ message: `Key "${paramName}" revoked` });
  });

  // MCP endpoints — CORS + IP allowlist + API key auth
  // ── Streamable HTTP (modern: Claude Code, Cursor, Codex, OpenCode, Windsurf…) ──
  app.all("/mcp", mcpCors, ipAllowlist, apiKeyAuth, async (req, res) => {
    const server = new McpServer({ name: "vaultdoc", version: "0.1.0" });
    registerDocTools(server);
    registerDevOpsTools(server);
    registerIngestTools(server);

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    res.on("close", () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // ── SSE legacy transport (older clients: Continue.dev, some Zed versions…) ──
  app.get("/sse", mcpCors, ipAllowlist, apiKeyAuth, async (req, res) => {
    const server = new McpServer({ name: "vaultdoc", version: "0.1.0" });
    registerDocTools(server);
    registerDevOpsTools(server);
    registerIngestTools(server);

    const transport = new SSEServerTransport("/messages", res);
    sseSessions.set(transport.sessionId, { server, transport });

    res.on("close", () => {
      sseSessions.delete(transport.sessionId);
      transport.close();
      server.close();
    });

    await server.connect(transport);
  });

  app.post("/messages", mcpCors, ipAllowlist, apiKeyAuth, async (req, res) => {
    const sessionId = req.query["sessionId"] as string;
    const session = sseSessions.get(sessionId);
    if (!session) { res.status(404).json({ error: "Session not found" }); return; }
    await session.transport.handlePostMessage(req, res, req.body);
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`team-docs-mcp listening on :${PORT}`);
    console.log(`  IP allowlist : ${process.env.ALLOWED_IPS || "(disabled)"}`);
    console.log(`  Admin API    : ${process.env.ADMIN_KEY ? "enabled" : "disabled (set ADMIN_KEY)"}`);
    console.log(`  Docs dir     : ${process.env.DOCS_DIR ?? "./docs"}`);
    console.log(`  Slack        : ${process.env.SLACK_WEBHOOK_URL ? "configured" : "not configured"}`);
  });
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
