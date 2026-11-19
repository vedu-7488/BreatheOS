import crypto from 'node:crypto';
import type {
  ActivityType,
  ConfidenceLevel,
  EnvironmentType,
  ExposureReportData,
  ExposureSegmentResult,
  PollutantContribution,
} from '../../src/types/breatheos.js';
import { formatIST, getCurrentAirConditions } from './environmental.js';

export const AIRTWIN_METHODOLOGY_VERSION = '1.0';
export const REFERENCE_BASELINE_VERSION = 'CPCB-NAAQS-24H-2026.1';

// Documented CPCB 24-hour / 8-hour reference concentration baselines (µg/m³)
const REFERENCE_BASELINES_UGM3: Record<string, number> = {
  PM25: 60,  // CPCB 24-hr standard
  PM10: 100, // CPCB 24-hr standard
  NO2: 80,   // CPCB 24-hr standard
  O3: 100,   // CPCB 8-hr standard
};

// Documented building envelope infiltration ratios when no indoor sensor is paired
const INDOOR_INFILTRATION_FACTOR_NO_PURIFIER = 0.65;
const INDOOR_INFILTRATION_FACTOR_WITH_PURIFIER = 0.38;

export interface ExposureSegmentInput {
  activity_id: string;
  title?: string;
  activity_type: ActivityType;
  start_time?: string;
  end_time?: string;
  duration_minutes: number;
  latitude: number;
  longitude: number;
  environment: EnvironmentType;
  indoor_pm25_reading?: number | null;
  indoor_purifier_on?: boolean;
}

export async function calculateExposureReport(
  periodStart: string,
  periodEnd: string,
  segmentsInput: ExposureSegmentInput[]
): Promise<ExposureReportData> {
  // Fetch environmental conditions per unique coordinate pair concurrently
  const coordKeys = Array.from(
    new Set(segmentsInput.map((s) => `${s.latitude.toFixed(3)},${s.longitude.toFixed(3)}`))
  );

  const envByCoord = new Map<string, Awaited<ReturnType<typeof getCurrentAirConditions>>>();
  await Promise.all(
    coordKeys.map(async (key) => {
      const [latStr, lngStr] = key.split(',');
      const data = await getCurrentAirConditions(Number(latStr), Number(lngStr));
      envByCoord.set(key, data);
    })
  );

  const segmentResults: ExposureSegmentResult[] = [];
  const globalLimitations = new Set<string>();
  let totalTrackedMinutes = 0;
  let calculableMinutes = 0;
  let weightedIndexSum = 0;

  for (const seg of segmentsInput) {
    if (!Number.isFinite(seg.duration_minutes) || seg.duration_minutes <= 0) {
      throw new Error(`Invalid duration_minutes (${seg.duration_minutes}) for segment ${seg.activity_id}`);
    }

    totalTrackedMinutes += seg.duration_minutes;
    const durationHours = Number((seg.duration_minutes / 60).toFixed(2));
    const coordKey = `${seg.latitude.toFixed(3)},${seg.longitude.toFixed(3)}`;
    const env = envByCoord.get(coordKey);
    const assumptions: string[] = [];
    const sourceIds: string[] = [];

    const startTime = seg.start_time || periodStart;
    const endTime = seg.end_time || periodEnd;

    let indoorStatus: ExposureSegmentResult['indoor_status'] = 'NOT_APPLICABLE';
    let confidence: ConfidenceLevel = 'MEDIUM';
    let quality: ExposureSegmentResult['quality'] = env?.source.quality || 'UNAVAILABLE';

    if (env && env.source.quality !== 'UNAVAILABLE') {
      sourceIds.push(env.source.provider);
      if (env.source.measurement_type === 'MODELLED') {
        assumptions.push(
          `Ambient concentrations sourced from ${env.source.provider} modelled grid rather than co-located physical station.`
        );
        confidence = 'MEDIUM';
      }
      if (env.source.quality === 'STALE') {
        assumptions.push('Environmental reading is stale (>3h); exposure estimate carries elevated uncertainty.');
        confidence = 'LOW';
      }
    }

    const contributions: PollutantContribution[] = [];
    let segmentRelativeIndex: number | null = null;

    if (seg.environment === 'INDOOR') {
      if (typeof seg.indoor_pm25_reading === 'number' && Number.isFinite(seg.indoor_pm25_reading)) {
        indoorStatus = 'MEASURED_SENSOR';
        sourceIds.push('User Indoor Sensor Input');
        quality = 'VALID';
        confidence = 'HIGH';
        assumptions.push(
          `Used user-provided indoor PM2.5 sensor reading (${seg.indoor_pm25_reading.toFixed(1)} µg/m³).`
        );
        const baseline = REFERENCE_BASELINES_UGM3.PM25;
        const contribution = Number((seg.indoor_pm25_reading * durationHours).toFixed(1));
        const relIdx = Math.round(((seg.indoor_pm25_reading * durationHours) / (baseline * durationHours)) * 100);
        contributions.push({
          pollutant: 'PM2.5',
          concentration: Number(seg.indoor_pm25_reading.toFixed(1)),
          unit: 'µg/m³',
          duration_hours: durationHours,
          contribution,
          reference_baseline_24h: baseline,
          relative_index: relIdx,
        });
        segmentRelativeIndex = relIdx;
      } else {
        // Indoor without sensor: never equate indoor = outdoor silently
        const pm25Reading = env?.pollutants.find((p) => p.code === 'PM25')?.value ?? null;
        if (pm25Reading === null || !env || env.source.quality === 'UNAVAILABLE') {
          indoorStatus = 'UNAVAILABLE';
          quality = 'UNAVAILABLE';
          confidence = 'LOW';
          assumptions.push('No indoor sensor reading and no valid outdoor ambient data; exposure marked UNAVAILABLE.');
          globalLimitations.add('Missing indoor sensor and ambient data prevented calculation for one or more indoor segments.');
        } else {
          indoorStatus = 'ASSUMED_INFILTRATION';
          quality = 'ASSUMED';
          confidence = 'LOW';
          const factor = seg.indoor_purifier_on
            ? INDOOR_INFILTRATION_FACTOR_WITH_PURIFIER
            : INDOOR_INFILTRATION_FACTOR_NO_PURIFIER;
          const assumedIndoorPm25 = Number((pm25Reading * factor).toFixed(1));
          assumptions.push(
            seg.indoor_purifier_on
              ? `No indoor sensor paired. Applied assumed infiltration factor (${factor}) for purifier-equipped space over outdoor PM2.5 (${pm25Reading} µg/m³). Purifier CADR efficiency is unverified.`
              : `No indoor sensor paired. Applied assumed building infiltration factor (${factor}) over outdoor PM2.5 (${pm25Reading} µg/m³).`
          );
          globalLimitations.add(
            'Indoor segments without a paired indoor monitor rely on disclosed infiltration assumptions rather than direct measurements.'
          );

          const baseline = REFERENCE_BASELINES_UGM3.PM25;
          const contribution = Number((assumedIndoorPm25 * durationHours).toFixed(1));
          const relIdx = Math.round(((assumedIndoorPm25 * durationHours) / (baseline * durationHours)) * 100);
          contributions.push({
            pollutant: 'PM2.5 (Assumed Indoor)',
            concentration: assumedIndoorPm25,
            unit: 'µg/m³',
            duration_hours: durationHours,
            contribution,
            reference_baseline_24h: baseline,
            relative_index: relIdx,
          });
          segmentRelativeIndex = relIdx;
        }
      }
    } else {
      // OUTDOOR or TRANSIT
      if (!env || env.source.quality === 'UNAVAILABLE') {
        quality = 'UNAVAILABLE';
        confidence = 'LOW';
        assumptions.push('Ambient air data unavailable; missing data is never converted to zero exposure.');
        globalLimitations.add('One or more outdoor/transit segments lacked valid environmental observations.');
      } else {
        if (seg.environment === 'TRANSIT') {
          assumptions.push(
            'Transit segment evaluated using ambient location corridor concentration; cabin filtration or open-window variance is not directly measured.'
          );
        }
        const trackedCodes: Array<{ code: 'PM25' | 'PM10' | 'NO2' | 'O3'; label: string }> = [
          { code: 'PM25', label: 'PM2.5' },
          { code: 'PM10', label: 'PM10' },
          { code: 'NO2', label: 'NO₂' },
          { code: 'O3', label: 'O₃' },
        ];
        for (const item of trackedCodes) {
          const p = env.pollutants.find((pl) => pl.code === item.code);
          const conc = p?.value ?? null;
          const baseline = REFERENCE_BASELINES_UGM3[item.code];
          if (conc !== null && baseline) {
            const contribution = Number((conc * durationHours).toFixed(1));
            const relIdx = Math.round(((conc * durationHours) / (baseline * durationHours)) * 100);
            contributions.push({
              pollutant: item.label,
              concentration: conc,
              unit: p?.unit || 'µg/m³',
              duration_hours: durationHours,
              contribution,
              reference_baseline_24h: baseline,
              relative_index: relIdx,
            });
          } else {
            contributions.push({
              pollutant: item.label,
              concentration: null,
              unit: 'µg/m³',
              duration_hours: durationHours,
              contribution: null,
              reference_baseline_24h: baseline,
              relative_index: null,
            });
          }
        }
        // Primary segment relative index anchored to PM2.5 if present, else max pollutant relative index
        const pm25Contrib = contributions.find((c) => c.pollutant === 'PM2.5' && c.relative_index !== null);
        const validRelIndices = contributions.map((c) => c.relative_index).filter((x): x is number => x !== null);
        if (pm25Contrib && pm25Contrib.relative_index !== null) {
          segmentRelativeIndex = pm25Contrib.relative_index;
        } else if (validRelIndices.length > 0) {
          segmentRelativeIndex = Math.max(...validRelIndices);
        } else {
          quality = 'INSUFFICIENT';
          confidence = 'LOW';
          globalLimitations.add('Insufficient pollutant observations for relative exposure normalization.');
        }
      }
    }

    if (segmentRelativeIndex !== null) {
      calculableMinutes += seg.duration_minutes;
      weightedIndexSum += segmentRelativeIndex * seg.duration_minutes;
    }

    segmentResults.push({
      activity_id: seg.activity_id,
      title: seg.title || seg.activity_type,
      activity_type: seg.activity_type,
      environment: seg.environment,
      start_time: startTime,
      end_time: endTime,
      start_ist: formatIST(startTime) || startTime,
      end_ist: formatIST(endTime) || endTime,
      duration_minutes: seg.duration_minutes,
      contributions,
      relative_index: segmentRelativeIndex,
      confidence,
      quality,
      indoor_status: indoorStatus,
      assumptions,
      source_ids: Array.from(new Set(sourceIds)),
    });
  }

  let status: ExposureReportData['status'] = 'COMPLETE';
  if (calculableMinutes === 0) {
    status = 'UNAVAILABLE';
  } else if (
    calculableMinutes < totalTrackedMinutes ||
    segmentResults.some((s) => s.quality === 'ASSUMED' || s.confidence === 'LOW')
  ) {
    status = 'PARTIAL';
  }

  globalLimitations.add(
    'AirTwin reports comparative concentration-time indices relative to CPCB 24h reference thresholds, not inhaled biological dose or medical risk.'
  );

  return {
    report_id: crypto.randomUUID(),
    methodology_version: AIRTWIN_METHODOLOGY_VERSION,
    reference_baseline_version: REFERENCE_BASELINE_VERSION,
    status,
    period_start: periodStart,
    period_end: periodEnd,
    total_tracked_minutes: totalTrackedMinutes,
    calculable_minutes: calculableMinutes,
    mean_relative_index:
      calculableMinutes > 0 ? Number((weightedIndexSum / calculableMinutes).toFixed(1)) : null,
    segments: segmentResults,
    limitations: Array.from(globalLimitations),
    generated_at: new Date().toISOString(),
  };
}
