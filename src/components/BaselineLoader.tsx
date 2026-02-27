'use client';

import { useEffect } from 'react';
import { initializeBaseline } from '@/lib/baseline';

/**
 * Component that initializes baseline data on app startup
 * This runs silently in the background and doesn't render anything
 */
export default function BaselineLoader() {
  useEffect(() => {
    // Initialize baseline on mount
    initializeBaseline().catch(err => {
      // Silently fail - baseline is optional
      console.debug('Baseline not loaded:', err);
    });
  }, []);

  return null;
}
