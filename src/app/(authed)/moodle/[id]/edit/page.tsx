import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PlatformForm } from "../../platform-form";

export default async function EditPlatformPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!can(session.user.role, "moodle.update")) redirect("/moodle");

  const { id } = await params;
  const platform = await prisma.moodlePlatform.findUnique({ where: { id } });
  if (!platform) notFound();

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">
          Modifier {platform.name}
        </h1>
        <p className="text-muted-foreground">
          Plateforme <code className="font-mono text-xs">{platform.key}</code>
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Configuration</CardTitle>
          <CardDescription>
            Le token actuel n&apos;est pas affiché. Saisis-en un nouveau pour
            le remplacer, ou laisse vide pour conserver l&apos;actuel.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PlatformForm
            initial={{
              id: platform.id,
              key: platform.key,
              name: platform.name,
              baseUrl: platform.baseUrl,
              wsUsername: platform.wsUsername,
              enabled: platform.enabled,
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
