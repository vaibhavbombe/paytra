"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/transactions", label: "Transactions" },
  { href: "/budgets", label: "Budgets" },
  { href: "/imports", label: "Import" },
  { href: "/accounts", label: "Accounts" },
  { href: "/rules", label: "Rules" },
  { href: "/settings", label: "Privacy" },
] as const;

/** App-wide navigation. Hidden on the sign-in page (nothing to navigate to yet). */
export function MainNav() {
  const pathname = usePathname();
  if (pathname === "/login") return null;

  return (
    <nav aria-label="Main" className="-mx-1 flex min-w-0 gap-1 overflow-x-auto text-sm">
      {LINKS.map((l) => {
        // /transactions/new still highlights "Transactions".
        const active = pathname === l.href || pathname.startsWith(`${l.href}/`);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={`shrink-0 rounded-md px-2.5 py-1.5 font-medium ${
              active ? "bg-primary text-primary-foreground" : "text-muted hover:bg-surface-hover hover:text-foreground"
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
