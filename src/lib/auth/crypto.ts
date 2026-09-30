import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../db/store";

let secret: Buffer | null = null;

/** AUTH_SECRET in production (required). In development a random secret is created once and kept in the data folder. */
function getSecret(): Buffer {
  if (secret) return secret;
  const env = process.env.AUTH_SECRET;
  if (env && env.length >= 24) return (secret = Buffer.from(env));
  if (process.env.NODE_ENV === "production") throw new Error("AUTH_SECRET must be set (at least 24 characters) in production");
  const file = path.join(DATA_DIR, ".auth-secret");
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString("hex"), { mode: 0o600 });
  return (secret = Buffer.from(fs.readFileSync(file, "utf8")));
}

export const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");
export const fromB64url = (s: string) => Buffer.from(s, "base64url").toString("utf8");

export function hmac(data: string): string {
  return crypto.createHmac("sha256", getSecret()).update(data).digest("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function randomId(bytes = 12): string {
  return crypto.randomBytes(bytes).toString("base64url");
}
