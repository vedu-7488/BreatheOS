import React, { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../lib/api';
import type { WeeklyInsightsData } from '../types/breatheos';

export function InsightsView() {
  const [data, setData] = useState<WeeklyInsightsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api
      .getWeeklyInsights()
      .then((res) => setData(res))
      .catch((err) => setError(err instanceof Error ? err.message : 'Unable to load weekly insights.'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium text-slate-500">
          Insights R3 · Historical Exposure Coverage & Comparable Trends
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 mt-1">
          Weekly Exposure & Coverage Audit
        </h1>
        <p className="text-sm text-slate-600 mt-1 max-w-2xl">
          Tracks recorded AirTwin reports and coverage completeness. Week-over-week progress is withheld whenever comparable baseline data is insufficient.
        </p>
      </div>

      {error && (
        <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">{error}</div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs text-slate-500">Routine Segments</p>
          <p className="text-2xl font-semibold font-mono-tabular text-slate-900 mt-1.5">
            {loading ? '—' : data?.completed_segments_count ?? 0}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">Active logged segments</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs text-slate-500">Comparable Days</p>
          <p className="text-2xl font-semibold font-mono-tabular text-slate-900 mt-1.5">
            {loading ? '—' : data?.comparable_days_count ?? 0}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">Min 6 needed for WoW trend</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs text-slate-500">Mean Data Coverage</p>
          <p className="text-2xl font-semibold font-mono-tabular text-slate-900 mt-1.5">
            {loading ? '—' : `${data?.coverage_percent ?? 0}%`}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">Across stored reports</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs text-slate-500">Week-over-Week Delta</p>
          <p className="text-lg font-semibold font-mono-tabular text-slate-900 mt-2">
            {data?.week_over_week_status === 'COMPARABLE' && data.week_over_week_delta_pct !== null
              ? `${data.week_over_week_delta_pct > 0 ? '+' : ''}${data.week_over_week_delta_pct}%`
              : 'Insufficient Data'}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">
            {data?.week_over_week_status || 'CHECKING'}
          </p>
        </div>
      </div>

      <section className="bg-white border border-slate-200 rounded-xl p-6">
        <h2 className="text-base font-semibold text-slate-900">Recorded Daily Mean Relative Index</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Persisted AirTwin v1.0 daily reports · Gaps are never filled with synthetic values
        </p>

        <div className="h-[260px] w-full mt-4">
          {data && data.daily_series.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.daily_series} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#475569' }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#64748B' }} tickLine={false} axisLine={false} width={40} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#FFFFFF',
                    borderColor: '#E2E8F0',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                />
                <Bar dataKey="mean_relative_index" name="Mean Relative Index" fill="#0D6E6E" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-slate-500">
              {loading ? 'Loading exposure history...' : 'Recalculate and save an AirTwin report to populate trends.'}
            </div>
          )}
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-white border border-slate-200 rounded-xl p-6">
          <h2 className="text-base font-semibold text-slate-900">Recommendation History</h2>
          <p className="text-xs text-slate-500 mt-0.5">Persisted guidance from AI Action Planner</p>
          <div className="mt-4 divide-y divide-slate-100">
            {data?.recommendation_history && data.recommendation_history.length > 0 ? (
              data.recommendation_history.map((rec) => (
                <div key={rec.id} className="py-3">
                  <p className="text-xs font-mono-tabular text-slate-500">
                    {rec.created_at_ist} · {rec.intent}
                  </p>
                  <p className="text-sm text-slate-800 mt-1">{rec.summary}</p>
                </div>
              ))
            ) : (
              <p className="text-xs text-slate-500 py-4">No recommendation history recorded yet.</p>
            )}
          </div>
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-6">
          <h2 className="text-base font-semibold text-slate-900">Comparability & Audit Limitations</h2>
          <div className="mt-3 space-y-2 text-xs text-slate-600 leading-relaxed">
            {data?.limitations.map((l, i) => (
              <p key={i}>• {l}</p>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
