/**
 * GitHub repo ingestion — inspired by gitingest.
 * Fetches a repo's file tree and key file contents, returns a structured
 * text digest suitable for an AI agent to synthesize documentation from.
 * Uses the GitHub REST API directly — no Python, no extra dependencies.
 */

const GITHUB_API = "https://api.github.com";

// Extensions we care about for documentation purposes
const INCLUDE_EXTENSIONS = new Set([
  ".md", ".mdx", ".txt",
  ".ts", ".tsx", ".js", ".jsx", ".mjs",
  ".py", ".go", ".rs", ".rb", ".java", ".kt", ".swift", ".cs", ".php",
  ".yaml", ".yml", ".toml", ".json",
  ".sh", ".bash", ".zsh",
  ".sql",
]);

// Always include these regardless of extension
const INCLUDE_FILENAMES = new Set([
  "Dockerfile", "dockerfile",
  "Makefile", "makefile",
  "Procfile",
  ".env.example", ".env.sample",
  "README", "CONTRIBUTING", "CHANGELOG", "ARCHITECTURE",
]);

// Directories to skip entirely
const EXCLUDE_DIRS = new Set([
  "node_modules", "dist", "build", "out", ".next", ".nuxt",
  "vendor", "__pycache__", ".venv", "venv", "env",
  "coverage", ".nyc_output", ".cache",
  ".git",
]);

// Files to skip
const EXCLUDE_PATTERNS = [
  /\.min\.(js|css)$/,
  /\.lock$/,
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /\.map$/,
  /\.snap$/,
];

const MAX_FILE_BYTES = 80_000;  // 80 KB per file
const MAX_TOTAL_BYTES = 600_000; // 600 KB total digest

interface TreeItem {
  path: string;
  type: "blob" | "tree";
  size?: number;
  sha: string;
}

interface RepoMeta {
  owner: string;
  name: string;
  description: string | null;
  language: string | null;
  stargazersCount: number;
  defaultBranch: string;
  topics: string[];
}

function makeHeaders(token?: string): Record<string, string> {
  const h: Record<string, string> = {
    "Accept": "application/vnd.github+json",
    "User-Agent": "vaultdoc/1.0",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

async function ghFetch<T>(url: string, token?: string): Promise<T> {
  const res = await fetch(url, { headers: makeHeaders(token) });
  if (res.status === 403 || res.status === 429) {
    const reset = res.headers.get("x-ratelimit-reset");
    throw new Error(`GitHub rate limit hit. ${reset ? `Resets at ${new Date(parseInt(reset) * 1000).toISOString()}` : ""} Pass a GitHub token via the 'token' parameter to increase limits.`);
  }
  if (res.status === 404) throw new Error(`Not found: ${url}`);
  if (!res.ok) throw new Error(`GitHub API error ${res.status}: ${url}`);
  return res.json() as Promise<T>;
}

/** Parse "owner/repo", "https://github.com/owner/repo", or "github.com/owner/repo" */
export function parseRepoRef(ref: string): { owner: string; repo: string } {
  const clean = ref.replace(/^https?:\/\//, "").replace(/^github\.com\//, "").replace(/\.git$/, "").trim();
  const parts = clean.split("/");
  if (parts.length < 2) throw new Error(`Invalid repo reference: "${ref}". Expected "owner/repo" or a GitHub URL.`);
  return { owner: parts[0], repo: parts[1] };
}

function shouldInclude(path: string): boolean {
  const parts = path.split("/");
  // Skip excluded dirs at any depth
  if (parts.some(p => EXCLUDE_DIRS.has(p))) return false;

  const filename = parts[parts.length - 1];

  // Skip excluded patterns
  if (EXCLUDE_PATTERNS.some(r => r.test(filename))) return false;

  // Always include special filenames
  if (INCLUDE_FILENAMES.has(filename)) return true;

  // Include by extension
  const ext = filename.includes(".") ? "." + filename.split(".").pop()! : "";
  return INCLUDE_EXTENSIONS.has(ext);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

/** Full digest of a single repository. */
export async function ingestRepo(
  repoRef: string,
  token?: string,
  maxFiles = 60,
): Promise<string> {
  const { owner, repo } = parseRepoRef(repoRef);

  // Fetch repo metadata
  const meta = await ghFetch<{
    description: string | null;
    language: string | null;
    stargazers_count: number;
    default_branch: string;
    topics: string[];
    full_name: string;
  }>(`${GITHUB_API}/repos/${owner}/${repo}`, token);

  // Fetch full recursive tree
  const treeData = await ghFetch<{ tree: TreeItem[]; truncated: boolean }>(
    `${GITHUB_API}/repos/${owner}/${repo}/git/trees/${meta.default_branch}?recursive=1`,
    token
  );

  if (treeData.truncated) {
    // truncated means > 100k entries — filter client-side with what we have
  }

  // Filter to relevant files, sorted by priority (docs first, then source)
  const files = treeData.tree
    .filter(item => item.type === "blob" && shouldInclude(item.path))
    .filter(item => !item.size || item.size <= MAX_FILE_BYTES)
    .sort((a, b) => {
      const score = (p: string) => {
        if (/readme/i.test(p)) return 0;
        if (/\.md$/i.test(p)) return 1;
        if (/docker|makefile|\.ya?ml$/i.test(p)) return 2;
        return 3;
      };
      return score(a.path) - score(b.path);
    })
    .slice(0, maxFiles);

  // Build the tree listing
  const allPaths = treeData.tree
    .filter(item => item.type === "blob" && !item.path.split("/").some(p => EXCLUDE_DIRS.has(p)))
    .map(item => `${item.path}${item.size ? ` (${formatSize(item.size)})` : ""}`)
    .join("\n");

  // Fetch file contents
  let totalBytes = 0;
  const fileContents: string[] = [];

  for (const file of files) {
    if (totalBytes >= MAX_TOTAL_BYTES) break;
    try {
      const data = await ghFetch<{ content: string; encoding: string }>(
        `${GITHUB_API}/repos/${owner}/${repo}/contents/${file.path}`,
        token
      );
      if (data.encoding !== "base64") continue;
      const content = Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf-8");
      totalBytes += content.length;
      fileContents.push(`${"=".repeat(60)}\nFile: ${file.path}\n${"=".repeat(60)}\n${content}`);
    } catch {
      // skip files that 404 or error
    }
  }

  const sections = [
    `# Repository: ${owner}/${repo}`,
    ``,
    `**Description:** ${meta.description ?? "(none)"}`,
    `**Language:** ${meta.language ?? "unknown"}`,
    `**Default branch:** ${meta.default_branch}`,
    `**Topics:** ${meta.topics.join(", ") || "(none)"}`,
    ``,
    `## File Tree (filtered, ${files.length} files shown)`,
    `\`\`\``,
    allPaths,
    `\`\`\``,
    ``,
    `## File Contents`,
    ``,
    fileContents.join("\n\n"),
    ``,
    `---`,
    `*Digest generated by vaultdoc — ${files.length} files, ~${formatSize(totalBytes)} of content*`,
  ];

  return sections.join("\n");
}

/** Overview of all public repos in a GitHub org — good for creating onboarding docs. */
export async function ingestOrg(
  org: string,
  token?: string,
  maxRepos = 30,
): Promise<string> {
  const repos = await ghFetch<Array<{
    name: string;
    description: string | null;
    language: string | null;
    stargazers_count: number;
    topics: string[];
    default_branch: string;
    archived: boolean;
    pushed_at: string;
  }>>(`${GITHUB_API}/orgs/${org}/repos?sort=pushed&per_page=${maxRepos}`, token);

  const active = repos.filter(r => !r.archived);

  // Fetch README for each repo (best-effort)
  const repoSummaries: string[] = [];
  for (const r of active.slice(0, maxRepos)) {
    let readme = "";
    try {
      const data = await ghFetch<{ content: string; encoding: string }>(
        `${GITHUB_API}/repos/${org}/${r.name}/contents/README.md`,
        token
      );
      if (data.encoding === "base64") {
        const full = Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf-8");
        // Take first 1500 chars of README
        readme = full.slice(0, 1500) + (full.length > 1500 ? "\n…(truncated)" : "");
      }
    } catch { /* no README */ }

    repoSummaries.push(
      `### ${r.name}\n` +
      `**Language:** ${r.language ?? "unknown"} | **Last push:** ${r.pushed_at.slice(0, 10)}\n` +
      `**Description:** ${r.description ?? "(none)"}\n` +
      `**Topics:** ${r.topics.join(", ") || "(none)"}\n` +
      (readme ? `\n**README:**\n${readme}` : "")
    );
  }

  return [
    `# GitHub Organization: ${org}`,
    ``,
    `**Total active repos:** ${active.length} (showing ${Math.min(active.length, maxRepos)})`,
    ``,
    `## Repositories`,
    ``,
    repoSummaries.join("\n\n---\n\n"),
    ``,
    `---`,
    `*Overview generated by vaultdoc. Use \`ingest_repo\` on individual repos for full content digests.*`,
  ].join("\n");
}
