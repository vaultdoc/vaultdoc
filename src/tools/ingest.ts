import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ingestRepo, ingestOrg, parseRepoRef } from "../services/github.js";

export function registerIngestTools(server: McpServer) {
  server.tool(
    "ingest_repo",
    "Fetch a full content digest of a GitHub repository — file tree + key file contents — so you can synthesize documentation from it. After calling this, use save_doc to create structured docs (architecture, runbooks, onboarding, etc.).",
    {
      repo: z.string().describe("GitHub repo — 'owner/repo', 'https://github.com/owner/repo', or 'github.com/owner/repo'"),
      token: z.string().optional().describe("GitHub personal access token. Required for private repos; also raises rate limits for public ones."),
      max_files: z.number().int().min(1).max(150).default(60).describe("Max number of files to include in the digest (default 60)"),
    },
    async ({ repo, token, max_files }) => {
      try {
        const { owner, name } = (() => {
          const r = parseRepoRef(repo);
          return { owner: r.owner, name: r.repo };
        })();
        const digest = await ingestRepo(`${owner}/${name}`, token, max_files);
        return { content: [{ type: "text", text: digest }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  server.tool(
    "ingest_org",
    "Fetch an overview of all repositories in a GitHub organization — names, descriptions, languages, topics, and README excerpts. Use this to create onboarding docs, a services catalogue, or an org-wide architecture overview.",
    {
      org: z.string().describe("GitHub organization name, e.g. 'mycompany'"),
      token: z.string().optional().describe("GitHub personal access token. Gives access to private repos and higher rate limits."),
      max_repos: z.number().int().min(1).max(100).default(30).describe("Max repos to include (default 30, sorted by most recently pushed)"),
    },
    async ({ org, token, max_repos }) => {
      try {
        const digest = await ingestOrg(org, token, max_repos);
        return { content: [{ type: "text", text: digest }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );
}
