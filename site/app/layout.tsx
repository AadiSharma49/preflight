import type { Metadata } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { ThemeProvider } from '@/components/theme-provider';
import './globals.css';

const SITE_URL = 'https://preflight-umber.vercel.app';
const DESCRIPTION =
  'A CLI that tells you what actually breaks before you upgrade a dependency, instead of just telling you an update is available.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'preflight — see what breaks before you upgrade',
  description: DESCRIPTION,
  alternates: { canonical: '/' },
  openGraph: {
    title: 'preflight — see what breaks before you upgrade',
    description: DESCRIPTION,
    url: SITE_URL,
    siteName: 'preflight',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'preflight — see what breaks before you upgrade',
    description: DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <body className="font-sans">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
