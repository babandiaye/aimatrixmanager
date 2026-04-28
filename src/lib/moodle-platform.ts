import type { MoodlePlatform } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";

/**
 * Récupère le token Moodle en clair depuis une plateforme stockée chiffrée.
 * Ne JAMAIS exposer ce résultat côté client.
 */
export function getPlaintextToken(p: Pick<MoodlePlatform, "wsToken">): string {
  return decrypt(p.wsToken);
}

/** Liste des plateformes actives, prêtes à être appelées. */
export async function getActivePlatforms() {
  const platforms = await prisma.moodlePlatform.findMany({
    where: { enabled: true },
  });
  return platforms.map((p) => ({
    ...p,
    plaintextToken: getPlaintextToken(p),
  }));
}
