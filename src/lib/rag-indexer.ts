/**
 * Orchestrateur d'indexation RAG pour un cours Moodle :
 *  1. Section.summary  → stripHtml → chunks
 *  2. Resource (file)  → download + SHA1 + extractText → chunks
 *  3. Resource (label) → stripHtml(description) → chunks
 *
 * Une exécution = un cours. Idempotent : si extractedText est déjà set et que
 * lastSyncedAt n'a pas bougé, skip. Sinon re-extrait + re-chunk (les anciens
 * chunks sont supprimés via cascade FK).
 *
 * Les embeddings ne sont PAS calculés ici — Phase 11e les fera dans une passe
 * séparée (chunks où embedding IS NULL). Découplage utile : on peut re-extraire
 * sans re-payer le coût Ollama, et inversement.
 */
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import { logger } from "@/lib/logger";
import {
  Chunk,
  chunkText,
  extractText,
  sha1Hex,
  stripHtml,
  UnsupportedFormatError,
} from "@/lib/text-extraction";
import { embedBatch, vectorLiteral } from "@/lib/embeddings";
import type { MoodleResource, MoodleSection } from "@prisma/client";

const log = logger.child({ mod: "rag-indexer" });

// Limite de taille des fichiers à indexer. Au-delà : skip avec syncError.
// 50 MB couvre 99% du contenu pédagogique ; les cas hors-norme (vidéos
// longues, ZIP, ...) ne sont pas exploitables par le RAG texte.
const MAX_FILE_SIZE = 50 * 1024 * 1024;

export type IndexCourseResult = {
  sections: { processed: number; chunks: number };
  resources: { processed: number; skipped: number; failed: number; chunks: number };
  errors: Array<{ entity: string; name: string; error: string }>;
};

/**
 * Réindexe un cours Moodle : extraction texte de toutes ses sections et
 * resources, regénération des chunks. Pré-requis : sync structurel
 * (syncCourseContents) déjà fait.
 */
export async function extractCourseContents(
  courseDbId: string,
): Promise<IndexCourseResult> {
  const course = await prisma.moodleCourse.findUniqueOrThrow({
    where: { id: courseDbId },
    include: { platform: true, sections: true, resources: true },
  });

  const result: IndexCourseResult = {
    sections: { processed: 0, chunks: 0 },
    resources: { processed: 0, skipped: 0, failed: 0, chunks: 0 },
    errors: [],
  };

  // ── Sections : indexer les summaries non vides ──────────────────────────
  for (const section of course.sections) {
    if (!section.summary || !section.summary.trim()) continue;

    try {
      const text = stripHtml(section.summary);
      if (!text || text.length < 50) continue; // trop court pour valoir un embed

      const chunks = chunkText(text);
      await persistSectionChunks(course.id, section, text, chunks);
      result.sections.processed++;
      result.sections.chunks += chunks.length;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.errors.push({
        entity: "section",
        name: section.name,
        error: msg,
      });
      log.warn(
        { sectionId: section.id, err: msg },
        "Échec extraction section",
      );
    }
  }

  // ── Resources : un par un, avec gestion d'erreur isolée ────────────────
  const wsToken = decrypt(course.platform.wsToken);
  for (const resource of course.resources) {
    try {
      const indexed = await indexResource(resource, wsToken);
      if (indexed === "skipped") {
        result.resources.skipped++;
      } else {
        result.resources.processed++;
        result.resources.chunks += indexed;
      }
    } catch (e) {
      result.resources.failed++;
      const msg = e instanceof Error ? e.message : String(e);
      result.errors.push({
        entity: `resource[${resource.modname}]`,
        name: resource.name,
        error: msg,
      });
      // Persiste l'erreur sur la row pour debug UI
      await prisma.moodleResource.update({
        where: { id: resource.id },
        data: { syncError: msg.substring(0, 500) },
      });
      log.warn(
        { resourceId: resource.id, modname: resource.modname, err: msg },
        "Échec extraction resource",
      );
    }
  }

  // Marqueur de fin d'indexation
  await prisma.moodleCourse.update({
    where: { id: course.id },
    data: { lastIndexedAt: new Date() },
  });

  log.info(
    { course: course.shortname, ...result },
    "Indexation cours terminée",
  );
  return result;
}

/**
 * Indexe une resource selon son modname. Renvoie le nb de chunks créés ou
 * "skipped" si la resource n'a pas de contenu indexable.
 */
type ResourceFile = {
  fileurl: string;
  filename: string;
  mimetype: string | null;
  filesize: number | null;
  contenthash: string | null;
};

function parseFiles(raw: unknown): ResourceFile[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (f): f is ResourceFile =>
      f &&
      typeof f === "object" &&
      typeof (f as ResourceFile).fileurl === "string" &&
      typeof (f as ResourceFile).filename === "string",
  );
}

/**
 * Download + extract texte d'un fichier unique. Renvoie le texte ou null
 * en cas de format non supporté. Throw sur erreur réseau / extraction.
 */
async function downloadAndExtract(
  file: { fileurl: string; mimetype: string | null; filename: string; filesize: number | null },
  wsToken: string,
): Promise<{ text: string; hash: string } | null> {
  if (file.filesize && file.filesize > MAX_FILE_SIZE) {
    throw new Error(
      `Fichier trop volumineux (${(file.filesize / 1024 / 1024).toFixed(1)} MB > 50 MB)`,
    );
  }
  const sep = file.fileurl.includes("?") ? "&" : "?";
  const url = `${file.fileurl}${sep}token=${wsToken}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Download HTTP ${res.status} for ${file.filename}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const hash = sha1Hex(buf);

  // Pour les HTMLs (book chapters), mimetype peut être absent — on infère
  // depuis l'extension du filename si besoin.
  const mt =
    file.mimetype ||
    (file.filename.endsWith(".html") || file.filename.endsWith(".htm")
      ? "text/html"
      : "");

  try {
    const text = await extractText(buf, mt);
    return { text, hash };
  } catch (e) {
    if (e instanceof UnsupportedFormatError) return null;
    throw e;
  }
}

async function indexResource(
  resource: MoodleResource,
  wsToken: string,
): Promise<number | "skipped"> {
  let text = "";

  const filesList = parseFiles(resource.files);

  if (
    (resource.modname === "resource" ||
      resource.modname === "folder" ||
      resource.modname === "book") &&
    (resource.fileurl || filesList.length > 0)
  ) {
    // Multi-fichiers : on télécharge tout et on concatène. Pour un mod_book,
    // chaque "fichier" est un chapitre HTML. Pour un folder, ce sont les
    // fichiers du dossier. Pour resource (1 fichier), filesList = [le fichier].
    const filesToFetch: ResourceFile[] =
      filesList.length > 0
        ? filesList
        : [
            {
              fileurl: resource.fileurl!,
              filename: resource.filename ?? "file",
              mimetype: resource.mimetype,
              filesize: resource.filesize,
              contenthash: resource.contenthash,
            },
          ];

    const parts: string[] = [];
    let lastHash: string | null = null;
    for (const f of filesToFetch) {
      // mod_book : le 1er entry est souvent "structure" (TOC JSON) — skip si
      // mimetype JSON ou filename "structure"
      if (
        resource.modname === "book" &&
        (f.filename === "structure" || (f.mimetype || "").includes("json"))
      ) {
        continue;
      }
      const r = await downloadAndExtract(
        {
          fileurl: f.fileurl,
          filename: f.filename,
          mimetype: f.mimetype,
          filesize: f.filesize,
        },
        wsToken,
      );
      if (!r) continue; // format non supporté → skip ce fichier seulement
      if (r.text && r.text.trim().length > 0) {
        // Préfixe avec le filename pour aider la traçabilité dans les chunks
        parts.push(`# ${f.filename}\n\n${r.text}`);
      }
      lastHash = r.hash;
    }

    if (parts.length === 0) {
      await prisma.moodleResource.update({
        where: { id: resource.id },
        data: {
          syncError: `Aucun fichier exploitable (${filesToFetch.length} tentés)`,
        },
      });
      return "skipped";
    }

    text = parts.join("\n\n---\n\n");
    await prisma.moodleResource.update({
      where: { id: resource.id },
      data: {
        contenthash: lastHash,
        extractedText: text,
        textExtractedAt: new Date(),
        syncError: null,
      },
    });
  } else if (resource.description) {
    // label / page / book / autres : on a juste la description (HTML inline)
    text = stripHtml(resource.description);
    await prisma.moodleResource.update({
      where: { id: resource.id },
      data: {
        extractedText: text,
        textExtractedAt: new Date(),
        syncError: null,
      },
    });
  } else {
    return "skipped"; // pas de fichier ni de description
  }

  if (!text || text.length < 50) {
    return "skipped";
  }

  const chunks = chunkText(text);
  await persistResourceChunks(resource.courseId, resource.id, chunks);
  return chunks.length;
}

// ── Persistance des chunks (transactional) ──────────────────────────────────

async function persistSectionChunks(
  courseId: string,
  section: MoodleSection,
  extractedText: string,
  chunks: Chunk[],
): Promise<void> {
  await prisma.$transaction([
    // Mise à jour de la section avec le texte extrait
    prisma.moodleSection.update({
      where: { id: section.id },
      data: { extractedText, textExtractedAt: new Date() },
    }),
    // Purge des anciens chunks
    prisma.moodleResourceChunk.deleteMany({
      where: { sectionId: section.id },
    }),
    // Insert des nouveaux
    prisma.moodleResourceChunk.createMany({
      data: chunks.map((c) => ({
        courseId,
        sectionId: section.id,
        ordinal: c.ordinal,
        text: c.text,
        tokenCount: estimateTokens(c.charCount),
      })),
    }),
  ]);
}

async function persistResourceChunks(
  courseId: string,
  resourceId: string,
  chunks: Chunk[],
): Promise<void> {
  await prisma.$transaction([
    prisma.moodleResourceChunk.deleteMany({
      where: { resourceId },
    }),
    prisma.moodleResourceChunk.createMany({
      data: chunks.map((c) => ({
        courseId,
        resourceId,
        ordinal: c.ordinal,
        text: c.text,
        tokenCount: estimateTokens(c.charCount),
      })),
    }),
  ]);
}

/**
 * Estimation très approximative du nb de tokens à partir du nb de chars.
 * Pour le français/anglais : ~4 chars/token. Suffisant pour le sizing des
 * embeddings, on ne facture pas dessus.
 */
function estimateTokens(charCount: number): number {
  return Math.ceil(charCount / 4);
}

// ── Embeddings ─────────────────────────────────────────────────────────────
//
// Walk les chunks d'un cours où embedding IS NULL, batch-embed via fromager,
// update via raw SQL (Prisma ne supporte pas le type `vector` nativement).
// Batch de 32 chunks à la fois pour ne pas surcharger le gateway.

export type EmbedCourseResult = {
  embedded: number;
  alreadyEmbedded: number;
  failed: number;
};

export async function embedCourseChunks(
  courseDbId: string,
  batchSize = 32,
): Promise<EmbedCourseResult> {
  const result: EmbedCourseResult = { embedded: 0, alreadyEmbedded: 0, failed: 0 };

  // Postgres-side count des chunks déjà embed (Prisma ne sait pas filtrer sur vector NULL)
  const [{ count: alreadyCount }] = await prisma.$queryRaw<
    { count: bigint }[]
  >`SELECT COUNT(*)::bigint AS count FROM "MoodleResourceChunk"
    WHERE "courseId" = ${courseDbId} AND embedding IS NOT NULL`;
  result.alreadyEmbedded = Number(alreadyCount);

  while (true) {
    // Récupère le prochain batch de chunks sans embedding
    const pending = await prisma.$queryRaw<
      { id: string; text: string }[]
    >`SELECT id, text FROM "MoodleResourceChunk"
      WHERE "courseId" = ${courseDbId} AND embedding IS NULL
      ORDER BY ordinal ASC
      LIMIT ${batchSize}`;

    if (pending.length === 0) break;

    try {
      const vectors = await embedBatch(pending.map((c) => c.text));

      // Update via raw SQL (Prisma ne supporte pas vector). Une UPDATE par
      // chunk — pas idéal mais Postgres-side c'est rapide vs le coût Ollama.
      for (let i = 0; i < pending.length; i++) {
        await prisma.$executeRaw`
          UPDATE "MoodleResourceChunk"
          SET embedding = ${vectorLiteral(vectors[i])}::vector
          WHERE id = ${pending[i].id}
        `;
      }
      result.embedded += pending.length;
      log.info(
        { courseId: courseDbId, batch: pending.length, totalSoFar: result.embedded },
        "Embed batch done",
      );
    } catch (e) {
      result.failed += pending.length;
      log.error(
        { err: e instanceof Error ? e.message : e, batch: pending.length },
        "Échec batch embed",
      );
      // On stoppe au premier échec massif — l'admin peut relancer après diagnostic
      throw e;
    }
  }

  return result;
}
