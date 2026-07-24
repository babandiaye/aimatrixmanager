import { cn } from "@/lib/utils";

/**
 * Avatar rond bleu avec initiales (fallback quand pas de photo de profil).
 * Extrait la première lettre du prénom et du nom depuis le displayName —
 * si un seul mot, prend les 2 premières lettres.
 */
function getInitials(name: string | null | undefined, email: string): string {
  const source = (name ?? email.split("@")[0]).trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

export function UserAvatar({
  name,
  email,
  size = "md",
  className,
}: {
  name?: string | null;
  email: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const sizeMap = {
    sm: "size-8 text-xs",
    md: "size-10 text-sm",
    lg: "size-14 text-base",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground shadow-sm ring-2 ring-primary/20",
        sizeMap[size],
        className,
      )}
      aria-hidden
    >
      {getInitials(name, email)}
    </span>
  );
}
