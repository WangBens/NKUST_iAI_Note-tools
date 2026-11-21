import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: '知音筆記｜高科 iAI 錄音學習助手',
  description: '使用高科 iAI Asr 與 Furen 系列模型，將錄音轉成逐字稿與 Markdown 重點。',
  icons: {
    icon: [{ url: '/favicon.png?v=202609092009', type: 'image/png', sizes: '80x80' }],
    shortcut: '/favicon.png?v=202609092009',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant-TW">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
