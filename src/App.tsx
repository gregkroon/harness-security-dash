import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { DashboardPage } from './pages/DashboardPage';
import { ExposuresPage } from './pages/ExposuresPage';
import { ComponentSearchPage } from './pages/ComponentSearchPage';
import { CoveragePage } from './pages/CoveragePage';
import { config } from './lib/config';

function App() {
  const location = useLocation();

  // Fetch account info from backend
  const { data: healthData } = useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      const response = await fetch('/api/health');
      return response.json();
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: false,
  });

  const navigation = [
    { name: 'Component Search', path: '/', icon: '🔎' },
    { name: 'Coverage', path: '/coverage', icon: '📈' },
  ];

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Sidebar Navigation */}
      <aside className="w-64 bg-sidebar text-white flex-shrink-0">
        <div className="p-4">
          <div className="flex items-center gap-2 mb-8">
            <div className="w-8 h-8 bg-success-500 rounded-full flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            </div>
            <div>
              <div className="text-sm font-semibold">Harness</div>
              <div className="text-xs text-gray-400">Zero Day Tool</div>
            </div>
          </div>

          <nav className="space-y-1">
            {navigation.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  location.pathname === item.path
                    ? 'bg-primary-500 text-white'
                    : 'text-gray-300 hover:bg-sidebar-light hover:text-white'
                }`}
              >
                <span className="text-lg">{item.icon}</span>
                {item.name}
              </Link>
            ))}
          </nav>
        </div>

        {/* Sidebar Footer */}
        <div className="absolute bottom-0 w-64 p-4 border-t border-sidebar-light">
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <div className="w-6 h-6 bg-primary-500 rounded-full flex items-center justify-center text-white font-semibold">
              {healthData?.accountId?.substring(0, 2).toUpperCase() || 'HA'}
            </div>
            <span className="truncate">{healthData?.accountId || 'Loading...'}</span>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col">
        {/* Top Header */}
        <header className="bg-white border-b border-gray-200 h-14 flex items-center justify-between px-6">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span>Harness Demo</span>
            <span>›</span>
            <span>default</span>
            <span>›</span>
            <span className="text-gray-900 font-medium">
              {location.pathname === '/' ? 'Component Search' : 'Coverage'}
            </span>
          </div>
          <div className="flex items-center gap-4">
            {config.app.demoMode && (
              <span className="px-2 py-1 bg-amber-100 text-amber-800 text-xs font-semibold rounded">
                Demo Mode
              </span>
            )}
            <button className="p-2 text-gray-400 hover:text-gray-600">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </button>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 overflow-auto p-6">
          <Routes>
            <Route path="/" element={<ComponentSearchPage />} />
            <Route path="/coverage" element={<CoveragePage />} />
          </Routes>
        </main>

        {/* Footer */}
        <footer className="bg-white border-t border-gray-200 px-6 py-3">
          <p className="text-xs text-gray-500 text-center">
            <strong>Core Principle:</strong> Never show "safe" when data is missing.
            Absence of evidence must be shown as a risk state, not as green status.
          </p>
        </footer>
      </div>
    </div>
  );
}

export default App;
