"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import { Unbounded } from "next/font/google";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NavBar } from "@/components/ui/tubelight-navbar";
import { WalletButton } from "@/components/layout/wallet-button";
import { Github, LayoutDashboard, Home, BookOpen } from "lucide-react";

const heroFont = Unbounded({
  subsets: ["latin"],
  weight: ["800"],
});

const FaultyTerminal = dynamic(
  () => import("@/components/reactbits/FaultyTerminal"),
  { ssr: false }
);

const FuzzyText = dynamic(
  () => import("@/components/FuzzyText"),
  { ssr: false }
);

export function LandingHero() {
  return (
    <section className="relative h-screen w-full overflow-hidden bg-bg-primary">
      {/* FaultyTerminal fills the entire background */}
      <div className="absolute inset-0 z-0">
        <FaultyTerminal
          scale={1.5}
          gridMul={[2, 1]}
          digitSize={1.2}
          timeScale={0.5}
          pause={false}
          scanlineIntensity={0.5}
          glitchAmount={1}
          flickerAmount={1}
          noiseAmp={1}
          chromaticAberration={0}
          dither={0}
          curvature={0.1}
          tint="#A7EF9E"
          mouseReact
          mouseStrength={0.5}
          pageLoadAnimation
          brightness={0.45}
        />
      </div>

      {/* Dark overlay for text readability */}
      <div className="absolute inset-0 z-1 bg-black/25" />

      {/* Tubelight navbar */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.5 }}
        className="absolute top-0 left-0 right-0 z-20"
      >
        <NavBar
          items={[
            { name: "Home", url: "/", icon: Home },
            { name: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
            { name: "GitHub", url: "https://github.com/sakshishah/curatedlp", icon: Github, external: true },
            { name: "Docs", url: "#", icon: BookOpen },
          ]}
          layoutId="landing-lamp"
        />
      </motion.div>

      {/* Wallet button — top right */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.5 }}
        className="absolute top-6 right-8 z-30"
      >
        <WalletButton />
      </motion.div>

      {/* Content overlay */}
      <div className="relative z-10 flex flex-col items-center justify-center h-full px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="mb-12"
        >
          <Badge
            variant="outline"
            className="border-accent-green/30 text-accent-green bg-accent-green/10 px-5 py-2 text-sm font-mono backdrop-blur-sm"
          >
            AI-Managed Liquidity on Uniswap v4
          </Badge>
        </motion.div>

        {/* Fuzzy title */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7, duration: 0.6 }}
          className="flex items-center justify-center w-full"
        >
          <FuzzyText
            fontSize={90}
            fontWeight={800}
            fontFamily={heroFont.style.fontFamily}
            color="#ffffff"
            gradient={["#e0ffe0", "#A7EF9E", "#d4f7d4"]}
            baseIntensity={0.15}
            hoverIntensity={0.5}
            enableHover
          >
            CuratedLP
          </FuzzyText>
        </motion.div>

        {/* Subtitle */}
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.2 }}
          className="mt-12 text-white/40 text-base md:text-lg font-mono tracking-wide"
        >
          Deposit &middot; Let AI optimize &middot; Withdraw anytime
        </motion.p>

        {/* CTA buttons */}
        <motion.div
          className="flex gap-4 mt-10"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.5 }}
        >
          <Link href="/dashboard/vault">
            <Button
              size="lg"
              className="bg-accent-green text-black font-mono font-bold hover:bg-accent-green/90 px-10 py-6 text-lg rounded-full shadow-[0_0_30px_rgba(167,239,158,0.25)] hover:shadow-[0_0_50px_rgba(167,239,158,0.4)] transition-all duration-300"
            >
              Launch App
            </Button>
          </Link>
          <a
            href="https://github.com/sakshishah/curatedlp"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button
              size="lg"
              variant="outline"
              className="border-accent-green/20 text-accent-green hover:bg-accent-green/5 px-10 py-6 text-lg font-mono rounded-full backdrop-blur-sm transition-all duration-300"
            >
              <Github className="h-5 w-5 mr-2" />
              View Source
            </Button>
          </a>
        </motion.div>

        {/* Stats row */}
        <motion.div
          className="flex gap-8 md:gap-16 mt-16"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.8 }}
        >
          {[
            { label: "Protocol", value: "Uniswap v4" },
            { label: "Network", value: "Base Sepolia" },
            { label: "Strategy", value: "AI Rebalance" },
          ].map((stat) => (
            <div key={stat.label} className="text-center">
              <p className="text-white/40 text-[10px] font-mono uppercase tracking-[0.2em] mb-1">
                {stat.label}
              </p>
              <p className="text-white/80 font-mono font-bold text-base">
                {stat.value}
              </p>
            </div>
          ))}
        </motion.div>
      </div>

      {/* Bottom gradient fade */}
      <div className="absolute bottom-0 left-0 right-0 h-40 bg-gradient-to-t from-bg-primary via-bg-primary/50 to-transparent z-10" />
    </section>
  );
}
