import Redis from "ioredis";

// Singleton Redis — un seul client partagé en dev (HMR) et prod
const globalForRedis = globalThis as unknown as { redis: Redis | undefined };

export const redis =
  globalForRedis.redis ??
  new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
  });

if (process.env.NODE_ENV !== "production") {
  globalForRedis.redis = redis;
}
