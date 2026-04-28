import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import readline from "node:readline";
import { Writable } from "node:stream";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

// Lit une saisie sur stdin, masquée si hidden=true
async function prompt(question: string, hidden = false): Promise<string> {
  const muted = new Writable({
    write(chunk, _enc, cb) {
      if (!hidden) process.stdout.write(chunk);
      cb();
    },
  });
  const rl = readline.createInterface({
    input: process.stdin,
    output: muted,
    terminal: true,
  });
  process.stdout.write(question);
  return new Promise((resolve) => {
    rl.question("", (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

async function main() {
  // 1. email — argv[2], env, ou prompt
  const email =
    process.argv[2] ||
    process.env.ADMIN_EMAIL ||
    (await prompt("Email: "));
  if (!email) {
    console.error("Email requis");
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`❌ Aucun utilisateur avec l'email ${email}`);
    process.exit(1);
  }

  // 2. password — argv[3], env, ou prompt (masqué)
  const password =
    process.argv[3] ||
    process.env.ADMIN_PASSWORD ||
    (await prompt("Nouveau mot de passe: ", true));
  if (!password || password.length < 8) {
    console.error("Mot de passe : minimum 8 caractères");
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash },
  });

  console.log(`✅ Mot de passe mis à jour pour ${email} (${user.role})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
