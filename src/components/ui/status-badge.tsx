import { cn } from "@/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";

// Pill 999px (full) avec couleurs sémantiques BBB
const statusBadgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
  {
    variants: {
      status: {
        published: "bg-status-published/10 text-status-published",
        processed: "bg-status-processed/10 text-status-processed",
        unpublished: "bg-status-unpublished/10 text-status-unpublished",
        processing: "bg-status-processing/10 text-status-processing",
        error: "bg-status-error/10 text-status-error",
        neutral: "bg-muted text-muted-foreground",
      },
    },
    defaultVariants: { status: "neutral" },
  },
);

export type StatusBadgeProps = React.HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof statusBadgeVariants>;

export function StatusBadge({
  status,
  className,
  children,
  ...props
}: StatusBadgeProps) {
  return (
    <span className={cn(statusBadgeVariants({ status }), className)} {...props}>
      {children}
    </span>
  );
}
