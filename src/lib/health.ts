import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { getServerVersion } from "@/lib/synapse-admin";
import { isOllamaConfigured } from "@/lib/ollama";

export type HealthStatus = "ok" | "warn" | "error";

export type HealthItem = {
  key: string;
  label: string;
  status: HealthStatus;
  detail?: string;
};

const TIMEOUT_MS = 2500;

function withTimeout<T>(p: Promise<T>, ms = TIMEOUT_MS): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) =>
      setTimeout(() => rej(new Error(`timeout ${ms}ms`)), ms),
    ),
  ]);
}

async function checkPostgres(): Promise<HealthItem> {
  try {
    const t0 = performance.now();
    await withTimeout(prisma.$queryRaw`SELECT 1`);
    const ms = Math.round(performance.now() - t0);
    return { key: "db", label: "PostgreSQL", status: "ok", detail: `${ms} ms` };
  } catch (e) {
    return {
      key: "db",
      label: "PostgreSQL",
      status: "error",
      detail: e instanceof Error ? e.message : "erreur",
    };
  }
}

async function checkRedis(): Promise<HealthItem> {
  try {
    const t0 = performance.now();
    const r = await withTimeout(redis.ping());
    const ms = Math.round(performance.now() - t0);
    return {
      key: "redis",
      label: "Redis",
      status: r === "PONG" ? "ok" : "warn",
      detail: `${ms} ms`,
    };
  } catch (e) {
    return {
      key: "redis",
      label: "Redis",
      status: "error",
      detail: e instanceof Error ? e.message : "erreur",
    };
  }
}

async function checkSynapse(): Promise<HealthItem> {
  try {
    const t0 = performance.now();
    const v = await withTimeout(getServerVersion());
    const ms = Math.round(performance.now() - t0);
    return {
      key: "synapse",
      label: "Synapse Matrix",
      status: "ok",
      detail: `v${v.server_version} · ${ms} ms`,
    };
  } catch (e) {
    return {
      key: "synapse",
      label: "Synapse Matrix",
      status: "error",
      detail: e instanceof Error ? e.message : "erreur",
    };
  }
}

async function checkAgentsRuntime(): Promise<HealthItem> {
  try {
    const since = new Date(Date.now() - 90 * 1000); // heartbeat < 90s
    const [enabled, alive] = await Promise.all([
      prisma.agent.count({ where: { status: "ENABLED" } }),
      prisma.agent.count({
        where: { status: "ENABLED", lastHeartbeatAt: { gte: since } },
      }),
    ]);
    if (enabled === 0) {
      return {
        key: "bot",
        label: "Bot multi-agents",
        status: "warn",
        detail: "aucun agent ENABLED",
      };
    }
    return {
      key: "bot",
      label: "Bot multi-agents",
      status: alive === enabled ? "ok" : alive > 0 ? "warn" : "error",
      detail: `${alive}/${enabled} agent(s) en ligne`,
    };
  } catch (e) {
    return {
      key: "bot",
      label: "Bot multi-agents",
      status: "error",
      detail: e instanceof Error ? e.message : "erreur",
    };
  }
}

/**
 * Vérifie fromager (serveur Ollama) :
 *  - endpoint /v1/models répond
 *  - retourne le nombre de modèles dispos
 *  - état warn si l'env n'est pas configurée (Ollama est optionnel)
 */
async function checkOllama(): Promise<HealthItem> {
  if (!isOllamaConfigured()) {
    return {
      key: "ollama",
      label: "Ollama (fromager)",
      status: "warn",
      detail: "non configuré (OLLAMA_BASE_URL/API_KEY absents)",
    };
  }
  const baseUrl = process.env.OLLAMA_BASE_URL!;
  const apiKey = process.env.OLLAMA_API_KEY!;
  try {
    const t0 = performance.now();
    const res = await withTimeout(
      fetch(`${baseUrl}/v1/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      }),
    );
    const ms = Math.round(performance.now() - t0);
    if (!res.ok) {
      return {
        key: "ollama",
        label: "Ollama (fromager)",
        status: "error",
        detail: `HTTP ${res.status} · ${ms} ms`,
      };
    }
    const data = (await res.json()) as { data?: Array<{ id: string }> };
    const count = data.data?.length ?? 0;
    // HTTP 200 mais 0 modèle = état dégradé (Ollama backend down ou rechargé) :
    // on flag en warn pour que le dashboard remonte clairement le problème.
    return {
      key: "ollama",
      label: "Ollama (fromager)",
      status: count === 0 ? "warn" : "ok",
      detail:
        count === 0
          ? `joignable mais aucun modèle visible · ${ms} ms`
          : `${count} modèle(s) · ${ms} ms`,
    };
  } catch (e) {
    return {
      key: "ollama",
      label: "Ollama (fromager)",
      status: "error",
      detail: e instanceof Error ? e.message : "erreur",
    };
  }
}

async function checkMoodlePlatforms(): Promise<HealthItem> {
  try {
    const platforms = await prisma.moodlePlatform.findMany({
      where: { enabled: true },
      select: { key: true, baseUrl: true },
    });
    if (platforms.length === 0) {
      return {
        key: "moodle",
        label: "Plateformes Moodle",
        status: "warn",
        detail: "aucune active",
      };
    }
    // ping concurrents avec timeout court
    const checks = await Promise.allSettled(
      platforms.map(async (p) => {
        const r = await withTimeout(
          fetch(`${p.baseUrl}/login/index.php`, { method: "HEAD" }),
          1500,
        );
        if (!r.ok && r.status >= 500) throw new Error(`HTTP ${r.status}`);
        return p.key;
      }),
    );
    const ok = checks.filter((c) => c.status === "fulfilled").length;
    return {
      key: "moodle",
      label: "Plateformes Moodle",
      status: ok === platforms.length ? "ok" : "warn",
      detail: `${ok}/${platforms.length} joignable(s)`,
    };
  } catch (e) {
    return {
      key: "moodle",
      label: "Plateformes Moodle",
      status: "error",
      detail: e instanceof Error ? e.message : "erreur",
    };
  }
}

export async function getSystemHealth(): Promise<HealthItem[]> {
  return Promise.all([
    checkPostgres(),
    checkRedis(),
    checkSynapse(),
    checkAgentsRuntime(),
    checkOllama(),
    checkMoodlePlatforms(),
  ]);
}
