import type { Metadata } from 'next';
import Navigation from '@/components/Navigation';
import BaselineLoader from '@/components/BaselineLoader';
import '../styles/tokens.css';
import '../styles/globals.css';

export const metadata: Metadata = {
  title: 'VR APAP Dashboard',
  description: 'VR APAP Dashboard - Track adoption, churn, and risk metrics',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="light">
      <body style={{
        margin: 0,
        padding: 0,
        background: 'var(--surface-1)',
        minHeight: '100vh',
      }}>
        <BaselineLoader />
        <Navigation />
        {children}
      </body>
    </html>
  );
}

