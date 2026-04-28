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
  if (!res.ok) throw new Error(`HTTP ${res.status} pour ${fn}`);
  const json = await res.json();
  if (json && typeof json === "object" && "exception" in json) {
    throw new Error(
      `Moodle: ${(json as any).errorcode}: ${(json as any).message}`,
    );
  }
  return json as T;
}

async function main() {
  const platforms = await prisma.moodlePlatform.findMany({
    where: { enabled: true },
  });

  if (!platforms.length) {
    console.log("Aucune plateforme active.");
    return;
  }

  for (const p of platforms) {
    const token = decrypt(p.wsToken);
    console.log(`\n────────── ${p.key} (${p.name}) ──────────`);
    console.log(`URL: ${p.baseUrl}`);

    // 1. Site info
    try {
      const info = await callWS<{
        sitename: string;
        username: string;
        firstname: string;
        lastname: string;
        release: string;
        functions?: { name: string }[];
      }>(p.baseUrl, token, "core_webservice_get_site_info");

      console.log("✅ Connexion OK");
      console.log(`   Site         : ${info.sitename}`);
      console.log(`   Version      : ${info.release}`);
      console.log(
        `   User WS      : ${info.username} (${info.firstname} ${info.lastname})`,
      );
      console.log(
        `   Fonctions WS : ${info.functions?.length ?? "?"} disponibles`,
      );
      // Liste 5 fonctions liées aux cours
      const courseFns =
        info.functions
          ?.filter((f) => /course|webservice/i.test(f.name))
          .slice(0, 5)
          .map((f) => f.name) ?? [];
      if (courseFns.length) {
        console.log(`   Ex.          : ${courseFns.join(", ")}`);
      }
    } catch (e) {
      console.log(
        `❌ site_info: ${e instanceof Error ? e.message : String(e)}`,
      );
      continue;
    }

    // 2. Courses
    try {
      const courses = await callWS<
        Array<{
          id: number;
          shortname: string;
          fullname: string;
          visible: number;
          categoryid: number;
        }>
      >(p.baseUrl, token, "core_course_get_courses");
      console.log(`\n   Cours        : ${courses.length} récupérés`);
      courses.slice(0, 5).forEach((c) => {
        console.log(
          `     [${c.id}] ${c.shortname} — ${c.fullname} ${
            c.visible ? "" : "(caché)"
          }`,
        );
      });
      if (courses.length > 5) console.log(`     … +${courses.length - 5}`);
    } catch (e) {
      console.log(
        `❌ get_courses: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
