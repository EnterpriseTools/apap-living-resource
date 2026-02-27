'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Upload, ListChecks, TrendingUp, Clock, Users, FileText, Target, Settings } from 'lucide-react';
import { getStoredMonths, getCurrentMonth, setCurrentMonth } from '@/lib/storage';
import { format, parseISO } from 'date-fns';

export default function Navigation() {
  const pathname = usePathname();
  const [storedMonths, setStoredMonths] = useState<string[]>([]);
  const [currentMonth, setCurrentMonthState] = useState<string | null>(null);

  // Re-sync with storage on pathname change so "Viewing" matches data after upload or month switch
  useEffect(() => {
    setStoredMonths(getStoredMonths());
    setCurrentMonthState(getCurrentMonth());
  }, [pathname]);

  const handleMonthChange = (month: string) => {
    if (month === currentMonth) return;
    setCurrentMonth(month);
    window.location.reload();
  };

  const navLinks = [
    { href: '/', label: 'Home', icon: Home },
    { href: '/upload', label: 'Upload', icon: Upload },
    { href: '/overview', label: 'Analysis', icon: TrendingUp },
    { href: '/action-list', label: 'Agency List', icon: ListChecks },
    { href: '/actions', label: 'Action List', icon: Target },
    { href: '/near-eligible', label: 'Near Eligible', icon: Clock },
    { href: '/summary', label: 'AI Summary', icon: FileText },
    { href: '/settings', label: 'Settings', icon: Settings },
  ];

  return (
    <nav style={{
      background: 'linear-gradient(135deg, var(--surface-3) 0%, var(--surface-2) 100%)',
      borderBottom: `2px solid var(--border-color)`,
      padding: '1rem 2rem',
      boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
    }}>
      <div style={{
        maxWidth: '1400px',
        margin: '0 auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <Link
          href="/"
          style={{
            fontSize: 'var(--text-title-size)',
            fontWeight: 'var(--text-title-weight)',
            color: 'var(--fg-primary)',
            textDecoration: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
          }}
        >
          <div style={{
            background: 'linear-gradient(135deg, var(--bg-action) 0%, var(--fg-live) 100%)',
            padding: '0.5rem',
            borderRadius: 'var(--radius-sm)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <TrendingUp size={20} color="white" />
          </div>
          <div>
            <span style={{
              color: 'var(--fg-action)',
              fontWeight: 600,
            }}>VR APAP</span>
            <span style={{ color: 'var(--fg-secondary)', marginLeft: '0.25rem' }}>Dashboard</span>
          </div>
        </Link>
        <div style={{
          display: 'flex',
          gap: '0.75rem',
          alignItems: 'center',
        }}>
          {storedMonths.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <label htmlFor="month-switcher" style={{
                fontSize: 'var(--text-caption-size)',
                color: 'var(--fg-secondary)',
                whiteSpace: 'nowrap',
              }}>
                Viewing:
              </label>
              <select
                id="month-switcher"
                value={currentMonth ?? ''}
                onChange={(e) => handleMonthChange(e.target.value)}
                style={{
                  padding: '0.35rem 0.5rem',
                  fontSize: 'var(--text-caption-size)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--surface-3)',
                  color: 'var(--fg-primary)',
                  minWidth: '110px',
                }}
              >
                {storedMonths.map((m) => (
                  <option key={m} value={m}>
                    {format(parseISO(m + '-01'), 'MMM yyyy')}
                  </option>
                ))}
              </select>
            </div>
          )}
          {navLinks.map((link) => {
            const isActive = pathname === link.href;
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                style={{
                  fontSize: 'var(--text-body1-size)',
                  fontWeight: isActive ? 'var(--text-subtitle-weight)' : 'var(--text-body1-weight)',
                  color: isActive ? 'var(--fg-action)' : 'var(--fg-secondary)',
                  textDecoration: 'none',
                  padding: '0.75rem 1rem',
                  borderRadius: 'var(--radius-sm)',
                  background: isActive ? 'rgba(4, 93, 210, 0.12)' : 'transparent',
                  border: isActive ? `1px solid var(--fg-action)` : '1px solid transparent',
                  transition: 'all 0.2s ease',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                }}
                className="nav-link"
              >
                <Icon size={16} />
                {link.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}

