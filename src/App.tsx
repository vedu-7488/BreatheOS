import React, { useEffect, useState } from 'react';
import {
  Activity,
  BarChart3,
  Bot,
  Compass,
  Home,
  LayoutDashboard,
  MapPin,
  User,
} from 'lucide-react';
import { api, getStoredToken, setStoredToken } from './lib/api';
import type { NCRLocation, UserProfile } from './types/breatheos';
import { DashboardView } from './components/DashboardView';
import { AirTwinView } from './components/AirTwinView';
import { PlannerView } from './components/PlannerView';
import { AirRouteView } from './components/AirRouteView';
import { IndoorCoachView } from './components/IndoorCoachView';
import { InsightsView } from './components/InsightsView';
import { AuthModal } from './components/AuthModal';

type TabId = 'dashboard' | 'airtwin' | 'planner' | 'airroute' | 'indoor' | 'insights';

const NAV_ITEMS: Array<{ id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'dashboard', label: 'Intelligence', icon: LayoutDashboard },
  { id: 'airtwin', label: 'AirTwin', icon: Activity },
  { id: 'planner', label: 'AI Planner', icon: Bot },
  { id: 'airroute', label: 'AirRoute', icon: Compass },
  { id: 'indoor', label: 'Indoor Coach', icon: Home },
  { id: 'insights', label: 'Insights', icon: BarChart3 },
];

const FALLBACK_LOCATIONS: NCRLocation[] = [
  {
    id: 'noida-sector-62',
    name: 'Noida Sector 62',
    zone: 'Noida',
    latitude: 28.6279,
    longitude: 77.3649,
    description: 'IT & Institutional Corridor along NH-24 / Delhi–Meerut Expressway',
  },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');
  const [locations, setLocations] = useState<NCRLocation[]>(FALLBACK_LOCATIONS);
  const [selectedLocId, setSelectedLocId] = useState<string>('noida-sector-62');
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [mapsApiKey, setMapsApiKey] = useState<string>(
    import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''
  );
  const [quotaExceeded, setQuotaExceeded] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    const onQuotaExceeded = () => setQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', onQuotaExceeded);
    return () => window.removeEventListener('gmp-quota-exceeded', onQuotaExceeded);
  }, []);

  useEffect(() => {
    async function bootstrap() {
      try {
        const [locs, mapsCfg] = await Promise.all([api.getLocations(), api.getMapsConfig()]);
        if (locs.length > 0) setLocations(locs);
        if (!mapsApiKey && mapsCfg.apiKey) {
          setMapsApiKey(mapsCfg.apiKey);
        }

        const existingToken = getStoredToken();
        if (existingToken) {
          try {
            const me = await api.getMe();
            setProfile(me);
            setSelectedLocId(me.default_location_id);
          } catch {
            setStoredToken(null);
            const demo = await api.demoLogin();
            setProfile(demo.profile);
            setSelectedLocId(demo.profile.default_location_id);
          }
        } else {
          const demo = await api.demoLogin();
          setProfile(demo.profile);
          setSelectedLocId(demo.profile.default_location_id);
        }
      } catch {
        // Leave graceful fallback state
      } finally {
        setBooting(false);
      }
    }
    bootstrap();
  }, []);

  const currentLocation =
    locations.find((l) => l.id === selectedLocId) || locations[0] || FALLBACK_LOCATIONS[0];

  async function handleLocationChange(newId: string) {
    setSelectedLocId(newId);
    if (profile) {
      try {
        const updated = await api.updatePreferences({ default_location_id: newId });
        setProfile(updated);
      } catch {
        // Non-blocking preference update
      }
    }
  }

  function handleSignOut() {
    setStoredToken(null);
    setProfile(null);
  }

  const requiresAuth = activeTab === 'airtwin' || activeTab === 'planner' || activeTab === 'insights';
  const activeNavMeta = NAV_ITEMS.find((n) => n.id === activeTab);

  return (
    <div className="min-h-screen bg-[#F6F8FA] text-[#0F172A] flex flex-col">
      {quotaExceeded && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm">
          <span>
            Google Maps Platform quota reached. If you are the app owner, visit{' '}
            <a
              href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-semibold text-amber-950 hover:text-amber-800"
            >
              maps developer site
            </a>{' '}
            for instructions to update your account.
          </span>
        </div>
      )}

      <div className="flex-1 flex min-w-0">
        {/* Desktop Sidebar */}
        <aside className="hidden lg:flex lg:w-[248px] lg:shrink-0 lg:flex-col bg-white border-r border-slate-200">
          <div className="h-16 px-6 flex items-center border-b border-slate-200">
            <span className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
              BreatheOS
            </span>
          </div>

          <nav className="flex-1 p-3 space-y-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full flex items-center gap-3 px-3.5 py-2.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-[#EEF2F6] text-[#0D6E6E]'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="p-4 border-t border-slate-200">
            <button
              type="button"
              onClick={() => setAuthModalOpen(true)}
              className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50 transition-colors text-left"
            >
              {!avatarFailed ? (
                <img
                  src="/src/assets/images/avatar_commuter_profile_1795099887990.jpg"
                  alt={profile?.full_name || 'User profile'}
                  referrerPolicy="no-referrer"
                  onError={() => setAvatarFailed(true)}
                  className="w-9 h-9 rounded-lg object-cover shrink-0 border border-slate-200"
                />
              ) : (
                <div className="w-9 h-9 rounded-lg bg-[#EEF2F6] text-[#0D6E6E] flex items-center justify-center shrink-0">
                  <User className="w-4 h-4" />
                </div>
              )}
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-900 truncate">
                  {profile ? profile.full_name : 'Sign In'}
                </p>
                <p className="text-[11px] text-slate-500 truncate">
                  {profile ? (profile.is_demo ? 'Delhi NCR Pilot' : profile.email) : 'Account isolation'}
                </p>
              </div>
            </button>
          </div>
        </aside>

        {/* Main Workspace */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Top Header */}
          <header className="h-16 bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <span className="lg:hidden font-display text-base font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
                BreatheOS
              </span>
              <span className="hidden lg:inline text-sm text-slate-500 whitespace-nowrap">
                Delhi NCR · {activeNavMeta?.label}
              </span>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg">
                <MapPin className="w-3.5 h-3.5 text-[#0D6E6E] shrink-0" />
                <select
                  aria-label="Select Delhi NCR location"
                  value={currentLocation.id}
                  onChange={(e) => handleLocationChange(e.target.value)}
                  className="text-xs font-medium text-slate-800 bg-transparent focus:outline-none cursor-pointer"
                >
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name} ({loc.zone})
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                onClick={() => setAuthModalOpen(true)}
                className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
              >
                {profile ? 'Account' : 'Sign In'}
              </button>
            </div>
          </header>

          {/* Mobile Tab Bar (compact single-row scrollable) */}
          <div className="lg:hidden bg-white border-b border-slate-200 px-3 py-1.5 flex items-center gap-1 overflow-x-auto">
            {NAV_ITEMS.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 transition-colors ${
                    isActive ? 'bg-[#EEF2F6] text-[#0D6E6E]' : 'text-slate-600'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>

          <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1280px] w-full mx-auto">
            {booting ? (
              <div className="py-16 text-center text-sm text-slate-500">
                Initializing BreatheOS workspace...
              </div>
            ) : requiresAuth && !profile ? (
              <div className="bg-white border border-slate-200 rounded-xl p-8 text-center max-w-md mx-auto my-8 space-y-4">
                <h2 className="text-base font-semibold text-slate-900">Authentication Required</h2>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Personal activities, AirTwin exposure timelines, and AI planning sessions are isolated per authenticated account.
                </p>
                <button
                  type="button"
                  onClick={() => setAuthModalOpen(true)}
                  className="px-4 py-2 text-xs font-medium text-white bg-[#0D6E6E] hover:bg-[#095454] rounded-lg"
                >
                  Sign In or Use Demo Profile
                </button>
              </div>
            ) : (
              <>
                {activeTab === 'dashboard' && (
                  <DashboardView
                    location={currentLocation}
                    onNavigate={(t) => setActiveTab(t)}
                  />
                )}
                {activeTab === 'airtwin' && <AirTwinView locations={locations} />}
                {activeTab === 'planner' && <PlannerView location={currentLocation} />}
                {activeTab === 'airroute' && (
                  <AirRouteView locations={locations} mapsApiKey={mapsApiKey} />
                )}
                {activeTab === 'indoor' && <IndoorCoachView location={currentLocation} />}
                {activeTab === 'insights' && <InsightsView />}
              </>
            )}
          </main>

          <footer className="px-4 sm:px-6 lg:px-8 py-4 border-t border-slate-200 bg-white text-xs text-slate-500 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <span>
              BreatheOS · Delhi NCR Pilot (Delhi & Noida) · Informational environmental context, not medical advice.
            </span>
            <span>
              Timestamps in Asia/Kolkata (IST) · Methodology AirTwin v1.0
            </span>
          </footer>
        </div>
      </div>

      <AuthModal
        open={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        locations={locations}
        currentUser={profile}
        onAuthenticated={(p) => {
          setProfile(p);
          setSelectedLocId(p.default_location_id);
        }}
        onSignOut={handleSignOut}
      />
    </div>
  );
}
