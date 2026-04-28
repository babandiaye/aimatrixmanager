import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { encrypt, isEncrypted } from "../src/lib/crypto";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  const platforms = await prisma.moodlePlatform.findMany();
  let migrated = 0,
    skipped = 0;

  for (const p of platforms) {
    if (isEncrypted(p.wsToken)) {
      skipped++;
      console.log(`⏭️  ${p.key} déjà chiffré`);
      continue;
    }
    await prisma.moodlePlatform.update({
      where: { id: p.id },
      data: { wsToken: encrypt(p.wsToken) },
    });
    migrated++;
    console.log(`✅ ${p.key} chiffré`);
  }

  console.log(`\n${migrated} migré(s), ${skipped} déjà chiffré(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
