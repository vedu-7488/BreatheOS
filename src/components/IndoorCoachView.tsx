import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import type { IndoorRecommendResponse, NCRLocation } from '../types/breatheos';

interface IndoorCoachViewProps {
  location: NCRLocation;
}

export function IndoorCoachView({ location }: IndoorCoachViewProps) {
  const [roomType, setRoomType] = useState('BEDROOM');
  const [ventilationType, setVentilationType] = useState<'NATURAL' | 'MECHANICAL_HVAC' | 'SEALED'>('NATURAL');
  const [hasPurifier, setHasPurifier] = useState(false);
  const [sensorAvailable, setSensorAvailable] = useState(false);
  const [measuredPm25, setMeasuredPm25] = useState('');
  const [result, setResult] = useState<IndoorRecommendResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function evaluateIndoor() {
    setLoading(true);
    setError(null);
    try {
      const resp = await api.recommendIndoor({
        room_type: roomType,
        ventilation_type: ventilationType,
        has_air_purifier: hasPurifier,
        indoor_sensor_available: sensorAvailable,
        measured_indoor_pm25:
          sensorAvailable && measuredPm25.trim() !== '' ? Number(measuredPm25) : null,
        outdoor_location: {
          name: location.name,
          latitude: location.latitude,
          longitude: location.longitude,
        },
      });
      setResult(resp);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to evaluate indoor guidance.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    evaluateIndoor();
  }, [location.id]);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium text-slate-500">
          Indoor Air Coach R2 · Outdoor Context: {location.name}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 mt-1">
          Indoor Environment Guidance
        </h1>
        <p className="text-sm text-slate-600 mt-1 max-w-2xl">
          Deterministic ventilation and filtration suggestions. BreatheOS never fabricates an indoor AQI when no indoor sensor is paired.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Room Configuration Form */}
        <section className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h2 className="text-sm font-semibold text-slate-900">Room & Sensor Profile</h2>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Room Type</label>
            <select
              value={roomType}
              onChange={(e) => setRoomType(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
            >
              <option value="BEDROOM">Bedroom</option>
              <option value="LIVING_ROOM">Living Room</option>
              <option value="HOME_OFFICE">Home Office</option>
              <option value="OFFICE">Office Floor</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Ventilation Type</label>
            <select
              value={ventilationType}
              onChange={(e) =>
                setVentilationType(e.target.value as 'NATURAL' | 'MECHANICAL_HVAC' | 'SEALED')
              }
              className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
            >
              <option value="NATURAL">Natural (Windows / Balcony)</option>
              <option value="MECHANICAL_HVAC">Mechanical HVAC / Split AC</option>
              <option value="SEALED">Sealed Envelope</option>
            </select>
          </div>

          <div className="space-y-2.5 pt-2">
            <label className="flex items-center gap-2.5 text-xs font-medium text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={hasPurifier}
                onChange={(e) => setHasPurifier(e.target.checked)}
                className="rounded border-slate-300 text-[#0D6E6E]"
              />
              Portable HEPA Air Purifier Available
            </label>

            <label className="flex items-center gap-2.5 text-xs font-medium text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={sensorAvailable}
                onChange={(e) => setSensorAvailable(e.target.checked)}
                className="rounded border-slate-300 text-[#0D6E6E]"
              />
              Calibrated Indoor PM2.5 Sensor Paired
            </label>
          </div>

          {sensorAvailable && (
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Current Indoor PM2.5 Reading (µg/m³)
              </label>
              <input
                type="number"
                min={0}
                step="0.1"
                value={measuredPm25}
                onChange={(e) => setMeasuredPm25(e.target.value)}
                placeholder="e.g. 38.5"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono-tabular"
              />
            </div>
          )}

          <button
            type="button"
            onClick={evaluateIndoor}
            disabled={loading}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-medium text-white bg-[#0D6E6E] hover:bg-[#095454] rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Update Indoor Guidance
          </button>
        </section>

        {/* Guidance & Measurement Disclosure */}
        <section className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          {error && <p className="text-xs text-red-700">{error}</p>}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pb-4 border-b border-slate-100">
            <div>
              <p className="text-xs text-slate-500">Indoor Measurement Status</p>
              <p
                className={`text-base font-semibold mt-0.5 ${
                  result?.indoor_measurement_status === 'MEASURED' ? 'text-emerald-700' : 'text-amber-700'
                }`}
              >
                {result?.indoor_measurement_status === 'MEASURED'
                  ? `MEASURED (${result.measured_indoor_pm25} µg/m³)`
                  : 'UNMEASURED (No Indoor Sensor)'}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">Confidence: {result?.confidence || 'MEDIUM'}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Outdoor Context ({location.name})</p>
              <p className="text-base font-semibold font-mono-tabular text-slate-900 mt-0.5">
                IN_NAQI {result?.outdoor_context.aqi_in_naqi ?? 'Unavailable'} · PM2.5{' '}
                {result?.outdoor_context.pm25 ?? 'Unavailable'} µg/m³
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {result?.outdoor_context.provider} · {result?.outdoor_context.observed_at_ist || 'N/A'}
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">Practical Actions</h3>
            <div className="divide-y divide-slate-100">
              {result?.recommendations.map((rec) => (
                <div key={rec.id} className="py-3 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-900">{rec.action}</span>
                    <span className="text-[11px] font-medium text-slate-500 whitespace-nowrap shrink-0">
                      {rec.priority} PRIORITY
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">{rec.reason}</p>
                  {rec.requires_indoor_measurement && (
                    <p className="text-[11px] text-amber-700">
                      Requires indoor sensor verification to quantify indoor reduction.
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>

          {result && (
            <div className="pt-4 border-t border-slate-100 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-600">
              <div>
                <p className="font-medium text-slate-800 mb-1">Assumptions</p>
                {result.assumptions.map((a, i) => (
                  <p key={i}>• {a}</p>
                ))}
              </div>
              <div>
                <p className="font-medium text-slate-800 mb-1">Actions Requiring Measurements</p>
                {result.actions_requiring_measurements.length > 0 ? (
                  result.actions_requiring_measurements.map((m, i) => <p key={i}>• {m}</p>)
                ) : (
                  <p>• Live indoor PM2.5 reading supplied.</p>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
