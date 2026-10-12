"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/train", label: "Train" },
  { href: "/settings", label: "Settings" },
] as const;

export function Nav() {
  const path = usePathname();
  return (
    <header className="site-nav border-b border-line">
      <nav className="mx-auto flex h-14 w-full max-w-5xl items-center gap-6 px-4 sm:px-6" aria-label="Main">
        <Link href="/" className="mr-auto font-mono text-sm font-semibold tracking-tight">
          tables<span className="text-faint">/50×50</span>
        </Link>
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            aria-current={path === l.href ? "page" : undefined}
            className="text-sm text-muted hover:text-ink aria-[current=page]:font-medium aria-[current=page]:text-ink"
          >
            {l.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
