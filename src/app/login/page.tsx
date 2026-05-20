import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Footer } from "@/components/footer";
import { AutoKeycloak } from "./auto-keycloak";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; logged_out?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  const sp = await searchParams;

  // Cas nominal : pas d'erreur, pas de post-logout → on redirige côté
  // serveur vers le route handler qui appelle signIn("keycloak"). Le
  // navigateur fait 2 redirects en chaîne mais ne rend aucun HTML
  // intermédiaire — plus de flash "Redirection vers Keycloak…".
  // On reste sur un RSC ici (qui ne peut pas écrire de cookies), c'est
  // le route handler qui s'en charge.
  if (!sp.error && sp.logged_out !== "1") {
    redirect("/api/auth/sso-keycloak");
  }

  // On n'arrive ici que pour afficher une erreur ou un message post-logout.
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <AutoKeycloak error={sp.error} loggedOut={sp.logged_out === "1"} />
      <Footer />
    </div>
  );
}
