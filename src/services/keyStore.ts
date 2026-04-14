import fs from "node:fs/promises";
import path from "node:path";

const KEYS_FILE = process.env.API_KEYS_FILE ?? path.join(process.cwd(), "data", "api-keys.json");

interface KeyStore {
  keys: Record<string, string>; // name → token
}

// In-memory cache
let cache: KeyStore | null = null;

async function load(): Promise<KeyStore> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(KEYS_FILE, "utf-8");
    cache = JSON.parse(raw) as KeyStore;
  } catch {
    cache = { keys: {} };
  }
  return cache;
}

async function persist(store: KeyStore): Promise<void> {
  await fs.mkdir(path.dirname(KEYS_FILE), { recursive: true });
  await fs.writeFile(KEYS_FILE, JSON.stringify(store, null, 2), "utf-8");
  cache = store;
}

/** Seed from API_KEYS env var on first load (backwards compat) */
async function seedFromEnv(): Promise<void> {
  const envKeys = (process.env.API_KEYS ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  if (envKeys.length === 0) return;

  const store = await load();
  let changed = false;
  for (const [i, token] of envKeys.entries()) {
    const name = `env-key-${i + 1}`;
    if (!store.keys[name]) {
      store.keys[name] = token;
      changed = true;
    }
  }
  if (changed) await persist(store);
}

export async function initKeyStore(): Promise<void> {
  await seedFromEnv();
}

export async function hasKey(token: string): Promise<boolean> {
  const store = await load();
  return Object.values(store.keys).includes(token);
}

export async function listKeyNames(): Promise<string[]> {
  const store = await load();
  return Object.keys(store.keys);
}

export async function addKey(name: string, token: string): Promise<void> {
  if (!name || !token) throw new Error("Name and token are required");
  const store = await load();
  if (store.keys[name]) throw new Error(`Key "${name}" already exists`);
  store.keys[name] = token;
  await persist(store);
}

export async function removeKey(name: string): Promise<boolean> {
  const store = await load();
  if (!store.keys[name]) return false;
  delete store.keys[name];
  await persist(store);
  return true;
}
