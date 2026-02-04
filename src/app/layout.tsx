import type { Metadata } from 'next';
import { Space_Grotesk, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';

const spaceGrotesk = Space_Grotesk({
  variable: '--font-space-grotesk',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
});

const jetbrainsMono = JetBrains_Mono({
  variable: '--font-jetbrains-mono',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
});

export const metadata: Metadata = {
  title: 'Basion.app - Tap to Earn on Base',
  description: 'Tap-to-earn game on Base Network. Buy taps, earn points, climb the leaderboard!',
  other: {
    // Mini App embed metadata (used by Base App / Farcaster clients)
    // Docs: https://docs.base.org/mini-apps/quickstart/migrate-existing-apps
    'fc:miniapp': JSON.stringify({
      version: 'next',
      imageUrl: 'https://basion.app/favicon.png',
      button: {
        title: 'Play Now',
        action: {
          type: 'launch_miniapp',
          name: 'Basion Tap',
          url: 'https://basion.app',
          splashImageUrl: 'https://basion.app/favicon.png',
          splashBackgroundColor: '#000000',
        },
      },
    }),
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Mobile viewport - prevents zoom, ensures correct scaling */}
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
        {/* Base Build domain verification */}
        <meta name="base:app_id" content="69839f412d51dfb241e4e344" />
        {/* Hide Next.js dev overlay */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if (typeof window !== 'undefined') {
                const hideOverlay = () => {
                  const portal = document.querySelector('nextjs-portal');
                  if (portal) portal.remove();
                };
                setInterval(hideOverlay, 100);
                document.addEventListener('DOMContentLoaded', hideOverlay);
              }
            `,
          }}
        />
      </head>
      <body className={`${spaceGrotesk.variable} ${jetbrainsMono.variable} antialiased font-sans`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
