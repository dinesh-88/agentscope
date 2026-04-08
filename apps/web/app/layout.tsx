import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";

import "./globals.css";

const GA_MEASUREMENT_ID = "G-SP1K4TV8NF";
const GTM_CONTAINER_ID = "GTM-5P7Z4J4P";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: {
    default: "AgentScope",
    template: "%s | AgentScope",
  },
  description: "Observe, debug, and optimize AI agents with traces, root-cause analysis, and cost insights.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "AgentScope",
    description: "Observe, debug, and optimize AI agents with traces, root-cause analysis, and cost insights.",
    url: "/",
    siteName: "AgentScope",
    type: "website",
  },
  robots: {
    index: true,
    follow: true,
  },
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml", sizes: "any" },
    ],
    shortcut: ["/favicon.svg"],
    apple: [{ url: "/apple-touch-icon.svg" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <Script id="data-layer-init" strategy="beforeInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
          `}
        </Script>
        <Script id="google-tag-manager" strategy="beforeInteractive">
          {`
            (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
            new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
            j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
            'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
            })(window,document,'script','dataLayer','${GTM_CONTAINER_ID}');
          `}
        </Script>
      </head>
      <body className={`${inter.variable} antialiased`}>
        <noscript>
          <iframe
            src={`https://www.googletagmanager.com/ns.html?id=${GTM_CONTAINER_ID}`}
            height="0"
            width="0"
            style={{ display: "none", visibility: "hidden" }}
          />
        </noscript>
        <Script
          src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', '${GA_MEASUREMENT_ID}');
          `}
        </Script>
        <Script id="cta-click-tracking" strategy="afterInteractive">
          {`
            (function () {
              window.dataLayer = window.dataLayer || [];

              function normalizeText(value) {
                return String(value || "").replace(/\\s+/g, " ").trim();
              }

              function pushCtaClick(payload) {
                window.dataLayer.push({
                  event: "cta_click",
                  button_text: normalizeText(payload.button_text),
                  location: normalizeText(payload.location) || "unknown",
                  page: payload.page || window.location.pathname
                });
              }

              window.agentscopeTrackCtaClick = pushCtaClick;

              document.addEventListener("click", function (event) {
                var target = event.target;
                if (!(target instanceof Element)) {
                  return;
                }
                var cta = target.closest("[data-cta-track='true']");
                if (!cta) {
                  return;
                }
                var buttonText = cta.getAttribute("data-cta-text") || cta.textContent || "";
                var location = cta.getAttribute("data-cta-location") || "unknown";
                pushCtaClick({
                  button_text: buttonText,
                  location: location,
                  page: window.location.pathname
                });
              });
            })();
          `}
        </Script>
        {children}
      </body>
    </html>
  );
}
