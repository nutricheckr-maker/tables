import type { Metadata, Viewport } from "next";
import { Nav } from "@/components/nav";
import { ServiceWorker } from "@/components/service-worker";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tables — multiplication mastery",
  description: "Adaptive, keyboard-first training for instant recall of multiplication facts up to 50 × 50.",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7f5" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0c0d" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full">
      <body className="flex min-h-full flex-col">
        <Nav />
        <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 pb-16 sm:px-6">{children}</main>
        <ServiceWorker />
      </body>
    </html>
  );
}
