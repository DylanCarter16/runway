import type { Metadata, Viewport } from 'next';
import {
  Atkinson_Hyperlegible_Mono,
  Atkinson_Hyperlegible_Next,
  Source_Serif_4,
} from 'next/font/google';
import { ThemeProvider } from 'next-themes';
import { Toaster } from '@/components/ui/sonner';
import './globals.css';

const ui = Atkinson_Hyperlegible_Next({
  variable: '--font-ui',
  subsets: ['latin'],
  weight: ['400', '600'],
});

const reading = Source_Serif_4({
  variable: '--font-reading',
  subsets: ['latin'],
  weight: ['400', '600'],
});

const code = Atkinson_Hyperlegible_Mono({
  variable: '--font-code',
  subsets: ['latin'],
  weight: ['400'],
});

export const metadata: Metadata = {
  title: { default: 'Runway', template: '%s, Runway' },
  description: 'Deadlines, notes, and links for Fall 2026.',
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: 'Runway', statusBarStyle: 'default' },
  icons: { apple: '/icons/apple-touch-icon.png' },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F6F6F4' },
    { media: '(prefers-color-scheme: dark)', color: '#121212' },
  ],
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${ui.variable} ${reading.variable} ${code.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {children}
          <Toaster position="bottom-center" />
        </ThemeProvider>
      </body>
    </html>
  );
}
