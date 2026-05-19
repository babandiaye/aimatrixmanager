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
import { LinkIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { linkRoomToCourse } from "../actions";

const NONE_VALUE = "__none__";

export function CourseLinker({
  roomId,
  currentCourseId,
  currentCourse,
  courses,
  canAssign,
}: {
  roomId: string;
  currentCourseId: string | null;
  currentCourse: {
    shortname: string;
    fullname: string;
    platformKey: string;
  } | null;
  courses: { id: string; label: string }[];
  canAssign: boolean;
}) {
  const [pending, start] = useTransition();

  const onSelect = (next: string | null) => {
    if (!next) return;
    const target = next === NONE_VALUE ? null : next;
    if (target === currentCourseId) return;

    // Confirmation explicite : lier au mauvais cours fait disparaître la room
    // du scope ENSEIGNANT, et un délink/relink Moodle peut être délicat.
    const targetLabel =
      target === null
        ? "(aucun cours — délier)"
        : (courses.find((c) => c.id === target)?.label ?? target);
    const fromLabel = currentCourse
      ? `[${currentCourse.platformKey}] ${currentCourse.shortname}`
      : "(aucun)";
    const msg =
      target === null
        ? `Délier ce salon du cours « ${fromLabel} » ? Les enseignants de ce cours ne le verront plus dans /mes-cours.`
        : `Lier ce salon à :\n  ${targetLabel}\n\n(était : ${fromLabel})\n\nLes enseignants du cours actuel le perdront ; ceux du nouveau cours le verront. Confirmer ?`;
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
      <p className="text-sm text-muted-foreground">Aucun cours lié.</p>
    );
  }

  if (courses.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Aucun cours avec activité <code>mod_matrix</code> détecté. Va sur{" "}
        <a className="text-primary hover:underline" href="/moodle">
          Plateformes Moodle
        </a>{" "}
        et lance la synchronisation des activités Matrix.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Seuls les cours ayant une activité <code>mod_matrix</code> sont listés.
      </p>
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Select
            value={currentCourseId ?? NONE_VALUE}
            disabled={pending}
            onValueChange={onSelect}
          >
            <SelectTrigger>
              <SelectValue placeholder="Choisir un cours..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE_VALUE}>(aucun)</SelectItem>
              {courses.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.label}
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
    </div>
  );
}
