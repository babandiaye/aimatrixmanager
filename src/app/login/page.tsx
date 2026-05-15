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

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <AutoKeycloak error={sp.error} loggedOut={sp.logged_out === "1"} />
      <Footer />
    </div>
  );
}
