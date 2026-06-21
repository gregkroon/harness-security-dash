/**
 * Application configuration loaded from environment variables
 */

export const config = {
  harness: {
    accountId: import.meta.env.VITE_HARNESS_ACCOUNT_ID || '',
    apiKey: import.meta.env.VITE_HARNESS_API_KEY || '',
    baseUrl: import.meta.env.VITE_HARNESS_BASE_URL || 'https://app.harness.io',
    // Use proxy in dev to avoid CORS and exposing API key
    useProxy: import.meta.env.DEV,
  },

  app: {
    name: import.meta.env.VITE_APP_NAME || 'Harness Security Dashboard',
    cacheTtlMs: parseInt(import.meta.env.VITE_CACHE_TTL_MS || '300000', 10),
    // Enable demo mode with mock data (useful for testing without API credentials)
    demoMode: import.meta.env.VITE_DEMO_MODE === 'true',
  },

  features: {
    enableCisaKev: import.meta.env.VITE_ENABLE_CISA_KEV === 'true',
    enableEpss: import.meta.env.VITE_ENABLE_EPSS === 'true',
    enableEvidenceExport: import.meta.env.VITE_ENABLE_EVIDENCE_EXPORT === 'true',
  },

  external: {
    cisaKevUrl: 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json',
  },
} as const;

// Note: When using backend API, credentials are not required in frontend
// Backend handles all Harness API calls
