import type { Metadata } from 'next';
import { branding } from '@propvault/config';
import './globals.css';

export const metadata: Metadata = {
  title: `${branding.productName} Admin`,
  description: 'PropVault SaaS operations dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
