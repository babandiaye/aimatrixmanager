import "dotenv/config";
/**
 * Crée (ou remet en état) la configuration LLM partagée de l'établissement.
 *
 * Usage :
 *   pnpm tsx scripts/seed-shared-llm.ts
 *
 * C'est le « défaut d'usine » : la config SHARED + isDefault vers laquelle
 * `resolveEffectiveLlm` retombe pour tout compte sans fournisseur personnel.
 * Sans elle, aucun agent ne peut être résolu.
 *
 * IDEMPOTENT : relancer ne crée pas de doublon. Si une config partagée
 * existe déjà, le script la met simplement en conformité (modèle, actif,
 * défaut) et ne touche à rien d'autre.
 *
 * La clé Ollama n'est PAS stockée en base : elle reste dans OLLAMA_API_KEY.
 * C'est l'infrastructure de l'établissement, pas la clé d'une personne —
 * la sortir de l'environnement n'apporterait rien et ajouterait un secret
 * de plus à faire tourner.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { SHARED_OLLAMA_MODEL } from "../src/lib/llm-catalog";

// Prisma 7 exige un adaptateur explicite — même construction que src/lib/prisma.ts
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  const apiUrl = process.env.OLLAMA_BASE_URL?.replace(/\/+$/, "") ?? null;
  if (!apiUrl) {
    console.error("OLLAMA_BASE_URL absent — impossible de renseigner l'URL.");
    process.exit(1);
  }

  const existing = await prisma.llmConfig.findFirst({
    where: { scope: "SHARED", provider: "OLLAMA" },
    orderBy: { createdAt: "asc" },
  });

  if (existing) {
    const patched = await prisma.llmConfig.update({
      where: { id: existing.id },
      data: {
        model: SHARED_OLLAMA_MODEL,
        apiUrl,
        isDefault: true,
        isActive: true,
      },
    });
    console.log(`Config partagée déjà présente — mise en conformité.`);
    console.log(`  ${patched.id}  ${patched.name}  ${patched.model}`);
    return;
  }

  // Une seule config peut porter le défaut d'usine.
  await prisma.llmConfig.updateMany({
    where: { scope: "SHARED", isDefault: true },
    data: { isDefault: false },
  });

  const created = await prisma.llmConfig.create({
    data: {
      name: "Ollama UN-CHK",
      provider: "OLLAMA",
      apiUrl,
      apiKeyEnc: null,
      model: SHARED_OLLAMA_MODEL,
      scope: "SHARED",
      userId: null,
      isDefault: true,
      isActive: true,
    },
  });
  console.log("Config partagée créée :");
  console.log(`  ${created.id}  ${created.name}  ${created.model}  ${created.apiUrl}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
