"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Bot,
  TrendingUp,
  BookOpen,
  Github,
  LogOut,
} from "lucide-react";
import { usePrivy } from "@privy-io/react-auth";
import { cn } from "@/lib/utils";

const generalLinks = [
  { href: "/dashboard/vault", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/curator", label: "Curator AI", icon: Bot },
  { href: "/dashboard/performance", label: "Performance", icon: TrendingUp },
];

const otherLinks = [
  {
    href: "https://github.com/sakshishah/curatedlp",
    label: "GitHub",
    icon: Github,
    external: true,
  },
  { href: "#", label: "Docs", icon: BookOpen, external: true },
];

export function Sidebar() {
  const pathname = usePathname();
  const { logout } = usePrivy();

  return (
    <aside className="flex flex-col w-[260px] h-full border-r border-white/[0.06] bg-[#0c0c0c]">
      {/* Logo */}
      <div className="flex items-center gap-3 px-6 py-7">
        <div className="w-8 h-8 rounded-xl bg-accent-green/15 flex items-center justify-center shrink-0">
          <span className="text-accent-green font-bold text-sm">C</span>
        </div>
        <span className="text-white font-bold text-lg tracking-tight">
          CuratedLP
        </span>
      </div>

      {/* General section */}
      <nav className="flex-1 px-4 space-y-1">
        <p className="text-text-secondary text-[11px] font-medium uppercase tracking-widest px-3 mb-3 mt-2">
          General
        </p>
        {generalLinks.map((link) => {
          const isActive = pathname === link.href || pathname.startsWith(link.href + "/");
          return (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-200",
                isActive
                  ? "text-accent-green bg-accent-green/10"
                  : "text-text-secondary hover:text-text-primary hover:bg-white/[0.04]"
              )}
            >
              <link.icon className="h-[18px] w-[18px] shrink-0" />
              <span className="flex-1">{link.label}</span>
              {isActive && (
                <span className="h-2 w-2 rounded-full bg-accent-green" />
              )}
            </Link>
          );
        })}

        {/* Other section */}
        <p className="text-text-secondary text-[11px] font-medium uppercase tracking-widest px-3 mb-3 mt-6 pt-4">
          Other
        </p>
        {otherLinks.map((link) => (
          <a
            key={link.label}
            href={link.href}
            target={link.external ? "_blank" : undefined}
            rel={link.external ? "noopener noreferrer" : undefined}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-text-secondary hover:text-text-primary hover:bg-white/[0.04] transition-all duration-200"
          >
            <link.icon className="h-[18px] w-[18px] shrink-0" />
            <span>{link.label}</span>
          </a>
        ))}
      </nav>

      {/* Logout at bottom */}
      <div className="px-4 pb-6 pt-4 border-t border-white/[0.06]">
        <button
          onClick={() => logout()}
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-text-secondary hover:text-accent-red hover:bg-accent-red/5 transition-all duration-200 w-full"
        >
          <LogOut className="h-[18px] w-[18px] shrink-0" />
          <span>Logout</span>
        </button>
      </div>
    </aside>
  );
}
