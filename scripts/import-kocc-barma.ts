/**
 * Importe l'agent existant kocc-barma (legacy bot) dans la table Agent
 * en réutilisant son access_token et device_id (sinon l'E2EE casse).
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { encrypt } from "../src/lib/crypto";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const SYSTEM_PROMPT = `Tu es Kocc Barma, un assistant IA pédagogique intégré dans une salle de cours en ligne (Matrix/Element).
Tu aides les apprenants à comprendre et corriger leur code.

Règles :
- Réponds toujours en français par défaut
- Si l'étudiant écrit en anglais, réponds en anglais
- Sois pédagogique, clair et bienveillant
- Explique POURQUOI il y a une erreur, pas seulement comment la corriger
- Si du code est partagé, analyse-le attentivement avant de répondre
- Utilise des blocs de code Markdown pour tes exemples
- Garde le contexte de la conversation
- Réponds à tous les messages directement comme le ferait ChatGPT`;

async function main() {
  // Creds existantes du bot legacy. À fournir via env :
  //   KOCC_BARMA_ACCESS_TOKEN — depuis /opt/matrix-synapse/bot/store/session.json
  //   KOCC_BARMA_DEVICE_ID    — idem
  const accessToken = process.env.KOCC_BARMA_ACCESS_TOKEN;
  const deviceId = process.env.KOCC_BARMA_DEVICE_ID;
  if (!accessToken || !deviceId) {
    console.error(
      "KOCC_BARMA_ACCESS_TOKEN et KOCC_BARMA_DEVICE_ID requis (cf. session.json du bot)",
    );
    process.exit(1);
  }

  const existing = await prisma.agent.findUnique({
    where: { slug: "kocc-barma" },
  });
  if (existing) {
    console.log("ℹ️ kocc-barma existe déjà, mise à jour des creds Matrix.");
    await prisma.agent.update({
      where: { id: existing.id },
      data: {
        matrixAccessToken: encrypt(accessToken),
        matrixDeviceId: deviceId,
      },
    });
    console.log("✅ Mis à jour");
    return;
  }

  const agent = await prisma.agent.create({
    data: {
      slug: "kocc-barma",
      name: "Kocc Barma Assistant IA 🎓",
      description:
        "Assistant IA pédagogique pour les cours UN-CHK (legacy bot importé).",
      matrixUserId: "@kocc-barma:formation1-matrix.unchk.sn",
      matrixDeviceId: deviceId,
      matrixAccessToken: encrypt(accessToken),
      systemPrompt: SYSTEM_PROMPT,
      model: "claude-sonnet-4-6",
      maxTokens: 2048,
      status: "ENABLED",
    },
  });
  console.log("✅ Agent kocc-barma importé :", agent.id);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
