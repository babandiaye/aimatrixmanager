/**
 * Client minimal pour l'API Admin Synapse.
 * Doc : https://element-hq.github.io/synapse/latest/usage/administration/admin_api/index.html
 */
import { logger } from "@/lib/logger";

const log = logger.child({ mod: "synapse-admin" });

function getEnv() {
  const homeserver = process.env.MATRIX_HOMESERVER;
  const serverName = process.env.MATRIX_SERVER_NAME;
  const token = process.env.SYNAPSE_ADMIN_TOKEN;
  if (!homeserver || !serverName || !token) {
    throw new Error(
      "MATRIX_HOMESERVER, MATRIX_SERVER_NAME et SYNAPSE_ADMIN_TOKEN sont requis dans .env",
    );
  }
  return { homeserver, serverName, token };
}

export function buildMxid(localpart: string): string {
  const { serverName } = getEnv();
  return `@${localpart}:${serverName}`;
}

async function call<T>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const { homeserver, token } = getEnv();
  const url = `${homeserver}${path}`;
  const res = await fetch(url, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* noop */
  }
  if (!res.ok) {
    log.warn({ path, status: res.status, body: text }, "Synapse admin error");
    const errcode =
      json && typeof json === "object" && "errcode" in json
        ? (json as { errcode: string }).errcode
        : undefined;
    const error =
      json && typeof json === "object" && "error" in json
        ? (json as { error: string }).error
        : text || `HTTP ${res.status}`;
    throw new Error(`Synapse: ${errcode ?? res.status} — ${error}`);
  }
  return json as T;
}

export async function getServerVersion(): Promise<{ server_version: string }> {
  return call("/_synapse/admin/v1/server_version");
}

/** Crée ou met à jour un user Matrix. PUT idempotent. */
export async function upsertUser(args: {
  localpart: string;
  password: string;
  displayname?: string;
  admin?: boolean;
}): Promise<{ name: string; displayname: string | null; admin: boolean }> {
  const mxid = buildMxid(args.localpart);
  return call(`/_synapse/admin/v2/users/${encodeURIComponent(mxid)}`, {
    method: "PUT",
    body: {
      password: args.password,
      displayname: args.displayname,
      admin: args.admin ?? false,
      logout_devices: false,
    },
  });
}

/** Met à jour uniquement le displayname (PUT partiel, le password n'est pas changé). */
export async function setUserDisplayName(
  localpart: string,
  displayname: string,
): Promise<void> {
  const mxid = buildMxid(localpart);
  await call(`/_synapse/admin/v2/users/${encodeURIComponent(mxid)}`, {
    method: "PUT",
    body: { displayname },
  });
}

/** Crée un access_token via l'admin (sans device_id — usage limité). */
export async function loginAsUser(localpart: string): Promise<{
  access_token: string;
}> {
  const mxid = buildMxid(localpart);
  return call(`/_synapse/admin/v1/users/${encodeURIComponent(mxid)}/login`, {
    method: "POST",
    body: {},
  });
}

/** Reset le mot de passe d'un user (admin). Logout des autres sessions. */
export async function resetUserPassword(
  localpart: string,
  newPassword: string,
): Promise<void> {
  const mxid = buildMxid(localpart);
  await call(
    `/_synapse/admin/v1/reset_password/${encodeURIComponent(mxid)}`,
    {
      method: "POST",
      body: { new_password: newPassword, logout_devices: true },
    },
  );
}

/**
 * Login client classique (POST /_matrix/client/v3/login).
 * Retourne access_token + device_id (nécessaire pour l'E2EE).
 */
export async function clientLoginWithPassword(
  localpart: string,
  password: string,
): Promise<{ access_token: string; device_id: string; user_id: string }> {
  const { homeserver } = getEnv();
  const res = await fetch(`${homeserver}/_matrix/client/v3/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "m.login.password",
      identifier: { type: "m.id.user", user: localpart },
      password,
      initial_device_display_name: `aibotmanager:${localpart}`,
    }),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* noop */
  }
  if (!res.ok) {
    log.warn({ localpart, status: res.status, body: text }, "Client login error");
    const error =
      json && typeof json === "object" && "error" in json
        ? (json as { error: string }).error
        : text || `HTTP ${res.status}`;
    throw new Error(`Client login: ${error}`);
  }
  return json as { access_token: string; device_id: string; user_id: string };
}

/** Vérifie si un user Matrix existe déjà. */
export async function userExists(localpart: string): Promise<boolean> {
  const mxid = buildMxid(localpart);
  try {
    await call(`/_synapse/admin/v2/users/${encodeURIComponent(mxid)}`);
    return true;
  } catch (e) {
    if (e instanceof Error && e.message.includes("M_NOT_FOUND")) return false;
    throw e;
  }
}

/** Désactive le compte Matrix (irréversible). */
export async function deactivateUser(localpart: string): Promise<void> {
  const mxid = buildMxid(localpart);
  await call(`/_synapse/admin/v1/deactivate/${encodeURIComponent(mxid)}`, {
    method: "POST",
    body: { erase: true },
  });
}

// ─── Rooms ─────────────────────────────────────────────────────────────────

export type SynapseRoom = {
  room_id: string;
  name: string | null;
  canonical_alias: string | null;
  joined_members: number;
  joined_local_members: number;
  version: string;
  creator: string;
  encryption: string | null; // ex: "m.megolm.v1.aes-sha2"
  federatable: boolean;
  public: boolean;
  join_rules: string;
  guest_access: string | null;
  history_visibility: string;
  state_events: number;
  room_type: string | null;
};

export async function listRoomsPage(opts: {
  limit?: number;
  from?: string;
  searchTerm?: string;
}): Promise<{
  rooms: SynapseRoom[];
  total_rooms: number;
  next_batch: string | null;
}> {
  const params = new URLSearchParams();
  params.set("limit", String(opts.limit ?? 100));
  if (opts.from) params.set("from", opts.from);
  if (opts.searchTerm) params.set("search_term", opts.searchTerm);
  return call(`/_synapse/admin/v1/rooms?${params}`);
}

/** Force un user Matrix à rejoindre un salon (admin-driven join). */
export async function joinUserToRoom(args: {
  matrixUserId: string;
  matrixRoomId: string;
}): Promise<{ room_id: string }> {
  return call(
    `/_synapse/admin/v1/join/${encodeURIComponent(args.matrixRoomId)}`,
    { method: "POST", body: { user_id: args.matrixUserId } },
  );
}

/**
 * Fait quitter un user à un salon, via SON propre access_token (pas l'admin).
 * Best-effort : 403/404 ignorés (déjà parti ou jamais membre).
 */
export async function userLeaveRoom(args: {
  matrixRoomId: string;
  userAccessToken: string;
}): Promise<void> {
  const { homeserver } = getEnv();
  const url = `${homeserver}/_matrix/client/v3/rooms/${encodeURIComponent(
    args.matrixRoomId,
  )}/leave`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.userAccessToken}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  if (!res.ok && res.status !== 403 && res.status !== 404) {
    const txt = await res.text();
    throw new Error(`leave ${args.matrixRoomId} failed: ${res.status} ${txt}`);
  }
}

/** Itère toutes les pages pour récupérer la liste complète. */
export async function listAllRooms(): Promise<SynapseRoom[]> {
  const rooms: SynapseRoom[] = [];
  let from: string | undefined;
  for (;;) {
    const res = await listRoomsPage({ limit: 100, from });
    rooms.push(...res.rooms);
    if (!res.next_batch) break;
    from = res.next_batch;
  }
  return rooms;
}
