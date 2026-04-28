import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { decrypt } from "../src/lib/crypto";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function callWS<T = unknown>(
  baseUrl: string,
  token: string,
  fn: string,
  params: Record<string, string> = {},
): Promise<T> {
  const url = new URL("/webservice/rest/server.php", baseUrl);
  url.searchParams.set("wstoken", token);
  url.searchParams.set("wsfunction", fn);
  url.searchParams.set("moodlewsrestformat", "json");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { method: "POST" });
  const json = await res.json();
  if (json && typeof json === "object" && "exception" in json) {
    throw new Error(
      `${(json as any).errorcode}: ${(json as any).message}`,
    );
  }
  return json as T;
}

async function main() {
  const p = await prisma.moodlePlatform.findFirstOrThrow({
    where: { key: "DISIDEV" },
  });
  const token = decrypt(p.wsToken);

  const info = await callWS<{ functions: { name: string }[] }>(
    p.baseUrl,
    token,
    "core_webservice_get_site_info",
  );

  console.log(`\n=== ${info.functions.length} fonctions WS autorisées ===`);
  info.functions.forEach((f) => console.log(`  • ${f.name}`));

  console.log("\n=== Test core_course_get_courses_by_field (tous) ===");
  try {
    const r = await callWS<{ courses: { id: number; fullname: string; shortname: string; visible: number }[] }>(
      p.baseUrl,
      token,
      "core_course_get_courses_by_field",
    );
    console.log(`✅ ${r.courses.length} cours récupérés`);
    r.courses.slice(0, 10).forEach((c) =>
      console.log(`   [${c.id}] ${c.shortname} — ${c.fullname}`),
    );
    if (r.courses.length > 10) console.log(`   … +${r.courses.length - 10}`);
  } catch (e) {
    console.log(`❌ ${e instanceof Error ? e.message : e}`);
  }

  // Si mod_matrix expose des fonctions WS
  const matrixFns = info.functions.filter((f) =>
    /matrix/i.test(f.name),
  );
  if (matrixFns.length) {
    console.log(`\n=== Fonctions mod_matrix détectées ===`);
    matrixFns.forEach((f) => console.log(`  • ${f.name}`));
  } else {
    console.log("\nℹ️  Aucune fonction mod_matrix exposée par ce token.");
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
