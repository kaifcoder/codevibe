import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import {
  ClerkProvider,
  SignedIn
} from "@clerk/nextjs";
import { dark } from "@clerk/themes";
import { TRPCReactProvider } from "@/trpc/client";
import { Toaster } from "@/components/ui/sonner";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider } from "@/components/theme-provider";
import { SiteHeader } from "@/components/site-header";
import { BackendWarmup } from "@/components/backend-warmup";
import { SettingsProvider } from "@/contexts/settings-context";
import { getSiteUrl } from "@/lib/site-url";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Analytics } from '@vercel/analytics/next';

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  title: {
    default: "CodeVibe — Build apps with AI in your browser",
    template: "%s · CodeVibe",
  },
  description:
    "Describe an app. CodeVibe's AI agent generates a working Next.js project in a live sandbox you can edit, share, and deploy.",
  applicationName: "CodeVibe",
  keywords: [
    "AI code editor",
    "Next.js generator",
    "AI app builder",
    "live sandbox",
    "collaborative coding",
    "Claude code agent",
    "n8n workflow builder",
  ],
  authors: [{ name: "CodeVibe" }],
  creator: "CodeVibe",
  openGraph: {
    type: "website",
    siteName: "CodeVibe",
    title: "CodeVibe — Build apps with AI in your browser",
    description:
      "Describe an app. CodeVibe's AI agent generates a working Next.js project in a live sandbox you can edit, share, and deploy.",
    url: "/",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "CodeVibe — Build apps with AI in your browser",
    description:
      "Describe an app. CodeVibe's AI agent generates a working Next.js project in a live sandbox.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  category: "technology",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider
      appearance={{
        baseTheme: dark,
      }}
    >
      <TRPCReactProvider>
        <html lang="en" suppressHydrationWarning>
          <body
            className={`${geistSans.variable} ${geistMono.variable} antialiased h-screen w-full overflow-hidden`}
          >
            {/* SoftwareApplication JSON-LD for rich search results.
                Uses next/script so React 19 / Next 16 don't reject the
                inline <script> child. strategy="afterInteractive" is fine
                — search crawlers parse the rendered HTML, not the runtime
                state, and Next still ships the tag in the initial HTML. */}
            <Script
              id="ld-software-application"
              type="application/ld+json"
              strategy="afterInteractive"
              dangerouslySetInnerHTML={{
                __html: JSON.stringify({
                  "@context": "https://schema.org",
                  "@type": "SoftwareApplication",
                  name: "CodeVibe",
                  description:
                    "AI-powered collaborative code editor that generates working Next.js applications from natural-language prompts.",
                  applicationCategory: "DeveloperApplication",
                  operatingSystem: "Web",
                  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
                  url: getSiteUrl(),
                }),
              }}
            />
            <ThemeProvider
              attribute="class"
              defaultTheme="system"
              enableSystem
              disableTransitionOnChange
            >
              <SidebarProvider
                defaultOpen={false}
                style={
                  {
                    "--sidebar-width": "calc(var(--spacing) * 72)",
                    "--header-height": "calc(var(--spacing) * 12)",
                  } as React.CSSProperties
                }
                className="h-screen"
              >
                <SettingsProvider>
                  <SignedIn>
                    <AppSidebar variant="inset" />
                  </SignedIn>
                  <SidebarInset className="flex flex-col overflow-hidden">
                      <SiteHeader />
                    <div className="flex-1 overflow-hidden">
                      <Toaster />
                      <BackendWarmup />
                      {children}
                    </div>
                  </SidebarInset>
                </SettingsProvider>
              </SidebarProvider>
            </ThemeProvider>
            <SpeedInsights />
            <Analytics />
          </body>
        </html>
      </TRPCReactProvider>
    </ClerkProvider>
  );
}
