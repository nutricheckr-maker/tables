import Link from "next/link";
import type { StageReadiness } from "@/lib/engine/advancement";

export function ReadinessList({ readiness }: { readiness: StageReadiness }) {
  return (
    <ol className="divide-y divide-line rounded-lg border border-line bg-surface">
      {readiness.checks.map((c) => (
        <li key={c.id} className="flex flex-col gap-1 px-4 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <span className="flex items-center gap-2">
            <span aria-hidden className={`w-4 font-mono ${c.met ? "text-good" : "text-faint"}`}>
              {c.met ? "✓" : "○"}
            </span>
            <span className={c.met ? "text-muted" : ""}>{c.label}</span>
            <span className="sr-only">{c.met ? "(met)" : "(not met)"}</span>
          </span>
          <span className="pl-6 font-mono text-xs text-muted sm:shrink-0 sm:pl-0 sm:text-right">
            {c.id === "assessment" && !c.met && readiness.prerequisitesMet ? (
              <Link href="/train?mode=assessment" className="font-sans font-medium text-accent underline">
                Take assessment
              </Link>
            ) : (
              c.detail
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}
