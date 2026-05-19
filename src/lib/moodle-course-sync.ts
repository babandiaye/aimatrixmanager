/**
 * Sync structurel d'un cours Moodle vers `MoodleSection` + `MoodleResource`.
 *
 * Logique pure — pas d'auth, pas de `revalidatePath`. Appelée par :
 *   - server action `syncCourseContents` (qui ajoute l'auth + revalidate)
 *   - worker BullMQ `rag-worker` (étape 1 du pipeline RAG)
 *
 * Idempotent : upsert par `(platformId, cmid)` / `(courseId, moodleId)`,
 * purge ce qui a disparu côté Moodle (cascade FK → chunks supprimés).
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCourseContents } from "@/lib/moodle-ws";
import { logger } from "@/lib/logger";

const log = logger.child({ mod: "moodle-course-sync" });

// Modules indexables par le RAG. On ne synchronise QUE ces types — les
// autres (forum, quiz, assign, lesson…) sont ignorés à ce stade.
const INDEXABLE_MODNAMES = new Set([
  "resource", // fichier upload (PDF/DOCX/PPT/...)
  "page", // page HTML interne
  "book", // livre en chapitres
  "label", // étiquette HTML inline
  "folder", // dossier de fichiers
]);

export type CourseSyncResult = {
  sections: number;
  resources: number;
  resourcesByType: Record<string, number>;
  removedSections: number;
  removedResources: number;
};

export async function syncCourseContentsCore(
  courseDbId: string,
): Promise<CourseSyncResult> {
  const course = await prisma.moodleCourse.findUniqueOrThrow({
    where: { id: courseDbId },
    include: { platform: true },
  });

  const sections = await getCourseContents(course.platform, course.moodleId);

  let totalResources = 0;
  const byType: Record<string, number> = {};
  const seenSectionIds: number[] = [];
  const seenCmids: number[] = [];

  for (const s of sections) {
    seenSectionIds.push(s.id);

    const dbSection = await prisma.moodleSection.upsert({
      where: { courseId_moodleId: { courseId: course.id, moodleId: s.id } },
      create: {
        platformId: course.platformId,
        courseId: course.id,
        moodleId: s.id,
        name: s.name,
        summary: s.summary || null,
        sectionnum: s.section,
      },
      update: {
        name: s.name,
        summary: s.summary || null,
        sectionnum: s.section,
        extractedText: null,
        textExtractedAt: null,
        embeddedAt: null,
        lastSyncedAt: new Date(),
      },
    });

    for (const m of s.modules || []) {
      if (!INDEXABLE_MODNAMES.has(m.modname)) continue;

      seenCmids.push(m.id);
      byType[m.modname] = (byType[m.modname] ?? 0) + 1;
      totalResources++;

      // Tous les fichiers (book/folder peuvent en avoir plusieurs ; resource
      // n'en a qu'un). Le 1er est aussi stocké à plat pour rétro-compat des
      // requêtes existantes. La liste complète va dans `files` (JSON).
      const allFiles = (m.contents || []).filter((c) => c.type === "file");
      const file = allFiles[0];
      const filesPayload =
        allFiles.length > 0
          ? allFiles.map((f) => ({
              fileurl: f.fileurl,
              filename: f.filename,
              mimetype: f.mimetype ?? null,
              filesize: f.filesize ?? null,
              contenthash: f.contenthash ?? null,
            }))
          : null;

      await prisma.moodleResource.upsert({
        where: {
          platformId_cmid: { platformId: course.platformId, cmid: m.id },
        },
        create: {
          platformId: course.platformId,
          courseId: course.id,
          sectionId: dbSection.id,
          cmid: m.id,
          modname: m.modname,
          name: m.name,
          url: m.url || null,
          description: m.description || null,
          filename: file?.filename || null,
          mimetype: file?.mimetype || null,
          filesize: file?.filesize || null,
          fileurl: file?.fileurl || null,
          files: filesPayload as Prisma.InputJsonValue | undefined,
        },
        update: {
          sectionId: dbSection.id,
          modname: m.modname,
          name: m.name,
          url: m.url || null,
          description: m.description || null,
          filename: file?.filename || null,
          mimetype: file?.mimetype || null,
          filesize: file?.filesize || null,
          fileurl: file?.fileurl || null,
          files: filesPayload as Prisma.InputJsonValue | undefined,
          extractedText: null,
          textExtractedAt: null,
          embeddedAt: null,
          syncError: null,
          lastSyncedAt: new Date(),
        },
      });
    }
  }

  const { count: removedResources } = await prisma.moodleResource.deleteMany({
    where: {
      courseId: course.id,
      ...(seenCmids.length ? { cmid: { notIn: seenCmids } } : {}),
    },
  });
  const { count: removedSections } = await prisma.moodleSection.deleteMany({
    where: {
      courseId: course.id,
      ...(seenSectionIds.length
        ? { moodleId: { notIn: seenSectionIds } }
        : {}),
    },
  });

  log.info(
    {
      course: course.shortname,
      sections: sections.length,
      resources: totalResources,
      byType,
      removedSections,
      removedResources,
    },
    "Sync course contents (core)",
  );

  return {
    sections: sections.length,
    resources: totalResources,
    resourcesByType: byType,
    removedSections,
    removedResources,
  };
}
