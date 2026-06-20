import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { logout } from "./actions";

const NAV = [
  { href: "/admin", label: "Trades" },
  { href: "/admin/pricing", label: "Pricing" },
  { href: "/admin/hot-buys", label: "Hot Buys" },
  { href: "/admin/inventory", label: "Inventory" },
  { href: "/admin/catalog", label: "Catalog" },
  { href: "/admin/analyzer", label: "Analyzer" },
  { href: "/admin/settings", label: "Settings" },
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/admin/login");

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <nav className="flex items-center gap-1 overflow-x-auto">
            <span className="mr-3 whitespace-nowrap font-semibold">
              Trade Admin
            </span>
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-md px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <form action={logout} className="flex items-center gap-3">
            <span className="hidden text-sm text-neutral-500 sm:inline">
              {session.name}
            </span>
            <Button variant="outline" size="sm" type="submit">
              Log out
            </Button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
