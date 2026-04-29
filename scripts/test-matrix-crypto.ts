/**
 * Vérifications cryptographiques en isolation, AVANT de toucher à Synapse :
 *  - canonicalize() respecte la spec (clés triées, pas d'espaces)
 *  - generateEd25519 + signCanonical / verifyCanonical roundtrip
 *  - signEnvelope produit une envelope vérifiable
 *  - ed25519FromPrivateB64 reconstruit la même paire (re-signature OK)
 *  - chaîne master → SSK signée par master vérifiable
 *
 * Usage : pnpm tsx scripts/test-matrix-crypto.ts
 */
import {
  buildKeyEnvelope,
  canonicalize,
  ed25519FromPrivateB64,
  generateEd25519,
  signCanonical,
  signEnvelope,
  verifyCanonical,
} from "../src/lib/matrix-crypto";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`✅ ${name}`);
  } else {
    failures++;
    console.error(`❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── Canonical JSON ──────────────────────────────────────────────────────────
const c1 = canonicalize({ b: 1, a: 2, c: { z: 3, y: 4 } });
check(
  "canonicalize trie les clés à toutes les profondeurs",
  c1 === '{"a":2,"b":1,"c":{"y":4,"z":3}}',
  c1,
);

const c2 = canonicalize({});
check("canonicalize objet vide", c2 === "{}");

const c3 = canonicalize([3, 1, 2]);
check("canonicalize array (ordre préservé)", c3 === "[3,1,2]");

const c4 = canonicalize({ k: "été" });
check(
  "canonicalize gère UTF-8 (échappé en \\uXXXX OK pour Matrix)",
  c4.startsWith('{"k":"'),
);

// ── Ed25519 keypair + sign/verify ───────────────────────────────────────────
const kp = generateEd25519();
check("Ed25519 publicB64 est non-vide et de taille raisonnable", kp.publicB64.length >= 40);
check("Ed25519 privateB64 est non-vide", kp.privateB64.length >= 40);

const message = '{"foo":"bar","x":42}';
const sig = signCanonical(kp.privateKey, message);
check("Signature non-vide", sig.length > 0);
check("verifyCanonical OK avec la bonne clé", verifyCanonical(kp.publicKey, message, sig));
check(
  "verifyCanonical KO si message altéré",
  !verifyCanonical(kp.publicKey, message + "x", sig),
);

// ── Reconstruction de la paire depuis le seed privé ─────────────────────────
const restored = ed25519FromPrivateB64(kp.privateB64);
check(
  "ed25519FromPrivateB64 retourne la même clé publique",
  restored.publicB64 === kp.publicB64,
);
const sig2 = signCanonical(restored.privateKey, message);
check(
  "Signature avec clé restaurée vérifiable par la clé publique d'origine",
  verifyCanonical(kp.publicKey, message, sig2),
);

// ── Envelope signée + vérifiable ────────────────────────────────────────────
const userId = "@kocc-barma:formation1-matrix.unchk.sn";
const envelope = signEnvelope(
  buildKeyEnvelope(userId, "master", kp.publicB64),
  userId,
  kp.publicB64,
  kp.privateKey,
);
check(
  "Envelope contient signatures[userId][ed25519:pub]",
  Boolean(envelope.signatures?.[userId]?.[`ed25519:${kp.publicB64}`]),
);

// Re-construct canonical et vérifier
const { signatures: _, ...stripped } = envelope as Record<string, unknown> & {
  signatures?: unknown;
};
const envSig = envelope.signatures![userId][`ed25519:${kp.publicB64}`];
check(
  "Signature de l'envelope vérifiable",
  verifyCanonical(kp.publicKey, canonicalize(stripped), envSig),
);

// ── Chaîne master → SSK signée par master ───────────────────────────────────
const master = generateEd25519();
const ssk = generateEd25519();
const sskEnv = signEnvelope(
  buildKeyEnvelope(userId, "self_signing", ssk.publicB64),
  userId,
  master.publicB64,
  master.privateKey,
);
const { signatures: __, ...sskStripped } = sskEnv as Record<string, unknown> & {
  signatures?: unknown;
};
const sskSig = sskEnv.signatures![userId][`ed25519:${master.publicB64}`];
check(
  "SSK envelope signée par master, vérifiable par master.pub",
  verifyCanonical(master.publicKey, canonicalize(sskStripped), sskSig),
);
check(
  "SSK envelope NON vérifiable par sa propre clé (signée par master, pas par soi-même)",
  !verifyCanonical(ssk.publicKey, canonicalize(sskStripped), sskSig),
);

// ── Verdict ─────────────────────────────────────────────────────────────────
console.log("");
if (failures === 0) {
  console.log("🎉 Tous les tests crypto passent — la lib est saine.");
  process.exit(0);
} else {
  console.error(`💥 ${failures} test(s) ont échoué.`);
  process.exit(1);
}
