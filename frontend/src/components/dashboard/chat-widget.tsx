"use client"

import { ArrowUp } from "lucide-react"
import { useState, useRef, useEffect } from "react"

interface Message {
  type: "bot" | "user"
  text: string
}

const FAQ: Record<string, string> = {
  rebalance:
    "The AI curator monitors price deviations from the current tick range. When the price moves outside the concentrated liquidity bounds, or when fee capture drops below optimal thresholds, it triggers a rebalance to re-center the position.",
  fee: "Dynamic fees are adjusted each rebalance based on recent volatility. Higher volatility means higher fees to compensate LPs for impermanent loss risk. The current fee is set by the curator within enforcer-defined bounds.",
  deposit:
    "Head to the Manage page to deposit. You provide both tokens (mUSDC + mwstETH) proportional to the vault's current ratio, and receive cvLP shares representing your ownership.",
  withdraw:
    "On the Manage page, enter the amount of cvLP shares to burn. You'll receive both underlying tokens proportional to the vault's holdings. No approval needed.",
  curator:
    "The curator is an AI agent registered on-chain via MetaMask delegations. It has bounded authority to rebalance positions and adjust fees, but cannot withdraw user funds.",
  strategy:
    "CuratedLP uses concentrated liquidity on Uniswap v4. The AI curator optimizes the tick range to maximize fee capture while minimizing impermanent loss, rebalancing when market conditions shift.",
  risk: "Key risks include impermanent loss from price movements, smart contract risk, and curator misjudgment. The caveat enforcer limits curator actions to bounded fee ranges and rate-limited rebalances.",
  shares:
    "cvLP shares represent your proportional ownership of the vault. As the vault earns fees and the curator optimizes positions, share value can increase relative to deposited assets.",
}

function getBotResponse(input: string): string {
  const lower = input.toLowerCase()
  for (const [key, answer] of Object.entries(FAQ)) {
    if (lower.includes(key)) return answer
  }
  if (lower.includes("hi") || lower.includes("hello") || lower.includes("hey"))
    return "Hey! I can answer questions about rebalancing, fees, deposits, withdrawals, the curator, strategy, risk, and shares. What would you like to know?"
  if (lower.includes("help") || lower.includes("what can"))
    return "Try asking about: rebalance strategy, dynamic fees, how to deposit/withdraw, curator agent, risk, or cvLP shares."
  return "I'm not sure about that yet. Try asking about rebalancing, fees, deposits, withdrawals, curator, strategy, or risk!"
}

const INITIAL_MESSAGES: Message[] = [
  {
    type: "bot",
    text: "Welcome to CuratedLP! Ask me anything about the vault — strategy, fees, deposits, the curator agent, and more.",
  },
]

const SUGGESTIONS = ["How does rebalancing work?", "What are the risks?", "How do I deposit?"]

export function ChatWidget() {
  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES)
  const [input, setInput] = useState("")
  const [isTyping, setIsTyping] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [messages, isTyping])

  const send = (text: string) => {
    if (!text.trim()) return
    const userMsg: Message = { type: "user", text: text.trim() }
    setMessages((prev) => [...prev, userMsg])
    setInput("")
    setIsTyping(true)

    setTimeout(() => {
      const botMsg: Message = { type: "bot", text: getBotResponse(text) }
      setMessages((prev) => [...prev, botMsg])
      setIsTyping(false)
    }, 600 + Math.random() * 800)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      send(input)
    }
  }

  return (
    <div className="bg-[#f5f5f5] rounded-2xl p-4 flex flex-col h-[320px]">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-full bg-[#0a0a0a] flex items-center justify-center">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M12 2L15 8L22 9L17 14L18 21L12 18L6 21L7 14L2 9L9 8L12 2Z" fill="#4ade80"/>
          </svg>
        </div>
        <span className="text-black text-sm font-medium">Vault Assistant</span>
        <div className="w-2 h-2 rounded-full bg-[#4ade80] ml-auto" />
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-3 mb-3 pr-1">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.type === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] ${msg.type === "user" ? "" : "flex gap-2"}`}>
              {msg.type === "bot" && (
                <div className="w-8 h-8 rounded-full bg-[#0a0a0a] flex items-center justify-center flex-shrink-0">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M12 2L15 8L22 9L17 14L18 21L12 18L6 21L7 14L2 9L9 8L12 2Z" fill="#4ade80"/>
                  </svg>
                </div>
              )}
              <div
                className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                  msg.type === "user"
                    ? "bg-[#4ade80] text-black rounded-br-md"
                    : "bg-white text-black rounded-bl-md"
                }`}
              >
                {msg.text}
              </div>
            </div>
          </div>
        ))}
        {isTyping && (
          <div className="flex justify-start">
            <div className="flex gap-2">
              <div className="w-8 h-8 rounded-full bg-[#0a0a0a] flex items-center justify-center flex-shrink-0">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M12 2L15 8L22 9L17 14L18 21L12 18L6 21L7 14L2 9L9 8L12 2Z" fill="#4ade80"/>
                </svg>
              </div>
              <div className="bg-white rounded-2xl rounded-bl-md px-4 py-3 flex gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#4ade80] animate-bounce [animation-delay:0ms]" />
                <span className="w-1.5 h-1.5 rounded-full bg-[#4ade80] animate-bounce [animation-delay:150ms]" />
                <span className="w-1.5 h-1.5 rounded-full bg-[#4ade80] animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        )}

        {messages.length === 1 && !isTyping && (
          <div className="flex flex-wrap gap-2 mt-1">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="text-xs px-3 py-1.5 rounded-full border border-[#ddd] text-[#666] hover:text-[#0a0a0a] hover:border-[#4ade80] transition-colors bg-white"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="relative">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message.."
          disabled={isTyping}
          className="w-full bg-white rounded-full px-4 py-3 pr-12 text-sm text-black placeholder:text-[#999] focus:outline-none disabled:opacity-50"
        />
        <button
          onClick={() => send(input)}
          disabled={!input.trim() || isTyping}
          className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-[#4ade80] rounded-full flex items-center justify-center hover:bg-[#22c55e] transition-colors disabled:opacity-30 disabled:hover:bg-[#4ade80]"
        >
          <ArrowUp className="w-4 h-4 text-black" />
        </button>
      </div>
    </div>
  )
}
