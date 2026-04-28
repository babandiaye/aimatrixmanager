import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { Sidebar } from "@/components/sidebar";
import { Footer } from "@/components/footer";
import { Button } from "@/components/ui/button";
import { ArrowLeftStartOnRectangleIcon } from "@heroicons/react/24/outline";

export default async function AuthedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar role={session.user.role} />
      <div className="flex flex-1 flex-col">
        <header className="flex h-14 items-center justify-end gap-4 border-b border-border bg-card px-6">
          <div className="text-right text-sm">
            <div className="font-medium text-foreground">
              {session.user.name ?? session.user.email}
            </div>
            <div className="text-xs text-muted-foreground">
              {session.user.role}
              {session.user.name && session.user.email && (
                <> · {session.user.email}</>
              )}
            </div>
          </div>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <Button type="submit" variant="destructive" size="sm">
              <ArrowLeftStartOnRectangleIcon className="size-4" />
              Déconnexion
            </Button>
          </form>
        </header>
        <main className="flex-1 p-6">{children}</main>
        <Footer />
      </div>
    </div>
  );
}
