"use server";

import { signIn } from "@/auth";
import { AuthError } from "next-auth";
import { z } from "zod";

const schema = z.object({
  email: z.string().email("Email invalide"),
  password: z.string().min(1, "Mot de passe requis"),
});

export type LoginState = { error?: string } | undefined;

export async function loginWithCredentials(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = schema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: "/",
    });
  } catch (e) {
    if (e instanceof AuthError) {
      return { error: "Email ou mot de passe incorrect." };
    }
    throw e; // les redirects de NextAuth passent par cette voie — laisser remonter
  }
}

export async function loginWithKeycloak() {
  await signIn("keycloak", { redirectTo: "/" });
}
