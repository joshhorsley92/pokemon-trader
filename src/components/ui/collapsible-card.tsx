import type { ReactNode } from "react";

/**
 * A Card that collapses/expands with a native <details> (no client JS), styled
 * to match the shadcn Card. Usable in server or client components.
 */
export function CollapsibleCard({
  title,
  description,
  right,
  defaultOpen = true,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  right?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      open={defaultOpen}
      className="group overflow-hidden rounded-xl bg-card text-sm text-card-foreground ring-1 ring-foreground/10"
    >
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3 p-4 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-neutral-400 transition-transform group-open:rotate-90">
              ▸
            </span>
            <span className="font-heading text-base font-medium leading-snug">
              {title}
            </span>
          </div>
          {description && (
            <p className="mt-1 pl-6 text-sm text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {right && <div className="shrink-0 text-right">{right}</div>}
      </summary>
      <div className="p-4 pt-0">{children}</div>
    </details>
  );
}
