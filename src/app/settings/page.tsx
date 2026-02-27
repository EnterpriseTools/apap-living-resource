'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Settings as SettingsIcon, Trash2 } from 'lucide-react';
import { clearAllSnapshots, getStoredMonths } from '@/lib/storage';
import { format, parseISO } from 'date-fns';

export default function SettingsPage() {
  const [storedMonths, setStoredMonths] = useState<string[]>([]);
  const [cleared, setCleared] = useState(false);

  useEffect(() => {
    setStoredMonths(getStoredMonths());
  }, []);

  const handleClearSnapshots = () => {
    clearAllSnapshots();
    setStoredMonths([]);
    setCleared(true);
    window.location.href = '/';
  };

  return (
    <main style={{
      maxWidth: '800px',
      margin: '0 auto',
      padding: '2rem',
    }}>
      <h1 style={{
        fontSize: 'var(--text-title-size)',
        fontWeight: 'var(--text-title-weight)',
        color: 'var(--fg-primary)',
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        marginBottom: '1.5rem',
      }}>
        <SettingsIcon size={28} />
        Settings
      </h1>

      <section style={{
        background: 'var(--surface-3)',
        border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-md)',
        padding: '1.5rem',
        marginBottom: '1.5rem',
      }}>
        <h2 style={{
          fontSize: 'var(--text-subtitle-size)',
          fontWeight: 'var(--text-subtitle-weight)',
          color: 'var(--fg-primary)',
          marginBottom: '0.5rem',
        }}>
          Cached snapshots
        </h2>
        <p style={{
          fontSize: 'var(--text-body1-size)',
          color: 'var(--fg-secondary)',
          marginBottom: '1rem',
        }}>
          Stored uploads are kept in this browser. Clear them to free space or after re-uploading fresh data elsewhere.
        </p>
        {storedMonths.length > 0 ? (
          <ul style={{
            fontSize: 'var(--text-body1-size)',
            color: 'var(--fg-secondary)',
            marginBottom: '1rem',
            paddingLeft: '1.25rem',
          }}>
            {storedMonths.map((m) => (
              <li key={m}>{format(parseISO(m + '-01'), 'MMM yyyy')}</li>
            ))}
          </ul>
        ) : (
          <p style={{
            fontSize: 'var(--text-body1-size)',
            color: 'var(--fg-secondary)',
            marginBottom: '1rem',
          }}>
            No cached snapshots.
          </p>
        )}
        <button
          type="button"
          onClick={handleClearSnapshots}
          disabled={storedMonths.length === 0}
          style={{
            padding: '0.75rem 1.5rem',
            background: storedMonths.length > 0 ? 'var(--bg-destructive)' : 'var(--surface-4)',
            color: 'white',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--text-button-size)',
            fontWeight: 'var(--text-button-weight)',
            letterSpacing: 'var(--text-button-letter)',
            textTransform: 'uppercase',
            cursor: storedMonths.length > 0 ? 'pointer' : 'not-allowed',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <Trash2 size={16} />
          Clear cached snapshots
        </button>
        {cleared && (
          <p style={{
            marginTop: '0.75rem',
            fontSize: 'var(--text-caption-size)',
            color: 'var(--fg-success)',
          }}>
            Cleared. Redirecting to Home…
          </p>
        )}
      </section>

      <p style={{ fontSize: 'var(--text-caption-size)', color: 'var(--fg-secondary)' }}>
        <Link href="/" style={{ color: 'var(--fg-action)', textDecoration: 'none' }}>← Back to Home</Link>
      </p>
    </main>
  );
}
