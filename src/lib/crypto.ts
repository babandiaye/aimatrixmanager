import crypto from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;
const PREFIX = "enc:v1:"; // identifie un payload chiffré (versionné)

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.WS_TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "WS_TOKEN_ENCRYPTION_KEY manquant — générer avec `openssl rand -base64 32`",
    );
  }
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error(
      `WS_TOKEN_ENCRYPTION_KEY doit être 32 bytes (base64), reçu ${buf.length}`,
    );
  }
  cachedKey = buf;
  return buf;
}

/** Chiffre un secret. Renvoie une chaîne avec préfixe 'enc:v1:'. */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, enc]).toString("base64");
}

/**
 * Déchiffre un secret. Si la chaîne ne porte pas le préfixe `enc:v1:`,
 * on la considère comme legacy (clair) et on la retourne telle quelle.
 * Utile pour la migration progressive — sera supprimé après audit.
 */
export function decrypt(payload: string): string {
  if (!payload.startsWith(PREFIX)) return payload; // legacy plaintext
  const buf = Buffer.from(payload.slice(PREFIX.length), "base64");
  if (buf.length < IV_LEN + TAG_LEN) {
    throw new Error("Payload chiffré invalide (trop court)");
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const enc = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString(
    "utf8",
  );
}

export function isEncrypted(payload: string): boolean {
  return payload.startsWith(PREFIX);
}
