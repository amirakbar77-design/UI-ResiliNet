import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ResiliNet 3D — UI Concept',
  description:
    'A static interface concept for disaster-resilient connectivity planning.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
