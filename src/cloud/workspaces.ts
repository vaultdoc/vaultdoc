import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const WORKSPACES_FILE =
  process.env.WORKSPACES_FILE ?? path.join(process.cwd(), "data", "workspaces.json");

export interface Workspace {
  id: string;
  name: string;
  plan: "free" | "pro";
  ownerId: string;
  createdAt: string;
}

interface Store {
  workspaces: Record<string, Workspace>;
}

let cache: Store | null = null;

async function load(): Promise<Store> {
  if (cache) return cache;
  try {
    cache = JSON.parse(await fs.readFile(WORKSPACES_FILE, "utf-8")) as Store;
  } catch {
    cache = { workspaces: {} };
  }
  return cache;
}

async function persist(store: Store): Promise<void> {
  await fs.mkdir(path.dirname(WORKSPACES_FILE), { recursive: true });
  await fs.writeFile(WORKSPACES_FILE, JSON.stringify(store, null, 2), "utf-8");
  cache = store;
}

export async function createWorkspace(name: string, ownerId: string): Promise<Workspace> {
  const store = await load();
  const id = crypto.randomBytes(8).toString("hex");
  const workspace: Workspace = {
    id,
    name,
    plan: "free",
    ownerId,
    createdAt: new Date().toISOString(),
  };
  store.workspaces[id] = workspace;
  await persist(store);
  return workspace;
}

export async function getWorkspace(id: string): Promise<Workspace | null> {
  const store = await load();
  return store.workspaces[id] ?? null;
}

export async function listWorkspaces(): Promise<Workspace[]> {
  const store = await load();
  return Object.values(store.workspaces).sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  );
}

export async function deleteWorkspace(id: string): Promise<boolean> {
  const store = await load();
  if (!store.workspaces[id]) return false;
  delete store.workspaces[id];
  await persist(store);
  return true;
}

export async function upgradePlan(id: string, plan: "free" | "pro"): Promise<boolean> {
  const store = await load();
  if (!store.workspaces[id]) return false;
  store.workspaces[id].plan = plan;
  await persist(store);
  return true;
}
