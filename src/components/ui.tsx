import type { ComponentProps, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-ink text-bg hover:opacity-90 disabled:opacity-40",
  secondary: "border border-line-strong bg-surface text-ink hover:border-ink disabled:opacity-40",
  ghost: "text-muted hover:text-ink disabled:opacity-40",
};

export function Button({
  variant = "secondary",
  className = "",
  ...props
}: ComponentProps<"button"> & { variant?: Variant }) {
  return (
    <button
      type="button"
      className={`inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}

export function Section({ title, aside, children, id }: { title: string; aside?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="mt-10" aria-labelledby={id}>
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 id={id} className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 font-mono text-2xl font-semibold tracking-tight">{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-faint">{sub}</div> : null}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-line-strong px-1.5 py-0.5 font-mono text-[11px] text-muted">{children}</kbd>
  );
}

export function Loading() {
  return <p className="mt-16 text-sm text-muted">Loading progress…</p>;
}
