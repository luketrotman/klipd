/**
 * JSON file store for the MVP.
 *
 * The whole database lives in data/db.json (created from the seed on first run).
 * Reads are in-memory; writes go through `mutate()` which persists the file.
 * Swap this module for a Postgres/Supabase repository without touching the
 * query layer's public surface (src/lib/db/queries.ts).
 */
import fs from "node:fs";
import path from "node:path";
import type { Database } from "../domain/types";
import { buildSeed } from "./seed";

const DB_PATH = path.join(process.cwd(), "data", "db.json");

type Cache = { db: Database | null };
const g = globalThis as unknown as { __klipdDb?: Cache };
if (!g.__klipdDb) g.__klipdDb = { db: null };
const cache = g.__klipdDb;

function load(): Database {
  if (cache.db) return cache.db;
  if (fs.existsSync(DB_PATH)) {
    cache.db = JSON.parse(fs.readFileSync(DB_PATH, "utf8")) as Database;
  } else {
    cache.db = buildSeed();
    persist(cache.db);
  }
  return cache.db;
}

function persist(db: Database) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const tmp = DB_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_PATH);
}

export function getDb(): Database {
  return load();
}

export function mutate<T>(fn: (db: Database) => T): T {
  const db = load();
  const result = fn(db);
  persist(db);
  return result;
}

export function resetDb(): void {
  cache.db = buildSeed();
  persist(cache.db);
}

export function newId(prefix: string): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < 7; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `${prefix}_${s}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
