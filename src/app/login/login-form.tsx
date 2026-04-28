"use client";

import { useActionState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginWithCredentials, loginWithKeycloak } from "./actions";

export function LoginForm({ keycloakActive }: { keycloakActive: boolean }) {
  const [state, formAction, pending] = useActionState(
    loginWithCredentials,
    undefined,
  );

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl">aibotmanager</CardTitle>
        <CardDescription>Connecte-toi pour gérer tes agents.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {keycloakActive && (
          <>
            <form action={loginWithKeycloak}>
              <Button type="submit" className="w-full" size="lg">
                Se connecter avec Keycloak UNCHK
              </Button>
            </form>
            <div className="relative py-2">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">
                  ou en local
                </span>
              </div>
            </div>
          </>
        )}

        <form action={formAction} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="admin@unchk.sn"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Mot de passe</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>
          {state?.error && (
            <p className="text-sm text-destructive">{state.error}</p>
          )}
          <Button
            type="submit"
            variant={keycloakActive ? "outline" : "default"}
            className="w-full"
            disabled={pending}
          >
            {pending ? "Connexion..." : "Se connecter"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
