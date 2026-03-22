"use client"

import { Search, Calendar, ArrowRight } from "lucide-react"
import { WalletButton } from "@/components/layout/wallet-button"
import { useState, useRef, useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"

interface SearchItem {
  label: string
  description: string
  href: string
  category: string
}

const SEARCH_ITEMS: SearchItem[] = [
  { label: "Dashboard", description: "Vault overview & metrics", href: "/dashboard/vault", category: "Pages" },
  { label: "Manage", description: "Deposit, withdraw & transactions", href: "/dashboard/manage", category: "Pages" },
  { label: "Performance", description: "APY, fees & capital efficiency", href: "/dashboard/performance", category: "Pages" },
  { label: "Curator AI", description: "Agent identity & activity", href: "/dashboard/curator", category: "Pages" },
  { label: "Agent Logs", description: "Filecoin cycle logs", href: "/dashboard/agent-logs", category: "Pages" },
  { label: "Deposit", description: "Deposit tokens into the vault", href: "/dashboard/manage#deposit", category: "Actions" },
  { label: "Withdraw", description: "Withdraw from the vault", href: "/dashboard/manage#withdraw", category: "Actions" },
  { label: "Vault Health", description: "Tick range & pool composition", href: "/dashboard/vault", category: "Metrics" },
  { label: "Fee Revenue", description: "Cumulative fees & APY", href: "/dashboard/performance", category: "Metrics" },
  { label: "Rebalance History", description: "Past rebalance events", href: "/dashboard/performance", category: "Metrics" },
  { label: "Smart Account", description: "Curator wallet & identity", href: "/dashboard/curator", category: "Metrics" },
]

export function Header() {
  const now = new Date()
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  const results = useMemo(() => {
    if (!query.trim()) return []
    const q = query.toLowerCase()
    return SEARCH_ITEMS.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q)
    )
  }, [query])

  const showDropdown = open && (results.length > 0 || query.trim().length > 0)

  useEffect(() => {
    setActiveIndex(0)
  }, [results])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  const navigate = (item: SearchItem) => {
    setQuery("")
    setOpen(false)
    router.push(item.href)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showDropdown) return
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === "Enter" && results[activeIndex]) {
      e.preventDefault()
      navigate(results[activeIndex])
    } else if (e.key === "Escape") {
      setOpen(false)
    }
  }

  // Group results by category
  const grouped = useMemo(() => {
    const map = new Map<string, SearchItem[]>()
    for (const item of results) {
      const list = map.get(item.category) ?? []
      list.push(item)
      map.set(item.category, list)
    }
    return map
  }, [results])

  let flatIndex = -1

  return (
    <header className="flex items-center justify-between gap-4">
      <div className="relative flex-1 sm:flex-none">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#999]" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search pages, actions..."
          className="bg-[#1a1a1a] border-none rounded-lg pl-10 pr-16 py-2.5 text-sm text-white placeholder:text-[#999] w-full sm:w-[300px] focus:outline-none focus:ring-1 focus:ring-[#4ade80]/50"
        />
        <kbd className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-[#999] bg-[#0a0a0a] px-1.5 py-0.5 rounded border border-[#333] font-mono">
          /
        </kbd>

        {showDropdown && (
          <div
            ref={dropdownRef}
            className="absolute top-full left-0 mt-2 w-[360px] bg-[#141414] border border-[#2a2a2a] rounded-xl shadow-2xl overflow-hidden z-50"
          >
            {results.length === 0 ? (
              <div className="px-4 py-6 text-center text-[#999] text-sm">
                No results for &ldquo;{query}&rdquo;
              </div>
            ) : (
              <div className="py-2 max-h-[320px] overflow-y-auto">
                {Array.from(grouped.entries()).map(([category, items]) => (
                  <div key={category}>
                    <p className="px-4 py-1.5 text-[10px] text-[#999] uppercase tracking-wider font-mono">
                      {category}
                    </p>
                    {items.map((item) => {
                      flatIndex++
                      const idx = flatIndex
                      return (
                        <button
                          key={item.label + item.href}
                          onClick={() => navigate(item)}
                          onMouseEnter={() => setActiveIndex(idx)}
                          className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                            activeIndex === idx
                              ? "bg-[#4ade80]/10"
                              : "hover:bg-[#1a1a1a]"
                          }`}
                        >
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-medium truncate ${activeIndex === idx ? "text-[#4ade80]" : "text-white"}`}>
                              {item.label}
                            </p>
                            <p className="text-xs text-[#999] truncate">{item.description}</p>
                          </div>
                          {activeIndex === idx && (
                            <ArrowRight className="w-3.5 h-3.5 text-[#4ade80] flex-shrink-0" />
                          )}
                        </button>
                      )
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-4">
        <div className="hidden sm:flex items-center gap-3 bg-[#1a1a1a] rounded-lg px-4 py-2">
          <div className="flex items-center justify-center w-8 h-8 bg-[#0a0a0a] rounded-lg">
            <span className="text-white font-semibold text-sm">{now.getDate()}</span>
          </div>
          <div className="text-left">
            <p className="text-white text-sm">{dayNames[now.getDay()]},</p>
            <p className="text-[#999] text-xs">{monthNames[now.getMonth()]}</p>
          </div>
          <Calendar className="w-4 h-4 text-[#999] ml-2" />
        </div>

        <WalletButton />
      </div>
    </header>
  )
}
