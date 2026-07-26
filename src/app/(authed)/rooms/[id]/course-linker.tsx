"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BookOpenIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { linkRoomToCourse } from "../actions";

const NONE_VALUE = "__none__";

export type CourseChoice = {
  id: string;
  platformKey: string;
  shortname: string;
  fullname: string;
  bookCount: number;
};

export function CourseLinker({
  roomId,
  currentCourseId,
  currentCourse,
  courses,
  canAssign,
  originCourseNote,
}: {
  roomId: string;
  currentCourseId: string | null;
  currentCourse: {
    shortname: string;
    fullname: string;
    platformKey: string;
  } | null;
  courses: CourseChoice[];
  canAssign: boolean;
  // Message optionnel affiché sous le dropdown quand le cours d'origine
  // détecté n'a pas encore de ressource indexable — invite l'admin à
  // sync le contenu Moodle plutôt que de masquer le cours.
  originCourseNote?: string | null;
}) {
  const [pending, start] = useTransition();

  const onSelect = (next: string | null) => {
    if (!next) return;
    const target = next === NONE_VALUE ? null : next;
    if (target === currentCourseId) return;

    // Confirmation explicite : un mauvais lien fait disparaître la room
    // du scope ENSEIGNANT (il ne voit que les salons de ses cours).
    const targetCourse =
      target !== null ? courses.find((c) => c.id === target) : null;
    const targetLabel =
      target === null
        ? "(aucun cours — délier)"
        : targetCourse
          ? `[${targetCourse.platformKey}] ${targetCourse.shortname} — ${targetCourse.fullname}`
          : target;
    const fromLabel = currentCourse
      ? `[${currentCourse.platformKey}] ${currentCourse.shortname}`
      : "(aucun)";
    const msg =
      target === null
        ? `Délier ce salon du cours « ${fromLabel} » ? Les enseignants de ce cours ne le verront plus dans /mes-cours.`
        : `Associer ce salon au cours :\n  ${targetLabel}\n\n(était : ${fromLabel})\n\nLes agents IA de ce salon utiliseront le RAG de ce cours. Confirmer ?`;
    if (!confirm(msg)) return;

    start(async () => {
      try {
        await linkRoomToCourse(roomId, target);
      } catch (e) {
        alert(e instanceof Error ? e.message : "Erreur");
      }
    });
  };

  if (!canAssign) {
    return currentCourse ? (
      <p className="text-sm">
        <span className="font-mono text-xs">[{currentCourse.platformKey}]</span>{" "}
        {currentCourse.shortname} — {currentCourse.fullname}
      </p>
    ) : (
      <p className="text-sm text-muted-foreground">Aucun cours associé.</p>
    );
  }

  if (courses.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Aucun cours indexable disponible. Pour qu&apos;un cours apparaisse
        ici, il doit contenir au moins une ressource exploitable par le RAG
        (<code>book</code>, PDF, page, dossier…). Sync depuis{" "}
        <a className="text-primary hover:underline" href="/moodle">
          Plateformes Moodle
        </a>
        .
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Cours Moodle <strong>associé pour le RAG</strong>. Les agents
        affectés à ce salon répondront avec le contexte de ce cours. Seuls
        les cours ayant au moins une ressource indexable apparaissent.
        L&apos;icône <BookOpenIcon className="inline size-3.5 -mt-0.5" />{" "}
        signale les cours avec des <code>mod_book</code> (les mieux pris en
        charge actuellement).
      </p>
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Select
            value={currentCourseId ?? NONE_VALUE}
            disabled={pending}
            onValueChange={onSelect}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Choisir un cours..." />
            </SelectTrigger>
            {/* w-max = popup grandit avec le nom du cours (le plus long
                dicte la largeur), min = au moins la largeur du trigger,
                max = plafonné à 90vw pour ne pas déborder sur mobile. */}
            <SelectContent className="w-max min-w-(--anchor-width) max-w-[min(90vw,720px)]">
              <SelectItem value={NONE_VALUE}>(aucun)</SelectItem>
              {courses.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  <span className="font-mono text-[10px] text-muted-foreground mr-2">
                    [{c.platformKey}]
                  </span>
                  {c.shortname} — {c.fullname}
                  {c.bookCount > 0 && (
                    <span className="ml-2 inline-flex items-center gap-0.5 text-xs text-status-published">
                      <BookOpenIcon className="size-3" />
                      {c.bookCount}
                    </span>
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {currentCourseId && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={pending}
            title="Délier"
            onClick={() => onSelect(NONE_VALUE)}
          >
            <XMarkIcon className="size-4" />
          </Button>
        )}
      </div>
      {originCourseNote && (
        <p className="rounded-md border border-status-processing/30 bg-status-processing/5 px-3 py-2 text-xs leading-relaxed text-status-processing">
          {originCourseNote}
        </p>
      )}
    </div>
  );
}
