import React, { useEffect, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AlertCircle, ArrowUpRight, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import type {
  CurrentAirData,
  ForecastAirData,
  MonitoringStation,
  NCRLocation,
  SourceStatusItem,
} from '../types/breatheos';

interface DashboardViewProps {
  location: NCRLocation;
  onNavigate: (tab: 'airtwin' | 'planner' | 'airroute' | 'indoor') => void;
}

function getAqiTone(aqi: number | null): { text: string; bar: string } {
  if (aqi === null) return { text: 'text-slate-500', bar: 'bg-slate-300' };
  if (aqi <= 50) return { text: 'text-emerald-700', bar: 'bg-emerald-600' };
  if (aqi <= 100) return { text: 'text-lime-700', bar: 'bg-lime-600' };
  if (aqi <= 200) return { text: 'text-amber-700', bar: 'bg-amber-600' };
  if (aqi <= 300) return { text: 'text-orange-700', bar: 'bg-orange-600' };
  if (aqi <= 400) return { text: 'text-red-700', bar: 'bg-red-600' };
  return { text: 'text-rose-800', bar: 'bg-rose-700' };
}

export function DashboardView({ location, onNavigate }: DashboardViewProps) {
  const [current, setCurrent] = useState<CurrentAirData | null>(null);
  const [forecast, setForecast] = useState<ForecastAirData | null>(null);
  const [stations, setStations] = useState<MonitoringStation[]>([]);
  const [stationNotice, setStationNotice] = useState<string | null>(null);
  const [sources, setSources] = useState<SourceStatusItem[]>([]);
  const [hoursHorizon, setHoursHorizon] = useState<24 | 48 | 96>(48);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadAll(hours = hoursHorizon) {
    setLoading(true);
    setError(null);
    try {
      const [curRes, fcRes, stRes, srcRes] = await Promise.all([
        api.getCurrentAir(location.latitude, location.longitude),
        api.getAirForecast(location.latitude, location.longitude, hours),
        api.getStations(location.latitude, location.longitude, 25),
        api.getSourcesStatus(),
      ]);
      setCurrent(curRes);
      setForecast(fcRes);
      setStations(stRes.stations);
      setStationNotice(stRes.notice);
      setSources(srcRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to retrieve environmental telemetry.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll(hoursHorizon);
  }, [location.id, hoursHorizon]);

  const aqiVal = current?.aqi.value ?? null;
  const tone = getAqiTone(aqiVal);
  const primaryPollutants = current?.pollutants.slice(0, 4) || [];

  const chartData =
    forecast?.forecast.map((pt) => ({
      time: pt.timestamp_ist.replace(' IST', ''),
      aqi: pt.aqi_in_naqi,
      pm25: pt.pm25,
      wind: pt.wind_speed_kmh,
    })) || [];

  return (
    <div className="space-y-6">
      {/* Top Contextual Bar */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-slate-500">
            Delhi NCR Pilot · {location.zone} · {location.latitude.toFixed(4)}, {location.longitude.toFixed(4)}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 mt-1">
            {location.name} Air Intelligence
          </h1>
          <p className="text-sm text-slate-600 mt-1 max-w-2xl">{location.description}</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => loadAll(hoursHorizon)}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh Data
          </button>
          <button
            type="button"
            onClick={() => onNavigate('planner')}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-[#0D6E6E] hover:bg-[#095454] rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            Plan Today
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3 text-sm text-red-800">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">Environmental provider error</p>
            <p className="text-xs text-red-700 mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {/* Primary Focal Anchor + Meteorological & Window Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <section className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs text-slate-500">
                {current?.aqi.index_system || 'IN_NAQI'} · {current?.source.provider || 'Loading...'} ·{' '}
                {current?.source.observed_at_ist || 'Timestamp unavailable'}
              </p>
              <div className="flex items-baseline gap-4 mt-3">
                <span className={`text-5xl font-semibold font-mono-tabular tracking-tight ${tone.text}`}>
                  {loading ? '—' : aqiVal !== null ? aqiVal : 'Unavailable'}
                </span>
                <div>
                  <p className={`text-lg font-semibold ${tone.text}`}>
                    {current?.aqi.category || (loading ? 'Loading' : 'Unavailable')}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Dominant pollutant: {current?.aqi.dominant_pollutant || 'Unavailable'}
                  </p>
                </div>
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs font-medium text-slate-700">
                {current?.source.measurement_type || 'UNAVAILABLE'}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                Quality: {current?.source.quality || 'UNAVAILABLE'}
              </p>
              {current?.secondary_aqi?.value != null && (
                <p className="text-xs text-slate-500 font-mono-tabular mt-1">
                  {current.secondary_aqi.index_system}: {current.secondary_aqi.value}
                </p>
              )}
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <p className="text-xs text-slate-600 leading-relaxed max-w-xl">
              {current?.source.notes || 'Retrieving environmental provenance metadata...'}
            </p>
            <button
              type="button"
              onClick={() => onNavigate('airtwin')}
              className="text-xs font-medium text-[#0D6E6E] hover:underline whitespace-nowrap shrink-0 text-left"
            >
              Inspect Personal Exposure →
            </button>
          </div>
        </section>

        <section className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between">
          <div>
            <p className="text-xs text-slate-500">
              Dispersion & Planning Window · {current?.weather.provider || 'Open-Meteo Weather'}
            </p>
            <h2 className="text-base font-semibold text-slate-900 mt-1">
              Optimal Outdoor Window (Next 24h)
            </h2>
            {forecast?.best_window ? (
              <div className="mt-4">
                <p className="text-xl font-semibold font-mono-tabular text-[#0D6E6E]">
                  {forecast.best_window.start_ist.replace(' IST', '')} – {forecast.best_window.end_ist}
                </p>
                <p className="text-xs text-slate-600 mt-1.5">
                  Modelled mean PM2.5{' '}
                  <span className="font-mono-tabular font-medium text-slate-900">
                    {forecast.best_window.avg_pm25} µg/m³
                  </span>{' '}
                  · Estimated IN_NAQI{' '}
                  <span className="font-mono-tabular font-medium text-slate-900">
                    {forecast.best_window.avg_aqi}
                  </span>
                </p>
              </div>
            ) : (
              <p className="text-sm text-slate-500 mt-4">
                {loading ? 'Evaluating hourly dispersion forecast...' : 'Forecast window unavailable.'}
              </p>
            )}
          </div>

          <div className="mt-6 pt-4 border-t border-slate-100 grid grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-slate-500">Wind</p>
              <p className="text-sm font-medium font-mono-tabular text-slate-900 mt-0.5">
                {current?.weather.wind_speed_kmh !== null && current?.weather.wind_speed_kmh !== undefined
                  ? `${current.weather.wind_speed_kmh} km/h`
                  : 'N/A'}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Humidity</p>
              <p className="text-sm font-medium font-mono-tabular text-slate-900 mt-0.5">
                {current?.weather.humidity_pct !== null && current?.weather.humidity_pct !== undefined
                  ? `${current.weather.humidity_pct}%`
                  : 'N/A'}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Temp</p>
              <p className="text-sm font-medium font-mono-tabular text-slate-900 mt-0.5">
                {current?.weather.temperature_c !== null && current?.weather.temperature_c !== undefined
                  ? `${current.weather.temperature_c} °C`
                  : 'N/A'}
              </p>
            </div>
          </div>
        </section>
      </div>

      {/* 4-Up Pollutant Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {(primaryPollutants.length > 0
          ? primaryPollutants
          : [
              { code: 'PM25', label: 'PM2.5', value: null, unit: 'µg/m³', sub_index: null, quality: 'UNAVAILABLE', source: '—' },
              { code: 'PM10', label: 'PM10', value: null, unit: 'µg/m³', sub_index: null, quality: 'UNAVAILABLE', source: '—' },
              { code: 'NO2', label: 'NO₂', value: null, unit: 'µg/m³', sub_index: null, quality: 'UNAVAILABLE', source: '—' },
              { code: 'O3', label: 'O₃', value: null, unit: 'µg/m³', sub_index: null, quality: 'UNAVAILABLE', source: '—' },
            ]
        ).map((p) => (
          <div key={p.code} className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span className="font-medium text-slate-700">{p.label}</span>
              <span>{p.quality}</span>
            </div>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="text-2xl font-semibold font-mono-tabular text-slate-900">
                {p.value !== null ? p.value : 'Unavailable'}
              </span>
              {p.value !== null && <span className="text-xs text-slate-500">{p.unit}</span>}
            </div>
            <p className="text-xs text-slate-500 font-mono-tabular mt-1.5">
              Sub-index: {p.sub_index !== null ? p.sub_index : 'N/A'}
            </p>
          </div>
        ))}
      </div>

      {/* Hourly Forecast Chart */}
      <section className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Hourly AQI & PM2.5 Forecast ({location.name})
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {forecast?.index_system || 'IN_NAQI'} · {forecast?.spatial_resolution || '0.1° grid'} · Asia/Kolkata (IST)
            </p>
          </div>
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg shrink-0 self-start sm:self-auto">
            {([24, 48, 96] as const).map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => setHoursHorizon(h)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  hoursHorizon === h ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {h}h
              </button>
            ))}
          </div>
        </div>

        <div className="h-[280px] w-full">
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="pm25Fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0D6E6E" stopOpacity={0.22} />
                    <stop offset="95%" stopColor="#0D6E6E" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                <XAxis
                  dataKey="time"
                  tick={{ fontSize: 11, fill: '#64748B' }}
                  tickLine={false}
                  axisLine={{ stroke: '#E2E8F0' }}
                  minTickGap={28}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#64748B' }}
                  tickLine={false}
                  axisLine={false}
                  width={42}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#FFFFFF',
                    borderColor: '#E2E8F0',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="aqi"
                  name="IN_NAQI (Modelled)"
                  stroke="#0D6E6E"
                  strokeWidth={2}
                  fill="url(#pm25Fill)"
                />
                <Area
                  type="monotone"
                  dataKey="pm25"
                  name="PM2.5 (µg/m³)"
                  stroke="#D97706"
                  strokeWidth={1.5}
                  fill="none"
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-slate-500">
              {loading ? 'Loading hourly forecast...' : 'Hourly forecast data is currently unavailable.'}
            </div>
          )}
        </div>
        {forecast?.limitations && forecast.limitations.length > 0 && (
          <p className="text-xs text-slate-500 mt-4 pt-3 border-t border-slate-100">
            Methodology note: {forecast.limitations[0]}
          </p>
        )}
      </section>

      {/* Stations & Source Provenance Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-white border border-slate-200 rounded-xl p-6">
          <h2 className="text-base font-semibold text-slate-900">Nearby Ground Monitoring Stations</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            25 km radius around {location.name} · Physical sensor feed verification
          </p>

          {stations.length > 0 ? (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500">
                    <th className="py-2 font-medium">Station</th>
                    <th className="py-2 font-medium text-right">Dist</th>
                    <th className="py-2 font-medium text-right">Latest IST</th>
                    <th className="py-2 font-medium text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {stations.slice(0, 6).map((st) => (
                    <tr key={st.station_id} className="h-10">
                      <td className="py-2 pr-3 font-medium text-slate-900 truncate max-w-[180px]">
                        {st.name}
                      </td>
                      <td className="py-2 text-right font-mono-tabular text-slate-600">{st.distance_km} km</td>
                      <td className="py-2 text-right font-mono-tabular text-slate-600">
                        {st.latest_observed_at_ist || 'N/A'}
                      </td>
                      <td className="py-2 text-right font-medium text-slate-700">{st.quality}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="mt-4 p-4 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600 leading-relaxed">
              {stationNotice ||
                'No physical monitoring stations returned for this radius. Missing sensor feeds are never substituted with fabricated station numbers.'}
            </div>
          )}
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-6">
          <h2 className="text-base font-semibold text-slate-900">Data Source Health & Provenance</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Explicit separation between physical observations and atmospheric models
          </p>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500">
                  <th className="py-2 font-medium">Provider</th>
                  <th className="py-2 font-medium">Type</th>
                  <th className="py-2 font-medium text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {sources.map((src) => (
                  <tr key={src.provider_id} className="h-11">
                    <td className="py-2 pr-3">
                      <p className="font-medium text-slate-900">{src.name}</p>
                      <p className="text-slate-500 text-[11px] mt-0.5">{src.notes}</p>
                    </td>
                    <td className="py-2 pr-3 text-slate-600 whitespace-nowrap">
                      {src.measurement_type.replace('_', ' ')}
                    </td>
                    <td
                      className={`py-2 text-right font-medium whitespace-nowrap ${
                        src.status === 'OPERATIONAL'
                          ? 'text-emerald-700'
                          : src.status === 'DEGRADED'
                          ? 'text-amber-700'
                          : 'text-red-700'
                      }`}
                    >
                      {src.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
