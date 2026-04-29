/**
 * Migration cross-signing pour les agents existants.
 *
 * Usage :
 *   pnpm tsx scripts/cross-signing.ts setup <slug>
 *      → reset password, login, setup XS keys, save creds + XS en DB
 *      → après : sudo docker compose restart bot-ia
 *
 *   pnpm tsx scripts/cross-signing.ts sign <slug>
 *      → signe le device courant avec la SSK déjà persistée
 *      → à lancer 30s après le restart bot pour laisser matrix-nio uploader
 *        ses device_keys
 *
 *   pnpm tsx scripts/cross-signing.ts status
 *      → liste l'état XS de tous les agents
 *
 * Sortie volontairement verbeuse pour qu'un échec en milieu de flow soit
 * débugable (idempotent : rejouer après échec partiel est safe).
 */
import "dotenv/config";
import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { encrypt } from "../src/lib/crypto";
import {
  signAgentDevice,
  setupCrossSigningForAgent,
} from "../src/lib/agent-cross-signing";
import {
  clientLoginWithPassword,
  resetUserPassword,
} from "../src/lib/synapse-admin";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function cmdSetup(slug: string) {
  console.log(`\n🔧 Setup cross-signing pour @${slug}`);

  const agent = await prisma.agent.findUnique({
    where: { slug },
    select: { id: true, slug: true, matrixUserId: true },
  });
  if (!agent) {
    console.error(`❌ Agent introuvable : ${slug}`);
    process.exit(1);
  }
  console.log(`  agentId=${agent.id} mxid=${agent.matrixUserId}`);

  // 1. Reset password admin (invalide les access_tokens existants)
  console.log(`  → reset password admin...`);
  const password = crypto.randomBytes(24).toString("base64");
  await resetUserPassword(agent.slug, password);
  console.log(`     ✅ password reset OK`);

  // 2. Login pour obtenir un nouveau access_token + device_id
  console.log(`  → client login...`);
  const login = await clientLoginWithPassword(agent.slug, password);
  console.log(`     ✅ login OK — new device_id=${login.device_id}`);

  // 3. Sauvegarde immédiate des nouvelles creds (avant XS setup, pour que
  //    le bot puisse au moins se reconnecter même si XS échoue).
  await prisma.agent.update({
    where: { id: agent.id },
    data: {
      matrixAccessToken: encrypt(login.access_token),
      matrixDeviceId: login.device_id,
    },
  });
  console.log(`     ✅ token + device_id sauvés en DB`);

  // 4. Cross-signing — upload master/SSK/USK via UIA password
  console.log(`  → setup cross-signing (upload master/SSK/USK via UIA)...`);
  await setupCrossSigningForAgent({
    agentId: agent.id,
    userId: agent.matrixUserId,
    localpart: agent.slug,
    password,
    accessToken: login.access_token,
  });
  console.log(`     ✅ XS keys uploadées et SSK chiffrée persistée`);

  console.log(`\n📋 Prochaines étapes :`);
  console.log(`  1. sudo docker compose -f /opt/matrix-synapse/docker-compose.yml restart bot-ia`);
  console.log(`  2. attendre ~30s que matrix-nio uploade les device_keys`);
  console.log(`  3. pnpm tsx scripts/cross-signing.ts sign ${slug}`);
}

async function cmdSign(slug: string) {
  console.log(`\n🛡️  Signature device pour @${slug}`);

  const agent = await prisma.agent.findUnique({
    where: { slug },
    select: {
      id: true,
      matrixUserId: true,
      matrixDeviceId: true,
      matrixAccessToken: true,
    },
  });
  if (!agent) {
    console.error(`❌ Agent introuvable : ${slug}`);
    process.exit(1);
  }
  if (!agent.matrixDeviceId || !agent.matrixAccessToken) {
    console.error(`❌ Agent sans device_id ou token — lance 'setup' d'abord`);
    process.exit(1);
  }
  console.log(`  device_id=${agent.matrixDeviceId}`);

  // Import dynamique de decrypt — pas en haut pour garder l'erreur ENV claire
  const { decrypt } = await import("../src/lib/crypto");

  await signAgentDevice({
    agentId: agent.id,
    userId: agent.matrixUserId,
    deviceId: agent.matrixDeviceId,
    accessToken: decrypt(agent.matrixAccessToken),
  });
  console.log(`  ✅ device signé par SSK + signature uploadée à Synapse`);
  console.log(`\n🎉 ${slug} a maintenant cross-signing complet.`);
  console.log(`   Vérification dans Element :`);
  console.log(`   1. Quitte et rejoins une room avec @${slug}`);
  console.log(`   2. Le bouclier rouge ⚠️ devrait avoir disparu sur ses messages`);
  console.log(`   3. Cliquer sur l'avatar @${slug} → 3 dots → Vérifier l'utilisateur`);
  console.log(`      → Comparer les emojis (master key visible) → ✓`);
}

async function cmdStatus() {
  const agents = await prisma.agent.findMany({
    orderBy: { slug: "asc" },
    select: {
      slug: true,
      matrixDeviceId: true,
      crossSigning: {
        select: {
          masterPubKey: true,
          signedDeviceId: true,
          deviceSignedAt: true,
        },
      },
    },
  });
  console.log(`\nÉtat cross-signing — ${agents.length} agent(s) :\n`);
  for (const a of agents) {
    const xs = a.crossSigning;
    let state: string;
    if (!xs) {
      state = "❌ Aucun XS";
    } else if (xs.signedDeviceId === a.matrixDeviceId) {
      state = `✅ Vérifié (master=${xs.masterPubKey.substring(0, 12)}…)`;
    } else if (xs.signedDeviceId) {
      state = `⚠️  Device désynchronisé (signé:${xs.signedDeviceId} ≠ courant:${a.matrixDeviceId})`;
    } else {
      state = "🟠 Partiel (master OK, device pas encore signé)";
    }
    console.log(`  @${a.slug}\t${state}`);
  }
  console.log("");
}

async function main() {
  const [cmd, slug] = process.argv.slice(2);
  if (!cmd) {
    console.error(
      "Usage: cross-signing.ts <setup|sign|status> [<slug>]\n" +
        "  setup <slug>  — reset password + setup XS keys\n" +
        "  sign <slug>   — signe le device courant avec la SSK\n" +
        "  status        — liste l'état XS de tous les agents",
    );
    process.exit(1);
  }
  if (cmd === "status") {
    await cmdStatus();
    return;
  }
  if (!slug) {
    console.error(`Slug requis pour la commande '${cmd}'`);
    process.exit(1);
  }
  if (cmd === "setup") {
    await cmdSetup(slug);
  } else if (cmd === "sign") {
    await cmdSign(slug);
  } else {
    console.error(`Commande inconnue : ${cmd}`);
    process.exit(1);
  }
}

main()
  .catch((e) => {
    console.error("\n💥 Erreur :", e instanceof Error ? e.message : e);
    if (e instanceof Error && e.stack) console.error(e.stack);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
