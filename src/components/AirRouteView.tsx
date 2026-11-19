import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AdvancedMarker,
  APIProvider,
  Map as GoogleMap,
  Pin,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import { Navigation, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import type { NCRLocation, RouteComparisonResponse, TravelMode } from '../types/breatheos';

interface AirRouteViewProps {
  locations: NCRLocation[];
  mapsApiKey: string;
}

interface RouteCanvasProps {
  origin: NCRLocation;
  destination: NCRLocation;
  travelMode: TravelMode;
  triggerCount: number;
  selectedRouteId: string | null;
  onComparisonReady: (resp: RouteComparisonResponse | null, errMsg: string | null) => void;
  onComputingChange: (loading: boolean) => void;
}

interface LatLngLiteral {
  lat: number;
  lng: number;
}

interface PolylineHandle {
  setMap: (map: unknown) => void;
}

interface LatLngBoundsHandle {
  extend: (pt: LatLngLiteral) => void;
}

interface GoogleMapsGlobal {
  maps: {
    Polyline: new (opts: Record<string, unknown>) => PolylineHandle;
    LatLngBounds: new () => LatLngBoundsHandle;
  };
}

function getGoogleMapsGlobal(): GoogleMapsGlobal | undefined {
  return (window as unknown as { google?: GoogleMapsGlobal }).google;
}

const ROUTE_COLORS = ['#0D6E6E', '#D97706', '#475569'];

function RouteCanvas({
  origin,
  destination,
  travelMode,
  triggerCount,
  selectedRouteId,
  onComparisonReady,
  onComputingChange,
}: RouteCanvasProps) {
  const map = useMap();
  const routesLib = useMapsLibrary('routes');
  const polylinesRef = useRef<PolylineHandle[]>([]);
  const [routePaths, setRoutePaths] = useState<Array<{ id: string; path: LatLngLiteral[] }>>([]);

  const clearPolylines = useCallback(() => {
    for (const p of polylinesRef.current) {
      p.setMap(null);
    }
    polylinesRef.current = [];
  }, []);

  useEffect(() => {
    if (!map || !routesLib || triggerCount === 0) return;

    let cancelled = false;
    async function compute() {
      onComputingChange(true);
      clearPolylines();
      try {
        const sdkModeMap: Record<TravelMode, string> = {
          DRIVE: 'DRIVING',
          TRANSIT: 'TRANSIT',
          WALK: 'WALKING',
          TWO_WHEELER: 'TWO_WHEELER',
        };
        const modeKey = sdkModeMap[travelMode] || 'DRIVING';
        const TravelModeEnum = (routesLib as unknown as { TravelMode?: Record<string, unknown> }).TravelMode;
        const resolvedMode = TravelModeEnum?.[modeKey] ?? modeKey;

        const RouteCtor = (routesLib as unknown as {
          Route: {
            new (): { computeRoutes: (req: unknown) => Promise<{ routes?: unknown[] }> };
            computeRoutes?: (req: unknown) => Promise<{ routes?: unknown[] }>;
            decode?: (encoded: string) => LatLngLiteral[];
          };
        }).Route;

        const request = {
          origin: { lat: origin.latitude, lng: origin.longitude },
          destination: { lat: destination.latitude, lng: destination.longitude },
          travelMode: resolvedMode,
          provideRouteAlternatives: true,
          fields: ['path', 'legs', 'distanceMeters', 'durationMillis', 'routeLabels', 'viewport'],
        };

        let response: { routes?: unknown[] };
        if (typeof RouteCtor.computeRoutes === 'function') {
          response = await RouteCtor.computeRoutes(request);
        } else {
          const instance = new RouteCtor();
          response = await instance.computeRoutes(request);
        }

        if (cancelled) return;

        const rawRoutes = (response?.routes || []) as Array<{
          distanceMeters?: number;
          durationMillis?: number;
          duration?: string;
          routeLabels?: string[];
          path?: Array<{ lat: (() => number) | number; lng: (() => number) | number }>;
          polyline?: { encodedPolyline?: string };
          legs?: Array<{ distanceMeters?: number; durationMillis?: number }>;
        }>;

        if (rawRoutes.length === 0) {
          onComparisonReady(null, 'No routes returned by Google Routes API for this NCR corridor.');
          onComputingChange(false);
          return;
        }

        const extractedPaths: Array<{ id: string; path: LatLngLiteral[] }> = [];
        const candidates = rawRoutes.map((r, idx) => {
          const routeId = `route-${idx + 1}`;
          let pts: LatLngLiteral[] = [];
          if (Array.isArray(r.path) && r.path.length > 0) {
            pts = r.path.map((p) => {
              if (typeof p.lat === 'function' && typeof p.lng === 'function') {
                return { lat: p.lat(), lng: p.lng() };
              }
              return { lat: Number(p.lat), lng: Number(p.lng) };
            });
          } else if (r.polyline?.encodedPolyline && typeof RouteCtor.decode === 'function') {
            pts = RouteCtor.decode(r.polyline.encodedPolyline);
          }
          extractedPaths.push({ id: routeId, path: pts });

          const distMeters =
            r.distanceMeters ?? r.legs?.reduce((s, l) => s + (l.distanceMeters || 0), 0) ?? 0;
          const durMillis =
            r.durationMillis ??
            (r.duration ? Number.parseInt(r.duration.replace('s', ''), 10) * 1000 : 0);

          const midPt = pts.length > 2 ? pts[Math.floor(pts.length / 2)] : null;
          const q1Pt = pts.length > 4 ? pts[Math.floor(pts.length * 0.25)] : null;
          const q3Pt = pts.length > 4 ? pts[Math.floor(pts.length * 0.75)] : null;

          const samplePoints = [
            { label: `Origin (${origin.name})`, latitude: origin.latitude, longitude: origin.longitude },
            ...(q1Pt ? [{ label: 'Corridor 25%', latitude: q1Pt.lat, longitude: q1Pt.lng }] : []),
            ...(midPt
              ? [{ label: 'Corridor Midpoint', latitude: midPt.lat, longitude: midPt.lng }]
              : [
                  {
                    label: 'Corridor Midpoint',
                    latitude: (origin.latitude + destination.latitude) / 2,
                    longitude: (origin.longitude + destination.longitude) / 2,
                  },
                ]),
            ...(q3Pt ? [{ label: 'Corridor 75%', latitude: q3Pt.lat, longitude: q3Pt.lng }] : []),
            {
              label: `Destination (${destination.name})`,
              latitude: destination.latitude,
              longitude: destination.longitude,
            },
          ];

          return {
            route_id: routeId,
            summary:
              idx === 0
                ? 'Primary Recommended Corridor'
                : `Alternative Corridor ${idx}`,
            route_labels: r.routeLabels || [],
            duration_seconds: Math.max(60, Math.round(durMillis / 1000)),
            distance_meters: distMeters,
            sample_points: samplePoints,
          };
        });

        setRoutePaths(extractedPaths);

        // Fit map bounds around origin, destination, and route paths
        const gMaps = getGoogleMapsGlobal();
        if (gMaps?.maps?.LatLngBounds) {
          const bounds = new gMaps.maps.LatLngBounds();
          bounds.extend({ lat: origin.latitude, lng: origin.longitude });
          bounds.extend({ lat: destination.latitude, lng: destination.longitude });
          for (const ep of extractedPaths) {
            for (const pt of ep.path) bounds.extend(pt);
          }
          map.fitBounds(bounds as unknown as Parameters<typeof map.fitBounds>[0], 48);
        }

        const comparison = await api.compareRoutes({
          origin: { name: origin.name, latitude: origin.latitude, longitude: origin.longitude },
          destination: {
            name: destination.name,
            latitude: destination.latitude,
            longitude: destination.longitude,
          },
          travel_mode: travelMode,
          candidates,
        });
        if (!cancelled) {
          onComparisonReady(comparison, null);
        }
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        if (
          msg.includes('RESOURCE_EXHAUSTED') ||
          msg.includes('OVER_QUERY_LIMIT') ||
          msg.includes('Quota')
        ) {
          window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        }
        onComparisonReady(
          null,
          `Google Routes calculation unavailable (${msg}). BreatheOS will not fabricate route geometries or pollution comparisons.`
        );
      } finally {
        if (!cancelled) onComputingChange(false);
      }
    }

    compute();
    return () => {
      cancelled = true;
    };
  }, [map, routesLib, origin.id, destination.id, travelMode, triggerCount]);

  // Draw & highlight polylines whenever routePaths or selectedRouteId updates
  useEffect(() => {
    const gMaps = getGoogleMapsGlobal();
    if (!map || !gMaps?.maps?.Polyline) return;
    clearPolylines();
    routePaths.forEach((rp, idx) => {
      if (rp.path.length < 2) return;
      const isSelected = selectedRouteId ? rp.id === selectedRouteId : idx === 0;
      const line = new gMaps.maps.Polyline({
        path: rp.path,
        geodesic: true,
        strokeColor: ROUTE_COLORS[idx % ROUTE_COLORS.length],
        strokeOpacity: isSelected ? 0.95 : 0.45,
        strokeWeight: isSelected ? 5 : 3,
        zIndex: isSelected ? 10 : 1,
        map,
      });
      polylinesRef.current.push(line);
    });
    return () => clearPolylines();
  }, [map, routePaths, selectedRouteId, clearPolylines]);

  return (
    <>
      <AdvancedMarker position={{ lat: origin.latitude, lng: origin.longitude }} title={origin.name}>
        <Pin background="#0D6E6E" glyphColor="#FFFFFF" borderColor="#095454" />
      </AdvancedMarker>
      <AdvancedMarker
        position={{ lat: destination.latitude, lng: destination.longitude }}
        title={destination.name}
      >
        <Pin background="#0F172A" glyphColor="#FFFFFF" borderColor="#020617" />
      </AdvancedMarker>
    </>
  );
}

export function AirRouteView({ locations, mapsApiKey }: AirRouteViewProps) {
  const [originId, setOriginId] = useState('noida-sector-62');
  const [destId, setDestId] = useState('connaught-place');
  const [travelMode, setTravelMode] = useState<TravelMode>('DRIVE');
  const [triggerCount, setTriggerCount] = useState(1);
  const [computing, setComputing] = useState(false);
  const [comparison, setComparison] = useState<RouteComparisonResponse | null>(null);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);

  const origin = locations.find((l) => l.id === originId) || locations[0];
  const destination = locations.find((l) => l.id === destId) || locations[2] || locations[0];

  const handleComparisonReady = useCallback(
    (resp: RouteComparisonResponse | null, errMsg: string | null) => {
      setComparison(resp);
      setRouteError(errMsg);
      if (resp?.routes?.[0]) {
        setSelectedRouteId(resp.routes[0].route_id);
      }
    },
    []
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-slate-500">
            AirRoute R2 · Google Routes API + Corridor Pollution Spatial Check
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 mt-1">
            Commute Route Comparison
          </h1>
          <p className="text-sm text-slate-600 mt-1 max-w-2xl">
            Evaluates live travel time, distance, and regional corridor PM2.5 exposure across Delhi NCR alternatives. Unsupported comparisons remain unavailable.
          </p>
        </div>
      </div>

      {/* Route Query Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
        <div className="md:col-span-4">
          <label className="block text-xs font-medium text-slate-700 mb-1">Origin (Delhi NCR)</label>
          <select
            value={originId}
            onChange={(e) => setOriginId(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
          >
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name} ({loc.zone})
              </option>
            ))}
          </select>
        </div>

        <div className="md:col-span-4">
          <label className="block text-xs font-medium text-slate-700 mb-1">Destination (Delhi NCR)</label>
          <select
            value={destId}
            onChange={(e) => setDestId(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
          >
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id} disabled={loc.id === originId}>
                {loc.name} ({loc.zone})
              </option>
            ))}
          </select>
        </div>

        <div className="md:col-span-2">
          <label className="block text-xs font-medium text-slate-700 mb-1">Travel Mode</label>
          <select
            value={travelMode}
            onChange={(e) => setTravelMode(e.target.value as TravelMode)}
            className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
          >
            <option value="DRIVE">Drive</option>
            <option value="TRANSIT">Transit</option>
            <option value="TWO_WHEELER">Two-Wheeler</option>
            <option value="WALK">Walk</option>
          </select>
        </div>

        <div className="md:col-span-2">
          <button
            type="button"
            onClick={() => setTriggerCount((c) => c + 1)}
            disabled={computing || originId === destId}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium text-white bg-[#0D6E6E] hover:bg-[#095454] rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            {computing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Navigation className="w-3.5 h-3.5" />}
            Compare
          </button>
        </div>
      </div>

      {routeError && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900">
          {routeError}
        </div>
      )}

      {/* Map + Route Alternatives Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
          {mapsApiKey ? (
            <div className="h-[440px] w-full">
              <APIProvider apiKey={mapsApiKey} language="en" region="IN">
                <GoogleMap
                  defaultCenter={{ lat: 28.6139, lng: 77.27 }}
                  defaultZoom={11}
                  mapId="DEMO_MAP_ID"
                  gestureHandling="greedy"
                  internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
                  className="h-full w-full"
                >
                  <RouteCanvas
                    origin={origin}
                    destination={destination}
                    travelMode={travelMode}
                    triggerCount={triggerCount}
                    selectedRouteId={selectedRouteId}
                    onComparisonReady={handleComparisonReady}
                    onComputingChange={setComputing}
                  />
                </GoogleMap>
              </APIProvider>
            </div>
          ) : (
            <div className="h-[440px] w-full flex flex-col items-center justify-center p-6 text-center bg-slate-50">
              <p className="text-sm font-medium text-slate-800">Google Maps API key pending</p>
              <p className="text-xs text-slate-500 mt-1 max-w-sm">
                Configure VITE_GOOGLE_MAPS_API_KEY in environment secrets to render the interactive Delhi NCR map and Routes API alternatives.
              </p>
            </div>
          )}
        </div>

        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between space-y-4">
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Route Alternatives</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Comparison status: {comparison?.comparison_status || (computing ? 'COMPUTING' : 'PENDING')}
                </p>
              </div>
            </div>

            {comparison?.routes && comparison.routes.length > 0 ? (
              <div className="space-y-3">
                {comparison.routes.map((rt, idx) => {
                  const active = selectedRouteId === rt.route_id;
                  return (
                    <button
                      key={rt.route_id}
                      type="button"
                      onClick={() => setSelectedRouteId(rt.route_id)}
                      className={`w-full text-left p-4 rounded-xl border transition-colors ${
                        active
                          ? 'bg-slate-50 border-[#0D6E6E]'
                          : 'bg-white border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-900">
                          {idx + 1}. {rt.summary}
                        </span>
                        <span className="text-xs font-mono-tabular text-slate-600">
                          {rt.duration_minutes} min · {rt.distance_km} km
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-3 mt-3 pt-2.5 border-t border-slate-200/70 text-xs">
                        <div>
                          <p className="text-slate-500">Corridor Mean PM2.5</p>
                          <p className="font-mono-tabular font-medium text-slate-900 mt-0.5">
                            {rt.mean_pm25 !== null ? `${rt.mean_pm25} µg/m³` : 'Unavailable'}
                          </p>
                        </div>
                        <div>
                          <p className="text-slate-500">Relative Exposure Est.</p>
                          <p className="font-mono-tabular font-medium text-slate-900 mt-0.5">
                            {rt.relative_exposure_estimate !== null
                              ? `${rt.relative_exposure_estimate} (${rt.exposure_confidence})`
                              : 'Unavailable'}
                          </p>
                        </div>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-2">
                        Sources: {rt.sources.length > 0 ? rt.sources.join(', ') : 'Unavailable'}
                      </p>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-slate-500 py-8 text-center">
                {computing
                  ? 'Computing Delhi NCR routes and sampling corridor air quality...'
                  : 'Select origin, destination, and mode to compare available routes.'}
              </p>
            )}
          </div>

          {comparison?.limitations && comparison.limitations.length > 0 && (
            <div className="pt-3 border-t border-slate-100 text-[11px] text-slate-500 space-y-1">
              <p className="font-medium text-slate-700">Spatial Coverage & Limitations</p>
              {comparison.limitations.map((l, i) => (
                <p key={i}>• {l}</p>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
