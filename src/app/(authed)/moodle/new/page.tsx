import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { can } from "@/lib/permissions";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PlatformForm } from "../platform-form";

export default async function NewPlatformPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!can(session.user.role, "moodle.create")) redirect("/moodle");

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">
          Nouvelle plateforme Moodle
        </h1>
        <p className="text-muted-foreground">
          Renseigne l&apos;URL et le token Web Services pour permettre à
          aibotmanager d&apos;y accéder.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Configuration</CardTitle>
          <CardDescription>
            Tous les champs marqués <span className="text-destructive">*</span>{" "}
            sont requis.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PlatformForm />
        </CardContent>
      </Card>
    </div>
  );
}
