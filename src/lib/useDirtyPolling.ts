import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiAdapter } from './unifiedApiAdapter';

const DEFAULT_DIRTY_QUERY_KEYS: Record<'log' | 'pool' | 'channel' | 'token', readonly (readonly string[])[]> = {
  log: [['usageLogs']],
  pool: [['entries']],
  channel: [['channels']],
  token: [['accessKeys']],
};

/**
 * useDirtyPolling Hook
 * - Calls `apiAdapter.dirty.take(module)` every 2 seconds to detect dirty flags.
 * - When it returns true, uses React Query's `queryClient.invalidateQueries` to
 *   refresh the corresponding module's queries.
 * - The module param corresponds to a backend module identifier:
 *   'log' | 'pool' | 'channel' | 'token'.
 * - queryKeys (optional): specify a list of query keys to refresh.
 */
export function useDirtyPolling(
  module: 'log' | 'pool' | 'channel' | 'token',
  queryKeys?: readonly (readonly string[])[],
) {
  const queryClient = useQueryClient();

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      if (cancelled) return;
      try {
        const isDirty = await apiAdapter.dirty.take(module);
        if (isDirty) {
          const scrollY = window.scrollY;
          const keys = queryKeys ?? DEFAULT_DIRTY_QUERY_KEYS[module];
          keys.forEach((key) => {
            queryClient.invalidateQueries({ queryKey: [...key] });
          });
          requestAnimationFrame(() => window.scrollTo(0, scrollY));
        }
      } catch (e) {
        console.error('Dirty flag poll failed:', e);
      } finally {
        if (!cancelled) {
          setTimeout(poll, 2000);
        }
      }
    };

    poll();
    return () => {
      cancelled = true;
    };
  }, [module, queryClient, queryKeys]);
}
