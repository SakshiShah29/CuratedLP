"use client"

import {
  LayoutDashboard,
  Bot,
  TrendingUp,
  Brain,
  ScrollText,
  ArrowLeftRight,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { usePathname } from "next/navigation"
import Link from "next/link"
import Image from "next/image"

const generalLinks = [
  { icon: LayoutDashboard, label: "Dashboard", href: "/dashboard/vault" },
  { icon: ArrowLeftRight, label: "Manage", href: "/dashboard/manage" },
  { icon: TrendingUp, label: "Performance", href: "/dashboard/performance" },
  { icon: Brain, label: "Curator AI", href: "/dashboard/curator" },
  { icon: ScrollText, label: "Agent Logs", href: "/dashboard/agent-logs" },
]


interface SidebarProps {
  rebalanceCount?: number
  lastRebalanceTime?: string
}

export function Sidebar({ rebalanceCount, lastRebalanceTime }: SidebarProps) {
  const pathname = usePathname()

  const isActive = (href: string) => {
    return pathname.startsWith(href)
  }

  return (
    <aside className="w-[200px] bg-[#0a0a0a] p-4 flex flex-col min-h-screen border-r border-[#1a1a1a]">
      <Link href="/" className="flex items-center gap-1 mb-8">
        <Image src="/logo.png" alt="CuratedLP" width={38} height={38} />
        <span className="text-white font-semibold text-lg">CuratedLP</span>
      </Link>

      <div className="mb-6">
        <p className="text-[#999] text-xs uppercase tracking-wider mb-3">General</p>
        <nav className="space-y-1">
          {generalLinks.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              className={cn(
                "flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm transition-colors",
                isActive(link.href)
                  ? "bg-[#1a1a1a] text-white"
                  : "text-[#aaa] hover:text-white hover:bg-[#1a1a1a]/50"
              )}
            >
              <link.icon className="w-4 h-4" />
              <span>{link.label}</span>
              {isActive(link.href) && (
                <div className="ml-auto w-2 h-2 rounded-full bg-[#4ade80]" />
              )}
            </Link>
          ))}
        </nav>
      </div>


      <div className="mt-auto">
        <div className="bg-[#111111] rounded-2xl p-4 border border-[#2a2a2a]">
          <div className="flex items-center gap-2 mb-3">
            <div className="relative">
              <div className="w-8 h-8 rounded-full bg-[#4ade80]/20 flex items-center justify-center">
                <Bot className="w-4 h-4 text-[#4ade80]" />
              </div>
              <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-[#4ade80] border-2 border-[#111111]" />
            </div>
            <div>
              <p className="text-white text-xs font-medium">Curator Agent</p>
              <p className="text-[#4ade80] text-[10px] font-mono">Online</p>
            </div>
          </div>
          <div className="space-y-2 mb-3">
            <div className="flex items-center justify-between">
              <span className="text-[#999] text-[10px]">Last Rebalance</span>
              <span className="text-white text-[10px] font-mono">{lastRebalanceTime ?? "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#999] text-[10px]">Rebalances</span>
              <span className="text-[#4ade80] text-[10px] font-mono">{rebalanceCount ?? "—"}</span>
            </div>
          </div>
          <Link
            href="/dashboard/curator"
            className="block w-full bg-[#4ade80] text-black font-medium py-2 rounded-lg text-xs hover:bg-[#22c55e] transition-colors font-mono text-center"
          >
            View Activity
          </Link>
        </div>
      </div>
    </aside>
  )
}
