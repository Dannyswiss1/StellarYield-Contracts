import { Redis } from "ioredis";
import { logger } from "../logger.js";

let client: Redis | null = null;

function getClient(): Redis | null {
  if (client) return client;
  const url = process.env["REDIS_URL"];
  if (!url) return null;
  client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
  client.on("error", (err: Error) => logger.error({ err }, "redis error"));
  return client;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const redis = getClient();
    if (!redis) return null;
    const val = await redis.get(key);
    return val ? (JSON.parse(val) as T) : null;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  try {
    const redis = getClient();
    if (!redis) return;
    await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch {
    // cache is best-effort
  }
}

export async function cacheDel(pattern: string): Promise<void> {
  try {
    const redis = getClient();
    if (!redis) return;
    const keys = await redis.keys(pattern);
    if (keys.length > 0) await redis.del(...keys);
  } catch {
    // cache is best-effort
  }
}
