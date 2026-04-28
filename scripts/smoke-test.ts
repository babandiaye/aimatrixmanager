import "dotenv/config";
import { Redis } from "ioredis";
import pino from "pino";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const log = pino({ transport: { target: "pino-pretty", options: { colorize: true } } });

async function main() {
  log.info("─── Smoke test aimatrixmanager ───");

  // Redis
  const redis = new Redis(process.env.REDIS_URL!);
  const pong = await redis.ping();
  log.info({ pong }, "Redis ping");
  await redis.set("smoke:test", "hello", "EX", 30);
  const v = await redis.get("smoke:test");
  log.info({ v }, "Redis set/get");
  await redis.quit();

  // Prisma
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });
  const adminCount = await prisma.user.count({ where: { role: "ADMIN" } });
  log.info({ adminCount }, "Postgres count admins");
  await prisma.$disconnect();

  log.info("✅ Tout OK");
}

main().catch((e) => { log.error(e); process.exit(1); });
