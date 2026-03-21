"use client"

import { Search, Calendar } from "lucide-react"
import { WalletButton } from "@/components/layout/wallet-button"

export function Header() {
  const now = new Date()
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

  return (
    <header className="flex items-center justify-between">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#666]" />
        <input
          type="text"
          placeholder="Type here.."
          className="bg-[#1a1a1a] border-none rounded-lg pl-10 pr-4 py-2.5 text-sm text-white placeholder:text-[#666] w-[250px] focus:outline-none focus:ring-1 focus:ring-[#4ade80]/50"
        />
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-3 bg-[#1a1a1a] rounded-lg px-4 py-2">
          <div className="flex items-center justify-center w-8 h-8 bg-[#0a0a0a] rounded-lg">
            <span className="text-white font-semibold text-sm">{now.getDate()}</span>
          </div>
          <div className="text-left">
            <p className="text-white text-sm">{dayNames[now.getDay()]},</p>
            <p className="text-[#666] text-xs">{monthNames[now.getMonth()]}</p>
          </div>
          <Calendar className="w-4 h-4 text-[#666] ml-2" />
        </div>

        <WalletButton />
      </div>
    </header>
  )
}
