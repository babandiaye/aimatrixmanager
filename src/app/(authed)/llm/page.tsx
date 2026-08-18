import { redirect } from "next/navigation";
import { CpuChipIcon } from "@heroicons/react/24/outline";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";
import { LLM_PUBLIC_SELECT, visibleLlmsFilter } from "@/lib/llm-access";
import { PageHeader } from "@/components/ui/page-header";
import { LlmClient } from "./llm-client";

export const dynamic = "force-dynamic";

export default async function LlmPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!can(session.user.role, "llm.manage-own")) redirect("/");

  const ctx = { role: session.user.role, userId: session.user.id };

  const [configs, me] = await Promise.all([
    prisma.llmConfig.findMany({
      where: visibleLlmsFilter(ctx),
      orderBy: [{ scope: "asc" }, { isDefault: "desc" }, { createdAt: "desc" }],
      select: LLM_PUBLIC_SELECT,
    }),
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { defaultLlmConfigId: true },
    }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={CpuChipIcon}
        title="Mes fournisseurs IA"
        description="Déclarez votre propre clé Anthropic ou OpenAI pour vos agents. Sans configuration personnelle, vos agents utilisent le fournisseur de l'établissement."
      />
      <LlmClient
        configs={configs.map((c) => ({
          ...c,
          createdAt: c.createdAt.toISOString(),
          isMine: c.userId === session.user.id,
        }))}
        defaultLlmConfigId={me?.defaultLlmConfigId ?? null}
        canManageShared={can(session.user.role, "llm.manage-shared")}
      />
    </div>
  );
}
