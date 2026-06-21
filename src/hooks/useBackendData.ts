/**
 * React hooks for fetching data from the backend API
 */

import { useQuery } from '@tanstack/react-query';
import { config } from '@/lib/config';

const CACHE_TIME = config.app.cacheTtlMs;

/**
 * Fetch dashboard overview data
 */
export function useDashboard(orgId?: string, projectId?: string) {
  return useQuery({
    queryKey: ['backend-dashboard', orgId, projectId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (orgId) params.set('org_id', orgId);
      if (projectId) params.set('project_id', projectId);

      const response = await fetch(`/api/dashboard?${params.toString()}`);

      if (!response.ok) {
        throw new Error(`Backend API error: ${response.status} ${response.statusText}`);
      }

      return response.json();
    },
    staleTime: CACHE_TIME,
    refetchOnWindowFocus: false,
    retry: 2,
  });
}

/**
 * Fetch exposures (vulnerable components)
 */
export function useExposures(options: {
  search?: string;
  severity?: string[]; // ['critical', 'high', etc.]
  envFilter?: 'all' | 'prod' | 'non-prod';
  sortBy?: 'severity' | 'deployments' | 'services';
  page?: number;
  pageSize?: number;
} = {}) {
  const {
    search = '',
    severity = [],
    envFilter = 'all',
    sortBy = 'severity',
    page = 1,
    pageSize = 50,
  } = options;

  return useQuery({
    queryKey: ['backend-exposures', { search, severity, envFilter, sortBy, page, pageSize }],
    queryFn: async () => {
      const params = new URLSearchParams({
        env_filter: envFilter,
        sort_by: sortBy,
        page: String(page),
        page_size: String(pageSize),
      });

      if (search) {
        params.set('search', search);
      }

      if (severity.length > 0) {
        params.set('severity', severity.join(','));
      }

      const response = await fetch(`/api/exposures?${params.toString()}`);

      if (!response.ok) {
        throw new Error(`Backend API error: ${response.status} ${response.statusText}`);
      }

      return response.json();
    },
    staleTime: CACHE_TIME,
    refetchOnWindowFocus: false,
    retry: 2,
  });
}

/**
 * Fetch coverage data
 */
export function useCoverage(orgId?: string, projectId?: string) {
  return useQuery({
    queryKey: ['backend-coverage', orgId, projectId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (orgId) params.set('org_id', orgId);
      if (projectId) params.set('project_id', projectId);

      const response = await fetch(`/api/coverage?${params.toString()}`);

      if (!response.ok) {
        throw new Error(`Backend API error: ${response.status} ${response.statusText}`);
      }

      return response.json();
    },
    staleTime: CACHE_TIME,
    refetchOnWindowFocus: false,
    retry: 2,
  });
}
