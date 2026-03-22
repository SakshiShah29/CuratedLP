import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/providers/providers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CuratedLP — AI-Managed Liquidity on Uniswap v4",
  description:
    "AI-managed concentrated liquidity vault on Uniswap v4. Deposit passively, let the AI curator optimize your LP positions on Base.",
  icons: {
    icon: "/logo.png",
    apple: "/logo.png",
  },
  openGraph: {
    title: "CuratedLP — AI-Managed Liquidity on Uniswap v4",
    description:
      "Deposit passively into an AI-managed concentrated liquidity vault on Uniswap v4. Built on Base.",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "CuratedLP" }],
    type: "website",
    siteName: "CuratedLP",
  },
  twitter: {
    card: "summary_large_image",
    title: "CuratedLP — AI-Managed Liquidity on Uniswap v4",
    description:
      "Deposit passively into an AI-managed concentrated liquidity vault on Uniswap v4. Built on Base.",
    images: ["/og-image.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col bg-bg-primary">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
