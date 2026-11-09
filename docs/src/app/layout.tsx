import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { RootProvider } from 'fumadocs-ui/provider/next';
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "DroneOS — Programmable Drone SDK & Command Center",
    template: "%s | DroneOS",
  },
  description: "A programmable drone SDK and command center on PX4 and ROS 2.",
  metadataBase: new URL("https://droneos.dev"),
  openGraph: {
    title: "DroneOS — Programmable Drone SDK & Command Center",
    description: "A programmable drone SDK and command center on PX4 and ROS 2.",
    url: "https://droneos.dev",
    siteName: "DroneOS",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "DroneOS — Programmable Drone SDK & Command Center",
    description: "A programmable drone SDK and command center on PX4 and ROS 2.",
  },
  keywords: ["drone", "autonomous", "PX4", "ROS 2", "SDK", "command center", "open source", "DroneOS", "robotics"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className={inter.variable}>
      <body className="flex flex-col min-h-screen">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
