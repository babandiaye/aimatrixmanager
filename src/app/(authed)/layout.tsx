import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AuthedShell } from "@/components/authed-shell";

export default async function AuthedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <AuthedShell
      role={session.user.role}
      user={{
        name: session.user.name,
        email: session.user.email!,
        role: session.user.role,
      }}
    >
      {children}
    </AuthedShell>
  );
}
