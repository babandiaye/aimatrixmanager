/**
 * Extraction texte depuis différents formats de documents Moodle.
 *
 * Dispatcher par mimetype/format → texte brut, prêt à être chunké.
 *
 * Formats supportés :
 *  - application/pdf                                      → pdf-parse
 *  - application/vnd.openxmlformats-officedocument.wordprocessingml.document  (DOCX) → mammoth
 *  - text/html                                            → html-to-text
 *  - text/plain                                           → as-is
 *  - inline HTML (description, summary)                   → html-to-text
 *
 * Non supportés (skip avec extractionError) :
 *  - PPTX, ODT, ODP : à voir si volume justifie d'ajouter une lib
 *  - images : RAG visuel pas dans le scope V1
 *  - vidéo/audio : nécessite STT, hors scope
 */
import crypto from "node:crypto";
import { htmlToText } from "html-to-text";

export class UnsupportedFormatError extends Error {
  constructor(public mimetype: string) {
    super(`Format non supporté pour l'extraction : ${mimetype}`);
  }
}

const HTML_TO_TEXT_OPTS = {
  wordwrap: false as const,
  selectors: [
    // Skip les éléments décoratifs / non-pédagogiques
    { selector: "img", format: "skip" as const },
    { selector: "script", format: "skip" as const },
    { selector: "style", format: "skip" as const },
    // Liens : on garde le texte mais pas l'URL (sinon ça pollue les embeddings)
    { selector: "a", options: { ignoreHref: true } },
  ],
};

/**
 * Extrait le texte d'un buffer selon son mimetype. Retourne une string
 * UTF-8 normalisée (espaces multiples collapsés, lignes vides limitées).
 */
export async function extractText(
  buffer: Buffer,
  mimetype: string,
): Promise<string> {
  const mt = mimetype.toLowerCase();

  if (mt === "application/pdf") {
    // pdf-parse v2 — API class-based, getText() retourne { text, ... }
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    return normalize(result.text);
  }

  if (
    mt ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mt === "application/msword"
  ) {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return normalize(result.value);
  }

  if (mt.startsWith("text/html") || mt === "application/xhtml+xml") {
    return normalize(htmlToText(buffer.toString("utf-8"), HTML_TO_TEXT_OPTS));
  }

  if (mt.startsWith("text/")) {
    return normalize(buffer.toString("utf-8"));
  }

  throw new UnsupportedFormatError(mimetype);
}

/**
 * Strip HTML d'une string (description, summary Moodle). Pratique pour les
 * modules `label`/`page`/`book` dont le contenu vient déjà en HTML dans le
 * JSON WS, sans passer par fetch + extraction.
 */
export function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  return normalize(htmlToText(html, HTML_TO_TEXT_OPTS));
}

/**
 * Normalise le texte extrait : trim, collapse les espaces multiples, limite
 * les sauts de ligne consécutifs à 2 (pour préserver la structure paragraphe
 * sans gaspiller de tokens).
 */
function normalize(s: string): string {
  return s
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * SHA1 d'un buffer en hex (pour la dédup de fichiers — `MoodleResource.contenthash`).
 */
export function sha1Hex(buffer: Buffer): string {
  return crypto.createHash("sha1").update(buffer).digest("hex");
}

// ── Chunking ────────────────────────────────────────────────────────────────

export type Chunk = {
  ordinal: number;
  text: string;
  charCount: number;
};

/**
 * Découpe un texte en chunks de ~targetSize chars avec un overlap.
 * On essaye de couper sur des frontières propres (paragraphe > phrase >
 * espace) pour préserver la cohérence sémantique des embeddings.
 *
 * Les chunks vides ou trop courts (< minSize) sont skippés — typiquement
 * des artefacts de fin de doc.
 */
export function chunkText(
  text: string,
  opts: { targetSize?: number; overlap?: number; minSize?: number } = {},
): Chunk[] {
  const targetSize = opts.targetSize ?? 1000;
  const overlap = opts.overlap ?? 150;
  const minSize = opts.minSize ?? 50;

  if (!text || text.length < minSize) return [];

  const chunks: Chunk[] = [];
  let start = 0;
  let ordinal = 0;

  while (start < text.length) {
    let end = Math.min(start + targetSize, text.length);

    // Ajustement vers une frontière propre si pas en fin de doc
    if (end < text.length) {
      // Essaie de couper sur \n\n d'abord (paragraphe), puis . suivi d'espace,
      // puis espace simple. On regarde dans une fenêtre de ±100 chars.
      const search = text.substring(end - 100, end + 100);
      const localEnd = end - 100;
      const paraIdx = search.lastIndexOf("\n\n");
      const sentIdx = search.search(/[.!?]\s/);
      const spaceIdx = search.lastIndexOf(" ");

      if (paraIdx > 0) {
        end = localEnd + paraIdx + 2;
      } else if (sentIdx > 0) {
        end = localEnd + sentIdx + 2;
      } else if (spaceIdx > 0) {
        end = localEnd + spaceIdx + 1;
      }
    }

    const slice = text.substring(start, end).trim();
    if (slice.length >= minSize) {
      chunks.push({ ordinal: ordinal++, text: slice, charCount: slice.length });
    }

    if (end >= text.length) break;
    start = end - overlap;
  }

  return chunks;
}
