import Link from 'next/link';
import { Home, Upload, TrendingUp, ListChecks, Target, Clock, FileText } from 'lucide-react';

export default function NotFound() {
  return (
    <div style={{
      minHeight: 'calc(100vh - 80px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '2rem',
      background: 'var(--surface-1)',
    }}>
      <div style={{
        textAlign: 'center',
        maxWidth: '480px',
        background: 'var(--surface-3)',
        padding: '2rem',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-md)',
        border: '1px solid var(--border-color)',
      }}>
        <h1 style={{
          fontSize: 'var(--text-headline-size)',
          fontWeight: 'var(--text-headline-weight)',
          marginBottom: '0.5rem',
          color: 'var(--fg-primary)',
        }}>
          Page not found
        </h1>
        <p style={{
          fontSize: 'var(--text-body1-size)',
          color: 'var(--fg-secondary)',
          marginBottom: '1.5rem',
        }}>
          The page you’re looking for doesn’t exist or has been moved.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', justifyContent: 'center' }}>
          <Link
            href="/"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.5rem 1rem',
              background: 'var(--bg-action)',
              color: 'white',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--text-button-size)',
              fontWeight: 'var(--text-button-weight)',
              textDecoration: 'none',
            }}
          >
            <Home size={16} />
            Home
          </Link>
          <Link
            href="/upload"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.5rem 1rem',
              background: 'var(--surface-2)',
              color: 'var(--fg-primary)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--text-button-size)',
              border: '1px solid var(--border-color)',
              textDecoration: 'none',
            }}
          >
            <Upload size={16} />
            Upload
          </Link>
          <Link
            href="/overview"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.5rem 1rem',
              background: 'var(--surface-2)',
              color: 'var(--fg-primary)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--text-button-size)',
              border: '1px solid var(--border-color)',
              textDecoration: 'none',
            }}
          >
            <TrendingUp size={16} />
            Analysis
          </Link>
          <Link
            href="/action-list"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.5rem 1rem',
              background: 'var(--surface-2)',
              color: 'var(--fg-primary)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--text-button-size)',
              border: '1px solid var(--border-color)',
              textDecoration: 'none',
            }}
          >
            <ListChecks size={16} />
            Agency List
          </Link>
          <Link
            href="/actions"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.5rem 1rem',
              background: 'var(--surface-2)',
              color: 'var(--fg-primary)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--text-button-size)',
              border: '1px solid var(--border-color)',
              textDecoration: 'none',
            }}
          >
            <Target size={16} />
            Action List
          </Link>
          <Link
            href="/near-eligible"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.5rem 1rem',
              background: 'var(--surface-2)',
              color: 'var(--fg-primary)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--text-button-size)',
              border: '1px solid var(--border-color)',
              textDecoration: 'none',
            }}
          >
            <Clock size={16} />
            Near Eligible
          </Link>
          <Link
            href="/summary"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.5rem 1rem',
              background: 'var(--surface-2)',
              color: 'var(--fg-primary)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--text-button-size)',
              border: '1px solid var(--border-color)',
              textDecoration: 'none',
            }}
          >
            <FileText size={16} />
            AI Summary
          </Link>
        </div>
      </div>
    </div>
  );
}
