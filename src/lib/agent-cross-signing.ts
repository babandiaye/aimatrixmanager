/**
 * Orchestrateurs DB-aware pour le cross-signing des agents :
 *  - setupCrossSigningForAgent : upload XS keys + persistance encrypted en DB
 *  - signAgentDevice : signe le device courant avec la SSK déjà persistée
 *
 * Les deux fonctions sont idempotentes côté Synapse (Matrix accepte les
 * re-uploads), donc rejouer après une erreur réseau ne casse rien.
 */
import { prisma } from "@/lib/prisma";
import { encrypt, decrypt } from "@/lib/crypto";
import { logger } from "@/lib/logger";
import {
  signDeviceWithSsk,
  uploadCrossSigningKeys,
} from "@/lib/matrix-crypto";

const log = logger.child({ mod: "agent-cross-signing" });

function homeserverUrl(): string {
  const url = process.env.MATRIX_HOMESERVER;
  if (!url) throw new Error("MATRIX_HOMESERVER absent du .env");
  return url.replace(/\/$/, "");
}

export type SetupAgentXsOpts = {
  agentId: string;
  userId: string; // "@kocc-barma:..."
  localpart: string; // "kocc-barma"
  password: string; // pour l'UIA — consommé puis oublié
  accessToken: string;
};

/**
 * Génère + uploade les cross-signing keys, puis persiste la SSK chiffrée
 * dans `AgentCrossSigning`. Upsert : si une ligne existait déjà, elle est
 * écrasée (cas d'une re-rotation après échec, ou agent avec XS partielles).
 *
 * Le device n'est PAS signé ici — il faut que le bot ait d'abord uploadé
 * ses device_keys via matrix-nio (donc après que le runner ait démarré).
 * Voir signAgentDevice() pour la suite.
 */
export async function setupCrossSigningForAgent(
  opts: SetupAgentXsOpts,
): Promise<void> {
  const result = await uploadCrossSigningKeys({
    homeserverUrl: homeserverUrl(),
    userId: opts.userId,
    localpart: opts.localpart,
    password: opts.password,
    accessToken: opts.accessToken,
  });

  await prisma.agentCrossSigning.upsert({
    where: { agentId: opts.agentId },
    create: {
      agentId: opts.agentId,
      masterPubKey: result.masterPubB64,
      sskPubKey: result.sskPubB64,
      uskPubKey: result.uskPubB64,
      sskPrivEnc: encrypt(result.sskPrivB64),
    },
    update: {
      masterPubKey: result.masterPubB64,
      sskPubKey: result.sskPubB64,
      uskPubKey: result.uskPubB64,
      sskPrivEnc: encrypt(result.sskPrivB64),
      // Reset signed device — la nouvelle SSK doit re-signer
      signedDeviceId: null,
      deviceSignedAt: null,
    },
  });

  log.info(
    { agentId: opts.agentId, masterPub: result.masterPubB64 },
    "Cross-signing keys uploaded",
  );
}

export type SignAgentDeviceOpts = {
  agentId: string;
  userId: string;
  deviceId: string;
  accessToken: string;
};

/**
 * Signe le device courant de l'agent avec sa SSK déjà persistée. Idempotent.
 * Throw si l'agent n'a pas (encore) de cross-signing setup, ou si Synapse ne
 * connaît pas encore les device_keys (= bot pas encore démarré).
 */
export async function signAgentDevice(
  opts: SignAgentDeviceOpts,
): Promise<void> {
  const xs = await prisma.agentCrossSigning.findUnique({
    where: { agentId: opts.agentId },
    select: { sskPrivEnc: true },
  });
  if (!xs) {
    throw new Error(
      "Cross-signing pas encore configuré pour cet agent — lance setupCrossSigningForAgent() d'abord.",
    );
  }

  await signDeviceWithSsk({
    homeserverUrl: homeserverUrl(),
    userId: opts.userId,
    deviceId: opts.deviceId,
    accessToken: opts.accessToken,
    sskPrivB64: decrypt(xs.sskPrivEnc),
  });

  await prisma.agentCrossSigning.update({
    where: { agentId: opts.agentId },
    data: {
      signedDeviceId: opts.deviceId,
      deviceSignedAt: new Date(),
    },
  });

  log.info(
    { agentId: opts.agentId, deviceId: opts.deviceId },
    "Device signé par SSK",
  );
}
