/**
 * Cross-signing E2EE Matrix — primitives crypto + flow d'upload.
 *
 * Architecture du cross-signing (spec Matrix v1.11) :
 *
 *   master_key (MSK)  ←──── self-signed
 *        │
 *        ├── signe ──→ self_signing_key (SSK) ──── signe ──→ device_keys
 *        └── signe ──→ user_signing_key (USK)
 *
 * Quand un autre user vérifie le master en personne (emoji compare), tous les
 * devices signés par SSK héritent de la confiance → plus de bouclier rouge ⚠️.
 *
 * Ce module ne fait QUE la couche crypto + appels REST Matrix bruts. Le flow
 * complet (UIA, stockage DB, retry...) est orchestré dans setupCrossSigning()
 * et signDeviceWithSsk() ci-dessous.
 *
 * Référence : https://spec.matrix.org/v1.11/client-server-api/#cross-signing
 */
import crypto from "node:crypto";

// ── Base64 Matrix (alphabet standard, sans padding) ─────────────────────────
// Matrix utilise base64 standard ('+' et '/'), unpadded (pas de '=' final).
// Ne pas confondre avec base64url ('-' et '_') que renvoie JWK.

function toMatrixB64(buf: Buffer): string {
  return buf.toString("base64").replace(/=+$/, "");
}

function fromMatrixB64(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s + pad, "base64");
}

function jwkB64UrlToMatrix(b64url: string): string {
  return b64url.replace(/-/g, "+").replace(/_/g, "/");
}

// ── Canonical JSON (Matrix appendix) ────────────────────────────────────────
// Spec : clés triées lex., pas d'espaces, UTF-8. Pour notre cas d'usage
// (envelopes purement ASCII : MXIDs, base64), JSON.stringify avec tri suffit.

export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalize).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    "{" +
    keys.map((k) => JSON.stringify(k) + ":" + canonicalize(obj[k])).join(",") +
    "}"
  );
}

// ── Ed25519 keypairs ────────────────────────────────────────────────────────

export type Ed25519KeyPair = {
  publicB64: string; // 32-byte clé publique, base64 unpadded
  privateB64: string; // 32-byte seed, base64 unpadded
  publicKey: crypto.KeyObject;
  privateKey: crypto.KeyObject;
};

export function generateEd25519(): Ed25519KeyPair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const pubJwk = publicKey.export({ format: "jwk" }) as { x: string };
  const privJwk = privateKey.export({ format: "jwk" }) as {
    x: string;
    d: string;
  };
  return {
    publicB64: jwkB64UrlToMatrix(pubJwk.x),
    privateB64: jwkB64UrlToMatrix(privJwk.d),
    publicKey,
    privateKey,
  };
}

/**
 * Reconstruit la paire Ed25519 à partir du seed privé (32 bytes en base64
 * Matrix). Utilisé pour re-signer un device après rotation, sans avoir
 * besoin d'un nouveau UIA.
 */
export function ed25519FromPrivateB64(privB64: string): Ed25519KeyPair {
  const seed = fromMatrixB64(privB64);
  if (seed.length !== 32) {
    throw new Error(`Ed25519 seed invalide : ${seed.length} bytes (attendu 32)`);
  }
  // Préfixe DER PKCS8 pour Ed25519 + 32-byte seed = clé privée valide
  const PKCS8_PREFIX = Buffer.from(
    "302e020100300506032b657004220420",
    "hex",
  );
  const pkcs8 = Buffer.concat([PKCS8_PREFIX, seed]);
  const privateKey = crypto.createPrivateKey({
    key: pkcs8,
    format: "der",
    type: "pkcs8",
  });
  const publicKey = crypto.createPublicKey(privateKey);
  const pubJwk = publicKey.export({ format: "jwk" }) as { x: string };
  return {
    publicB64: jwkB64UrlToMatrix(pubJwk.x),
    privateB64: privB64,
    publicKey,
    privateKey,
  };
}

// ── Signatures ──────────────────────────────────────────────────────────────

export function signCanonical(
  privateKey: crypto.KeyObject,
  json: string,
): string {
  const sig = crypto.sign(null, Buffer.from(json, "utf8"), privateKey);
  return toMatrixB64(sig);
}

export function verifyCanonical(
  publicKey: crypto.KeyObject,
  json: string,
  sigB64: string,
): boolean {
  return crypto.verify(
    null,
    Buffer.from(json, "utf8"),
    publicKey,
    fromMatrixB64(sigB64),
  );
}

// ── Envelopes cross-signing ─────────────────────────────────────────────────

export type KeyUsage = "master" | "self_signing" | "user_signing";

export type KeyEnvelope = {
  user_id: string;
  usage: KeyUsage[];
  keys: Record<string, string>;
  signatures?: Record<string, Record<string, string>>;
};

export function buildKeyEnvelope(
  userId: string,
  usage: KeyUsage,
  publicB64: string,
): KeyEnvelope {
  return {
    user_id: userId,
    usage: [usage],
    // L'ID de la clé EST la clé publique elle-même (pour les xs keys)
    keys: { [`ed25519:${publicB64}`]: publicB64 },
  };
}

/**
 * Ajoute une signature à une envelope. La canonicalisation se fait sur
 * l'envelope sans le champ `signatures` (et sans `unsigned` pour les events).
 */
export function signEnvelope(
  envelope: KeyEnvelope | Record<string, unknown>,
  signerUserId: string,
  signerPubB64: string,
  signerPrivKey: crypto.KeyObject,
): KeyEnvelope {
  // Strip signatures + unsigned avant canonicalisation
  const stripped: Record<string, unknown> = { ...(envelope as object) };
  delete stripped.signatures;
  delete stripped.unsigned;
  const canonical = canonicalize(stripped);
  const sig = signCanonical(signerPrivKey, canonical);

  const existing = (envelope as KeyEnvelope).signatures ?? {};
  const merged: Record<string, Record<string, string>> = { ...existing };
  merged[signerUserId] = {
    ...(merged[signerUserId] ?? {}),
    [`ed25519:${signerPubB64}`]: sig,
  };
  return { ...(envelope as KeyEnvelope), signatures: merged };
}

// ── Flow REST Matrix : upload + sign device ─────────────────────────────────

export type SetupOpts = {
  homeserverUrl: string; // ex: "https://formation1-matrix.unchk.sn"
  userId: string; // "@kocc-barma:formation1-matrix.unchk.sn"
  localpart: string; // "kocc-barma"
  password: string; // pour l'UIA
  accessToken: string;
};

export type SetupResult = {
  masterPubB64: string;
  masterPrivB64: string; // (caller décide de le garder ou pas)
  sskPubB64: string;
  sskPrivB64: string; // À chiffrer + persister pour signer un device futur
  uskPubB64: string;
  uskPrivB64: string;
};

/**
 * Génère master/SSK/USK, signe la chaîne, upload via UIA.
 * Ne signe PAS encore le device (le bot doit avoir uploadé ses device_keys
 * d'abord — voir signDeviceWithSsk()).
 *
 * Le password est consommé au moment de l'UIA et n'a pas besoin d'être
 * persisté ensuite.
 */
export async function uploadCrossSigningKeys(
  opts: SetupOpts,
): Promise<SetupResult> {
  const { homeserverUrl, userId, localpart, password, accessToken } = opts;

  const master = generateEd25519();
  const ssk = generateEd25519();
  const usk = generateEd25519();

  // Master se signe lui-même ; SSK et USK sont signées par master
  const masterEnv = signEnvelope(
    buildKeyEnvelope(userId, "master", master.publicB64),
    userId,
    master.publicB64,
    master.privateKey,
  );
  const sskEnv = signEnvelope(
    buildKeyEnvelope(userId, "self_signing", ssk.publicB64),
    userId,
    master.publicB64,
    master.privateKey,
  );
  const uskEnv = signEnvelope(
    buildKeyEnvelope(userId, "user_signing", usk.publicB64),
    userId,
    master.publicB64,
    master.privateKey,
  );

  const url = `${homeserverUrl}/_matrix/client/v3/keys/device_signing/upload`;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };

  // 1er appel : Synapse renvoie 401 + UIA flows challenge
  const baseBody = {
    master_key: masterEnv,
    self_signing_key: sskEnv,
    user_signing_key: uskEnv,
  };
  let res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(baseBody),
  });

  if (res.status === 401) {
    const challenge = (await res.json()) as { session: string };
    if (!challenge.session) {
      throw new Error("UIA challenge sans session");
    }
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...baseBody,
        auth: {
          type: "m.login.password",
          identifier: { type: "m.id.user", user: localpart },
          password,
          session: challenge.session,
        },
      }),
    });
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `device_signing/upload échec : HTTP ${res.status} — ${text}`,
    );
  }

  return {
    masterPubB64: master.publicB64,
    masterPrivB64: master.privateB64,
    sskPubB64: ssk.publicB64,
    sskPrivB64: ssk.privateB64,
    uskPubB64: usk.publicB64,
    uskPrivB64: usk.privateB64,
  };
}

export type SignDeviceOpts = {
  homeserverUrl: string;
  userId: string;
  deviceId: string;
  accessToken: string;
  sskPrivB64: string; // déchiffré, fournis par l'appelant
};

/**
 * Signe le device de l'agent avec sa SSK et upload la signature à Synapse.
 * Pré-requis : le device doit avoir déjà uploadé ses device_keys (via
 * /keys/upload, fait par matrix-nio quand le bot démarre).
 *
 * Idempotent : Synapse accepte qu'on re-upload une signature identique.
 */
export async function signDeviceWithSsk(opts: SignDeviceOpts): Promise<void> {
  const { homeserverUrl, userId, deviceId, accessToken, sskPrivB64 } = opts;

  // 1. Récupère la device_key actuelle (telle qu'uploadée par le bot)
  const queryRes = await fetch(
    `${homeserverUrl}/_matrix/client/v3/keys/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ device_keys: { [userId]: [deviceId] } }),
    },
  );
  if (!queryRes.ok) {
    throw new Error(
      `keys/query échec : HTTP ${queryRes.status} — ${await queryRes.text()}`,
    );
  }
  const queryData = (await queryRes.json()) as {
    device_keys?: Record<string, Record<string, Record<string, unknown>>>;
  };
  const deviceKey = queryData.device_keys?.[userId]?.[deviceId];
  if (!deviceKey) {
    throw new Error(
      `device_keys absent pour ${userId}/${deviceId} — le bot n'a pas encore appelé keys/upload ?`,
    );
  }

  // 2. Sign avec SSK
  const ssk = ed25519FromPrivateB64(sskPrivB64);
  const signed = signEnvelope(
    deviceKey as Record<string, unknown>,
    userId,
    ssk.publicB64,
    ssk.privateKey,
  );

  // 3. Upload via /keys/signatures/upload
  const sigRes = await fetch(
    `${homeserverUrl}/_matrix/client/v3/keys/signatures/upload`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ [userId]: { [deviceId]: signed } }),
    },
  );
  if (!sigRes.ok) {
    throw new Error(
      `signatures/upload échec : HTTP ${sigRes.status} — ${await sigRes.text()}`,
    );
  }
  const sigData = (await sigRes.json()) as {
    failures?: Record<string, unknown>;
  };
  if (sigData.failures && Object.keys(sigData.failures).length > 0) {
    throw new Error(
      `signatures/upload retourne failures : ${JSON.stringify(sigData.failures)}`,
    );
  }
}
