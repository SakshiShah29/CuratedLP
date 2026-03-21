"use client"

import { ArrowUp } from "lucide-react"
import { useState } from "react"

const messages = [
  {
    type: "bot",
    text: "Welcome to CuratedLP! I can help you understand the vault's strategy and performance.",
    time: "",
  },
  {
    type: "bot",
    text: "The AI curator continuously monitors market conditions and rebalances your concentrated liquidity position for optimal fee capture.",
    time: "",
  },
  {
    type: "user",
    text: "How does the AI decide when to rebalance?",
    time: "",
  },
]

export function ChatWidget() {
  const [message, setMessage] = useState("")

  return (
    <div className="bg-[#f5f5f5] rounded-2xl p-4 flex flex-col h-[280px]">
      <div className="flex-1 overflow-y-auto space-y-3 mb-4">
        {messages.map((msg, index) => (
          <div
            key={index}
            className={`flex ${msg.type === "user" ? "justify-end" : "justify-start"}`}
          >
            <div className={`max-w-[85%] ${msg.type === "user" ? "" : "flex gap-2"}`}>
              {msg.type === "bot" && (
                <div className="w-8 h-8 rounded-full bg-[#0a0a0a] flex items-center justify-center flex-shrink-0">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M12 2L15 8L22 9L17 14L18 21L12 18L6 21L7 14L2 9L9 8L12 2Z" fill="#4ade80"/>
                  </svg>
                </div>
              )}
              <div>
                <div
                  className={`px-4 py-2.5 rounded-2xl text-sm ${
                    msg.type === "user"
                      ? "bg-[#4ade80] text-black rounded-br-md"
                      : "bg-white text-black rounded-bl-md"
                  }`}
                >
                  {msg.text}
                </div>
                {msg.time && (
                  <p className={`text-[10px] text-[#999] mt-1 ${msg.type === "user" ? "text-right" : ""}`}>
                    {msg.time}
                  </p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="relative">
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Type a message.."
          className="w-full bg-white rounded-full px-4 py-3 pr-12 text-sm text-black placeholder:text-[#999] focus:outline-none"
        />
        <button className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-[#4ade80] rounded-full flex items-center justify-center hover:bg-[#22c55e] transition-colors">
          <ArrowUp className="w-4 h-4 text-black" />
        </button>
      </div>
    </div>
  )
}
