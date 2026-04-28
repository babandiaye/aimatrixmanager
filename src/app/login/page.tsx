import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { isKeycloakActive } from "@/lib/auth-config";
import { Footer } from "@/components/footer";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect("/");

  const keycloakActive = await isKeycloakActive();

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <main className="flex flex-1 flex-col items-center justify-center gap-6 p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo-unchk.png"
          alt="UN-CHK"
          className="h-12 w-auto"
        />
        <LoginForm keycloakActive={keycloakActive} />
      </main>
      <Footer />
    </div>
  );
}
