import fs from "node:fs/promises";
import path from "node:path";
import { glob } from "glob";
import matter from "gray-matter";
import type { Doc, DocMeta, DocSummary } from "../types.js";

const DOCS_DIR = process.env.DOCS_DIR ?? path.join(process.cwd(), "docs");

export async function ensureDocsDir() {
  await fs.mkdir(DOCS_DIR, { recursive: true });
}

function docPath(docPath: string): string {
  // Prevent path traversal
  const normalized = path.normalize(docPath).replace(/^(\.\.(\/|\\|$))+/, "");
  const full = path.join(DOCS_DIR, normalized);
  if (!full.startsWith(DOCS_DIR)) throw new Error("Invalid doc path");
  return full.endsWith(".md") ? full : `${full}.md`;
}

export async function getDoc(relPath: string): Promise<Doc> {
  const full = docPath(relPath);
  const raw = await fs.readFile(full, "utf-8");
  const parsed = matter(raw);
  return {
    path: relPath,
    meta: parsed.data as DocMeta,
    content: parsed.content,
  };
}

export async function saveDoc(
  relPath: string,
  content: string,
  meta: Partial<DocMeta>,
  updatedBy: string
): Promise<Doc> {
  const full = docPath(relPath);
  await fs.mkdir(path.dirname(full), { recursive: true });

  let existing: Partial<DocMeta> = {};
  try {
    const raw = await fs.readFile(full, "utf-8");
    existing = matter(raw).data as DocMeta;
  } catch {
    // new file
  }

  const finalMeta: DocMeta = {
    title: meta.title ?? existing.title ?? path.basename(relPath, ".md"),
    category: meta.category ?? existing.category ?? "general",
    tags: meta.tags ?? existing.tags ?? [],
    updatedAt: new Date().toISOString(),
    updatedBy,
  };

  const serialized = matter.stringify(content, finalMeta);
  await fs.writeFile(full, serialized, "utf-8");

  return { path: relPath, meta: finalMeta, content };
}

export async function deleteDoc(relPath: string): Promise<void> {
  const full = docPath(relPath);
  await fs.unlink(full);
}

export async function listDocs(category?: string): Promise<DocSummary[]> {
  const pattern = path.join(DOCS_DIR, "**/*.md");
  const files = await glob(pattern, { nodir: true });

  const docs: DocSummary[] = [];
  for (const file of files) {
    try {
      const raw = await fs.readFile(file, "utf-8");
      const parsed = matter(raw);
      const meta = parsed.data as DocMeta;
      const rel = path.relative(DOCS_DIR, file);
      if (category && meta.category !== category) continue;
      docs.push({
        path: rel,
        title: meta.title ?? rel,
        category: meta.category ?? "general",
        tags: meta.tags ?? [],
        updatedAt: meta.updatedAt ?? "",
      });
    } catch {
      // skip unreadable files
    }
  }

  return docs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function searchDocs(query: string): Promise<DocSummary[]> {
  const q = query.toLowerCase();
  const all = await listDocs();
  const results: DocSummary[] = [];

  for (const summary of all) {
    const matchesMeta =
      summary.title.toLowerCase().includes(q) ||
      summary.category.toLowerCase().includes(q) ||
      summary.tags.some((t) => t.toLowerCase().includes(q));

    if (matchesMeta) {
      results.push(summary);
      continue;
    }

    // Also check content
    try {
      const doc = await getDoc(summary.path);
      if (doc.content.toLowerCase().includes(q)) results.push(summary);
    } catch {
      // skip
    }
  }

  return results;
}
