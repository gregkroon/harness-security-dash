/**
 * React hook for fetching components from the backend API
 * Backend handles all Harness API calls, caching, and reconciliation
 */

import { useQuery } from '@tanstack/react-query';
import { config } from '@/lib/config';

interface BackendComponent {
  id: number;
  package: string;
  version: string;
  highest_severity: string | null;
  vulnerability_count: number;
  critical_count: number;
  high_count: number;
  in_production: boolean;
  unique_services: number;
  unique_environments: number;
  unique_orgs: number;
  unique_projects: number;
  data: any; // Full component data as JSON
  updated_at: string;
}

interface BackendComponentsResponse {
  components: BackendComponent[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface UseBackendComponentsOptions {
  search?: string;
  deployedOnly?: boolean;
  scaOnly?: boolean;
  vulnerableOnly?: boolean;
  envFilter?: 'all' | 'prod' | 'non-prod';
  hideContainers?: boolean;
  page?: number;
  pageSize?: number;
}

export function useBackendComponents(options: UseBackendComponentsOptions = {}) {
  const {
    search = '',
    deployedOnly = false, // Changed to false to show all components by default
    scaOnly = true,
    vulnerableOnly = false,
    envFilter = 'all',
    hideContainers = true, // Default to hiding container images
    page = 1,
    pageSize = 50,
  } = options;

  return useQuery({
    queryKey: ['backend-components', { search, deployedOnly, scaOnly, vulnerableOnly, envFilter, hideContainers, page, pageSize }],
    queryFn: async (): Promise<BackendComponentsResponse> => {
      const params = new URLSearchParams({
        deployed_only: String(deployedOnly),
        sca_only: String(scaOnly),
        vulnerable_only: String(vulnerableOnly),
        env_filter: envFilter,
        hide_containers: String(hideContainers),
        page: String(page),
        page_size: String(pageSize),
      });

      if (search) {
        params.set('search', search);
      }

      const response = await fetch(`/api/components?${params.toString()}`);

      if (!response.ok) {
        throw new Error(`Backend API error: ${response.status} ${response.statusText}`);
      }

      return response.json();
    },
    staleTime: config.app.cacheTtlMs,
    refetchOnWindowFocus: false,
    retry: 2,
  });
}

/**
 * Get account-wide stats from backend
 */
export function useBackendStats() {
  return useQuery({
    queryKey: ['backend-stats'],
    queryFn: async () => {
      const response = await fetch('/api/stats');

      if (!response.ok) {
        throw new Error(`Backend API error: ${response.status} ${response.statusText}`);
      }

      return response.json();
    },
    staleTime: config.app.cacheTtlMs,
    refetchOnWindowFocus: false,
  });
}
