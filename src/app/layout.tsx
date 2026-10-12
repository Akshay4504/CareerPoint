import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { HydrationMarker } from "@/components/hydration-marker";

export const metadata: Metadata = {
  title: { default: "CareerPoint — Your BIM career, one intelligent profile", template: "%s · CareerPoint" },
  description: "Build your BIM profile, discover relevant opportunities, and track your career from one place.",
  metadataBase: new URL(process.env.APP_URL ?? "http://localhost:3000"),
};

export const viewport: Viewport = { themeColor: "#ffffff", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-ink focus:px-3 focus:py-2 focus:text-white">
          Skip to content
        </a>
        {children}
        <HydrationMarker />
      </body>
    </html>
  );
}
