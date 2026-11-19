import React, { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Plus, RefreshCw, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import type {
  ActivityType,
  EnvironmentType,
  ExposureReportData,
  NCRLocation,
  UserActivity,
} from '../types/breatheos';

interface AirTwinViewProps {
  locations: NCRLocation[];
}

export function AirTwinView({ locations }: AirTwinViewProps) {
  const [activities, setActivities] = useState<UserActivity[]>([]);
  const [report, setReport] = useState<ExposureReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [calculating, setCalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New Activity Form state
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [activityType, setActivityType] = useState<ActivityType>('COMMUTE');
  const [environment, setEnvironment] = useState<EnvironmentType>('OUTDOOR');
  const [locationId, setLocationId] = useState(locations[0]?.id || 'noida-sector-62');
  const [startTimeLocal, setStartTimeLocal] = useState('08:30');
  const [endTimeLocal, setEndTimeLocal] = useState('09:15');
  const [indoorPm25, setIndoorPm25] = useState('');
  const [purifierOn, setPurifierOn] = useState(false);

  async function loadAndEstimate(persist = false) {
    setLoading(true);
    setError(null);
    try {
      const list = await api.getActivities();
      setActivities(list);
      if (list.length > 0) {
        setCalculating(true);
        const res = await api.estimateExposure({
          period_start: list[0].start_time,
          period_end: list[list.length - 1].end_time,
          persist,
          segments: list.map((a) => ({
            activity_id: a.id,
            title: a.title,
            activity_type: a.activity_type,
            start_time: a.start_time,
            end_time: a.end_time,
            duration_minutes: Math.max(
              15,
              Math.round((new Date(a.end_time).getTime() - new Date(a.start_time).getTime()) / 60000)
            ),
            latitude: a.latitude,
            longitude: a.longitude,
            environment: a.environment,
            indoor_pm25_reading: a.indoor_pm25_reading,
            indoor_purifier_on: a.indoor_purifier_on,
          })),
        });
        setReport(res);
      } else {
        setReport(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to evaluate AirTwin exposure.');
    } finally {
      setLoading(false);
      setCalculating(false);
    }
  }

  useEffect(() => {
    loadAndEstimate(false);
  }, []);

  async function handleAddActivity(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const loc = locations.find((l) => l.id === locationId) || locations[0];
    const todayIstDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const startIso = new Date(`${todayIstDate}T${startTimeLocal}:00+05:30`).toISOString();
    const endIso = new Date(`${todayIstDate}T${endTimeLocal}:00+05:30`).toISOString();

    try {
      await api.createActivity({
        activity_type: activityType,
        title,
        start_time: startIso,
        end_time: endIso,
        location: { id: loc.id, name: loc.name, latitude: loc.latitude, longitude: loc.longitude },
        environment,
        indoor_pm25_reading:
          environment === 'INDOOR' && indoorPm25.trim() !== '' ? Number(indoorPm25) : null,
        indoor_purifier_on: purifierOn,
      });
      setTitle('');
      setIndoorPm25('');
      setShowForm(false);
      await loadAndEstimate(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create activity.');
    }
  }

  async function handleDelete(id: string) {
    try {
      await api.deleteActivity(id);
      await loadAndEstimate(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete activity.');
    }
  }

  const chartData =
    report?.segments.map((s) => ({
      name: s.title.length > 20 ? `${s.title.slice(0, 18)}…` : s.title,
      relative_index: s.relative_index ?? 0,
      isUnavailable: s.relative_index === null,
      quality: s.quality,
      duration: s.duration_minutes,
    })) || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-slate-500">
            AirTwin Methodology v{report?.methodology_version || '1.0'} · Baseline{' '}
            {report?.reference_baseline_version || 'CPCB-NAAQS-24H-2026.1'}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 mt-1">
            Personal Relative Exposure Timeline
          </h1>
          <p className="text-sm text-slate-600 mt-1 max-w-2xl">
            Comparative concentration-time exposure across your daily routine. Missing data or unmeasured indoor rooms are explicitly disclosed and never converted to zero.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => loadAndEstimate(true)}
            disabled={calculating}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${calculating ? 'animate-spin' : ''}`} />
            Recalculate & Save
          </button>
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-[#0D6E6E] hover:bg-[#095454] rounded-lg whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Activity
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">{error}</div>
      )}

      {showForm && (
        <form onSubmit={handleAddActivity} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h2 className="text-sm font-semibold text-slate-900">New Routine Segment (Asia/Kolkata)</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">Activity Title</label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Evening Metro & Walk Commute"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0D6E6E]/20"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Category</label>
              <select
                value={activityType}
                onChange={(e) => setActivityType(e.target.value as ActivityType)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
              >
                <option value="COMMUTE">Commute</option>
                <option value="WORK">Work</option>
                <option value="EXERCISE">Exercise</option>
                <option value="ERRAND">Errand</option>
                <option value="HOME">Home</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Location (Delhi NCR)</label>
              <select
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
              >
                {locations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name} ({loc.zone})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Environment</label>
              <select
                value={environment}
                onChange={(e) => setEnvironment(e.target.value as EnvironmentType)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
              >
                <option value="OUTDOOR">Outdoor</option>
                <option value="TRANSIT">Transit</option>
                <option value="INDOOR">Indoor</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Start (IST)</label>
                <input
                  type="time"
                  required
                  value={startTimeLocal}
                  onChange={(e) => setStartTimeLocal(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono-tabular"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">End (IST)</label>
                <input
                  type="time"
                  required
                  value={endTimeLocal}
                  onChange={(e) => setEndTimeLocal(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono-tabular"
                />
              </div>
            </div>
          </div>

          {environment === 'INDOOR' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Optional Indoor PM2.5 Sensor Reading (µg/m³)
                </label>
                <input
                  type="number"
                  min={0}
                  step="0.1"
                  value={indoorPm25}
                  onChange={(e) => setIndoorPm25(e.target.value)}
                  placeholder="Leave blank if unmeasured"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono-tabular"
                />
              </div>
              <div className="flex items-end pb-2">
                <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={purifierOn}
                    onChange={(e) => setPurifierOn(e.target.checked)}
                    className="rounded border-slate-300 text-[#0D6E6E] focus:ring-[#0D6E6E]"
                  />
                  HEPA Air Purifier Active in Room
                </label>
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-900"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-medium text-white bg-[#0D6E6E] hover:bg-[#095454] rounded-lg"
            >
              Save Segment
            </button>
          </div>
        </form>
      )}

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs text-slate-500">Mean Relative Index</p>
          <p className="text-2xl font-semibold font-mono-tabular text-slate-900 mt-1.5">
            {loading ? '—' : report?.mean_relative_index !== null && report?.mean_relative_index !== undefined ? report.mean_relative_index : 'Unavailable'}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">100 = CPCB 24h PM2.5 ref (60 µg/m³)</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs text-slate-500">Report Status</p>
          <p className="text-2xl font-semibold text-slate-900 mt-1.5">{report?.status || 'UNAVAILABLE'}</p>
          <p className="text-[11px] text-slate-500 mt-1">Transparent quality gate</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs text-slate-500">Tracked Routine</p>
          <p className="text-2xl font-semibold font-mono-tabular text-slate-900 mt-1.5">
            {report ? `${Math.round(report.total_tracked_minutes / 60)}h ${report.total_tracked_minutes % 60}m` : '0h'}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">{activities.length} segments logged</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs text-slate-500">Calculable Coverage</p>
          <p className="text-2xl font-semibold font-mono-tabular text-slate-900 mt-1.5">
            {report && report.total_tracked_minutes > 0
              ? `${Math.round((report.calculable_minutes / report.total_tracked_minutes) * 100)}%`
              : '0%'}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">Excludes unavailable intervals</p>
        </div>
      </div>

      {/* Relative Index Bar Chart */}
      <section className="bg-white border border-slate-200 rounded-xl p-6">
        <h2 className="text-base font-semibold text-slate-900">Segment Relative Exposure Comparison</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Relative concentration-time intensity per segment (100 baseline = 60 µg/m³ PM2.5 CPCB 24h standard)
        </p>
        <div className="h-[240px] w-full mt-4">
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#475569' }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#64748B' }} tickLine={false} axisLine={false} width={40} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#FFFFFF',
                    borderColor: '#E2E8F0',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                />
                <Bar dataKey="relative_index" name="Relative Index" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry, idx) => (
                    <Cell
                      key={`cell-${idx}`}
                      fill={
                        entry.isUnavailable
                          ? '#CBD5E1'
                          : entry.quality === 'ASSUMED'
                          ? '#D97706'
                          : entry.relative_index > 200
                          ? '#C2410C'
                          : '#0D6E6E'
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-slate-500">
              {loading ? 'Calculating exposure segments...' : 'Add an activity segment to generate your AirTwin timeline.'}
            </div>
          )}
        </div>
      </section>

      {/* Detailed Segment Ledger */}
      <section className="bg-white border border-slate-200 rounded-xl p-6">
        <h2 className="text-base font-semibold text-slate-900">Segment Breakdown & Assumptions</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Every relative index preserves its pollutant-specific concentration × duration math, confidence, and source.
        </p>

        <div className="mt-4 divide-y divide-slate-200">
          {report?.segments.map((seg) => {
            const pmContrib = seg.contributions.find((c) => c.pollutant.startsWith('PM2.5'));
            return (
              <div key={seg.activity_id} className="py-4 flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                <div className="space-y-1.5 min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span className="font-mono-tabular">
                      {seg.start_ist} – {seg.end_ist}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{seg.environment}</span>
                    <span aria-hidden="true">·</span>
                    <span>{seg.duration_minutes} min</span>
                    <span aria-hidden="true">·</span>
                    <span
                      className={`font-medium ${
                        seg.quality === 'VALID'
                          ? 'text-emerald-700'
                          : seg.quality === 'ASSUMED'
                          ? 'text-amber-700'
                          : seg.quality === 'UNAVAILABLE'
                          ? 'text-red-700'
                          : 'text-slate-700'
                      }`}
                    >
                      {seg.quality} ({seg.confidence} confidence)
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-slate-900">{seg.title}</p>

                  {seg.assumptions.length > 0 && (
                    <ul className="text-xs text-slate-600 space-y-0.5">
                      {seg.assumptions.map((a, i) => (
                        <li key={i}>• {a}</li>
                      ))}
                    </ul>
                  )}

                  <p className="text-[11px] text-slate-500">
                    Sources: {seg.source_ids.length > 0 ? seg.source_ids.join(', ') : 'None available'}
                  </p>
                </div>

                <div className="flex items-center gap-6 shrink-0">
                  <div className="text-right">
                    <p className="text-xs text-slate-500">PM2.5 Contribution</p>
                    <p className="text-sm font-medium font-mono-tabular text-slate-900 mt-0.5">
                      {pmContrib?.contribution !== null && pmContrib?.contribution !== undefined
                        ? `${pmContrib.contribution} µg/m³·h`
                        : 'Unavailable'}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-slate-500">Relative Index</p>
                    <p className="text-lg font-semibold font-mono-tabular text-slate-900 mt-0.5">
                      {seg.relative_index !== null ? seg.relative_index : 'Unavailable'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDelete(seg.activity_id)}
                    aria-label={`Delete ${seg.title}`}
                    className="p-2 text-slate-400 hover:text-red-600 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {report?.limitations && report.limitations.length > 0 && (
          <div className="mt-4 pt-4 border-t border-slate-200 text-xs text-slate-600 space-y-1">
            <p className="font-medium text-slate-800">Documented Limitations</p>
            {report.limitations.map((lim, i) => (
              <p key={i}>• {lim}</p>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
