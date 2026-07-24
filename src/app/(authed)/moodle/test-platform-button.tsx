"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { BeakerIcon } from "@heroicons/react/24/outline";
import { testMoodlePlatform } from "./actions";

/**
 * Bouton "Tester" par ligne de plateforme dans la liste /moodle.
 *
 * Au clic, exécute la batterie de checks côté serveur (connectivité + token
 * + fonctions webservice requises + plugin mod_matrix + tests réels) puis
 * affiche un rapport structuré dans un alert() texte. Pas de modal riche
 * pour rester cohérent avec les autres boutons d'action (SyncActivities,
 * RefreshMyCourses) — un rapport texte bien formaté est parfaitement
 * lisible et copiable pour partage/ticket.
 */
export function TestPlatformButton({ platformId }: { platformId: string }) {
  const [pending, start] = useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => {
        start(async () => {
          try {
            const r = await testMoodlePlatform(platformId);
            const lines: string[] = [];
            lines.push(`Test ${r.platformName} — ${r.baseUrl}`);
            lines.push("");
            for (const c of r.checks) {
              const icon =
                c.ok === true ? "✅" : c.ok === "warn" ? "⚠️" : "❌";
              lines.push(`${icon} ${c.label}`);
              lines.push(`   ${c.detail}`);
            }
            lines.push("");
            if (r.errorCount === 0 && r.warnCount === 0) {
              lines.push(`Résultat : ✅ Tous les prérequis sont OK.`);
            } else if (r.errorCount === 0) {
              lines.push(
                `Résultat : ⚠️ ${r.warnCount} avertissement(s) — l'intégration devrait fonctionner mais quelques points à vérifier.`,
              );
            } else {
              lines.push(
                `Résultat : ❌ ${r.errorCount} bloquant(s) détecté(s)${r.warnCount ? `, ${r.warnCount} avertissement(s)` : ""}. Corrige les prérequis manquants côté Moodle.`,
              );
            }
            alert(lines.join("\n"));
          } catch (e) {
            alert(e instanceof Error ? e.message : "Erreur");
          }
        });
      }}
      title="Vérifie que la plateforme Moodle expose toutes les fonctions webservice requises."
    >
      <BeakerIcon className={`size-4 ${pending ? "animate-pulse" : ""}`} />
      {pending ? "Test en cours…" : "Tester"}
    </Button>
  );
}
