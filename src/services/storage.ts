import fs from "node:fs/promises";
import path from "node:path";
import { glob } from "glob";
import matter from "gray-matter";
import type { Doc, DocMeta, DocSummary } from "../types.js";

const BASE_DOCS_DIR = process.env.DOCS_DIR ?? path.join(process.cwd(), "docs");

/** In self-hosted mode workspaceId is undefined — docs live flat in DOCS_DIR.
 *  In cloud mode each workspace gets its own subdirectory. */
function resolveDocsDir(workspaceId?: string): string {
  if (!workspaceId) return BASE_DOCS_DIR;
  // Sanitize workspaceId — alphanumeric + hyphens only
  const safe = workspaceId.replace(/[^a-z0-9-]/gi, "");
  return path.join(BASE_DOCS_DIR, safe);
}

export async function ensureDocsDir(workspaceId?: string) {
  await fs.mkdir(resolveDocsDir(workspaceId), { recursive: true });
}

function docPath(relPath: string, workspaceId?: string): string {
  const docsDir = resolveDocsDir(workspaceId);
  const normalized = path.normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, "");
  const full = path.join(docsDir, normalized);
  if (!full.startsWith(docsDir)) throw new Error("Invalid doc path");
  return full.endsWith(".md") ? full : `${full}.md`;
}

export async function getDoc(relPath: string, workspaceId?: string): Promise<Doc> {
  const full = docPath(relPath, workspaceId);
  const raw = await fs.readFile(full, "utf-8");
  const parsed = matter(raw);
  return { path: relPath, meta: parsed.data as DocMeta, content: parsed.content };
}

export async function saveDoc(
  relPath: string,
  content: string,
  meta: Partial<DocMeta>,
  updatedBy: string,
  workspaceId?: string
): Promise<Doc> {
  const full = docPath(relPath, workspaceId);
  await fs.mkdir(path.dirname(full), { recursive: true });

  let existing: Partial<DocMeta> = {};
  try {
    const raw = await fs.readFile(full, "utf-8");
    existing = matter(raw).data as DocMeta;
  } catch { /* new file */ }

  const finalMeta: DocMeta = {
    title: meta.title ?? existing.title ?? path.basename(relPath, ".md"),
    category: meta.category ?? existing.category ?? "general",
    tags: meta.tags ?? existing.tags ?? [],
    updatedAt: new Date().toISOString(),
    updatedBy,
  };

  await fs.writeFile(full, matter.stringify(content, finalMeta), "utf-8");
  return { path: relPath, meta: finalMeta, content };
}

export async function deleteDoc(relPath: string, workspaceId?: string): Promise<void> {
  await fs.unlink(docPath(relPath, workspaceId));
}

export async function listDocs(category?: string, workspaceId?: string): Promise<DocSummary[]> {
  const docsDir = resolveDocsDir(workspaceId);
  const files = await glob(path.join(docsDir, "**/*.md"), { nodir: true });

  const docs: DocSummary[] = [];
  for (const file of files) {
    try {
      const raw = await fs.readFile(file, "utf-8");
      const parsed = matter(raw);
      const meta = parsed.data as DocMeta;
      const rel = path.relative(docsDir, file);
      if (category && meta.category !== category) continue;
      docs.push({
        path: rel,
        title: meta.title ?? rel,
        category: meta.category ?? "general",
        tags: meta.tags ?? [],
        updatedAt: meta.updatedAt ?? "",
      });
    } catch { /* skip */ }
  }

  return docs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function searchDocs(query: string, workspaceId?: string): Promise<DocSummary[]> {
  const q = query.toLowerCase();
  const all = await listDocs(undefined, workspaceId);
  const results: DocSummary[] = [];

  for (const summary of all) {
    const matchesMeta =
      summary.title.toLowerCase().includes(q) ||
      summary.category.toLowerCase().includes(q) ||
      summary.tags.some((t) => t.toLowerCase().includes(q));

    if (matchesMeta) { results.push(summary); continue; }

    try {
      const doc = await getDoc(summary.path, workspaceId);
      if (doc.content.toLowerCase().includes(q)) results.push(summary);
    } catch { /* skip */ }
  }

  return results;
}
