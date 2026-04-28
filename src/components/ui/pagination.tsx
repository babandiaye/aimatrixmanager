import Link from "next/link";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
} from "@heroicons/react/24/outline";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type PaginationProps = {
  page: number;
  pageSize: number;
  total: number;
  hrefBase: string; // ex: "/agents" — on append ?page=N
  className?: string;
};

export function Pagination({
  page,
  pageSize,
  total,
  hrefBase,
  className,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;

  const prev = page > 1 ? page - 1 : null;
  const next = page < totalPages ? page + 1 : null;

  // Calcule la liste des pages à afficher (max 7 visibles)
  const pages: (number | "…")[] = [];
  const window = 1; // 1 voisin de chaque côté de la page courante
  const add = (n: number) => pages.push(n);
  add(1);
  if (page - window > 2) pages.push("…");
  for (
    let i = Math.max(2, page - window);
    i <= Math.min(totalPages - 1, page + window);
    i++
  ) {
    add(i);
  }
  if (page + window < totalPages - 1) pages.push("…");
  if (totalPages > 1) add(totalPages);

  const url = (n: number) => {
    const sep = hrefBase.includes("?") ? "&" : "?";
    return `${hrefBase}${sep}page=${n}`;
  };
  const itemCls = (active = false) =>
    cn(
      buttonVariants({ variant: active ? "default" : "outline", size: "sm" }),
      "min-w-9",
    );

  return (
    <nav
      className={cn("flex items-center justify-between gap-2", className)}
      aria-label="pagination"
    >
      <div className="text-xs text-muted-foreground">
        Page {page} sur {totalPages} — {total} élément(s)
      </div>
      <div className="flex items-center gap-1">
        {prev ? (
          <Link href={url(prev)} className={itemCls()} aria-label="Précédent">
            <ChevronLeftIcon className="size-4" />
          </Link>
        ) : (
          <span
            className={cn(itemCls(), "opacity-50 pointer-events-none")}
            aria-hidden
          >
            <ChevronLeftIcon className="size-4" />
          </span>
        )}
        {pages.map((p, i) =>
          p === "…" ? (
            <span
              key={`e${i}`}
              className="px-2 text-xs text-muted-foreground"
              aria-hidden
            >
              …
            </span>
          ) : (
            <Link
              key={p}
              href={url(p)}
              className={itemCls(p === page)}
              aria-current={p === page ? "page" : undefined}
            >
              {p}
            </Link>
          ),
        )}
        {next ? (
          <Link href={url(next)} className={itemCls()} aria-label="Suivant">
            <ChevronRightIcon className="size-4" />
          </Link>
        ) : (
          <span
            className={cn(itemCls(), "opacity-50 pointer-events-none")}
            aria-hidden
          >
            <ChevronRightIcon className="size-4" />
          </span>
        )}
      </div>
    </nav>
  );
}
