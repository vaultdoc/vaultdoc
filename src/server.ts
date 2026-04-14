import "node:process";
import express from "express";
import rateLimit from "express-rate-limit";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ipAllowlist, apiKeyAuth } from "./middleware/auth.js";
import { registerDocTools } from "./tools/docs.js";
import { registerDevOpsTools } from "./tools/devops.js";
import { ensureDocsDir } from "./services/storage.js";

const PORT = parseInt(process.env.PORT ?? "3000", 10);

async function main() {
  await ensureDocsDir();

  const app = express();

  // Trust proxy headers (needed when behind nginx/caddy)
  app.set("trust proxy", 1);

  // Rate limiting — 100 req/min per IP
  app.use(
    rateLimit({
      windowMs: 60_000,
      max: 100,
      standardHeaders: true,
      legacyHeaders: false,
    })
  );

  // Security middleware — IP allowlist first, then API key
  app.use(ipAllowlist);
  app.use(apiKeyAuth);

  app.use(express.json({ limit: "4mb" }));

  // Health check (no auth — for load balancer probes from inside VPN)
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", uptime: process.uptime() });
  });

  // MCP endpoint
  app.post("/mcp", async (req, res) => {
    const server = new McpServer({
      name: "team-docs",
      version: "0.1.0",
    });

    registerDocTools(server);
    registerDevOpsTools(server);

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
    });

    res.on("close", () => {
      transport.close();
      server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`team-docs-mcp listening on port ${PORT}`);
    console.log(`  IP allowlist: ${process.env.ALLOWED_IPS || "(disabled)"}`);
    console.log(`  API keys: ${process.env.API_KEYS ? "configured" : "NONE — server is unprotected!"}`);
    console.log(`  Docs dir: ${process.env.DOCS_DIR ?? "./docs"}`);
    console.log(`  Slack: ${process.env.SLACK_WEBHOOK_URL ? "configured" : "not configured"}`);
  });
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
