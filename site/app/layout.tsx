import type { Metadata } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { ThemeProvider } from '@/components/theme-provider';
import './globals.css';

export const metadata: Metadata = {
  title: 'preflight — see what breaks before you upgrade',
  description:
    'A CLI that tells you what actually breaks before you upgrade a dependency, instead of just telling you an update is available.',
  openGraph: {
    title: 'preflight — see what breaks before you upgrade',
    description:
      'A CLI that tells you what actually breaks before you upgrade a dependency, instead of just telling you an update is available.',
    type: 'website',
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
