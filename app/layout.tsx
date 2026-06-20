import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Taiwan Screen | 台股雷達',
  description: '台灣最完整的免費股票研究平台',
  verification: {
    google: 'isZcW0Cdo3q5dov5L6M3Bgml9LkF60r9ltAm4V9N7tA',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-TW">
      <body>
        {children}
      </body>
    </html>
  );
}