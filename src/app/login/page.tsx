import { redirect } from "next/navigation";
import { auth } from "@/auth";
import {
  isEmergencyLocalLogin,
  isKeycloakConfigured,
} from "@/lib/auth-config";
import { Footer } from "@/components/footer";
import { LoginForm } from "./login-form";
import { AutoKeycloak } from "./auto-keycloak";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ manual?: string; error?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  const sp = await searchParams;
  const keycloakConfigured = isKeycloakConfigured();
  const emergency = isEmergencyLocalLogin();

  // Bypass : ?manual=1 → form local, mais utile uniquement si EMERGENCY_LOCAL_LOGIN=1
  // (sans le flag, le provider Credentials n'existe pas et le form ne sert à rien)
  const showLocalForm = sp.manual === "1" && emergency;

  // Si Keycloak configuré ET pas en mode urgence affiché → auto-redirect Keycloak.
  // C'est le chemin nominal — toute personne arrivant sur /login part vers SSO.
  if (keycloakConfigured && !showLocalForm) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <AutoKeycloak emergency={emergency} error={sp.error} />
        <Footer />
      </div>
    );
  }

  // Cas dégradé : Keycloak pas configuré OU mode urgence demandé via ?manual=1
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <main className="flex flex-1 flex-col items-center justify-center gap-6 p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-unchk.png" alt="UN-CHK" className="h-12 w-auto" />
        <LoginForm
          emergency={emergency}
          keycloakConfigured={keycloakConfigured}
          error={sp.error}
        />
      </main>
      <Footer />
    </div>
  );
}
