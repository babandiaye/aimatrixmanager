import "dotenv/config";
import { enqueueRagIndex, getRagJobStatusByCourse } from "@/lib/queue/rag";
import { prisma } from "@/lib/prisma";

async function main() {
  const courseId = "cmp60afjl004xod7i0p3xs2z8"; // TEST DITSI BBB
  const r = await enqueueRagIndex({ courseDbId: courseId, triggeredBy: "manual-test" });
  console.log("Enqueued:", r);

  // Poll status toutes les 3 secondes max 5 min
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const s = await getRagJobStatusByCourse(courseId);
    console.log(`  [${i*3}s] state=${s.state} progress=${s.progress}%`);
    if (s.state === "completed" || s.state === "failed") {
      console.log("FINAL:", JSON.stringify(s, null, 2));
      break;
    }
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error("ERR", e); process.exit(1); });
