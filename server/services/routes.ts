import crypto from 'node:crypto';
import type {
  RouteComparisonResponse,
  RouteOptionComparison,
  RouteSegmentSample,
  TravelMode,
} from '../../src/types/breatheos.js';
import { getCurrentAirConditions } from './environmental.js';

export interface RouteCandidateInput {
  route_id?: string;
  summary: string;
  route_labels?: string[];
  duration_seconds: number;
  distance_meters: number;
  encoded_polyline?: string;
  sample_points?: Array<{ label: string; latitude: number; longitude: number }>;
}

export async function compareRoutesWithPollution(params: {
  origin: { name?: string; latitude: number; longitude: number };
  destination: { name?: string; latitude: number; longitude: number };
  travel_mode: TravelMode;
  candidates?: RouteCandidateInput[];
}): Promise<RouteComparisonResponse> {
  const comparisonId = crypto.randomUUID();
  const candidates = params.candidates || [];

  if (candidates.length === 0) {
    return {
      comparison_id: comparisonId,
      comparison_status: 'UNAVAILABLE',
      travel_mode: params.travel_mode,
      origin: {
        name: params.origin.name || 'Origin',
        latitude: params.origin.latitude,
        longitude: params.origin.longitude,
      },
      destination: {
        name: params.destination.name || 'Destination',
        latitude: params.destination.latitude,
        longitude: params.destination.longitude,
      },
      routes: [],
      limitations: [
        'No route alternatives were supplied from Google Routes API. Route pollution comparison requires valid route geometry and travel durations.',
      ],
    };
  }

  // Evaluate air quality at unique sample coordinates across all route candidates
  const evaluatedRoutes: RouteOptionComparison[] = [];
  const globalLimitations = new Set<string>([
    'Corridor pollution samples reflect 0.1° regional modelled grids (Open-Meteo CAMS / Google Air Quality), not street-by-street tailpipe sensors.',
  ]);

  for (let idx = 0; idx < candidates.length; idx++) {
    const c = candidates[idx];
    const points =
      c.sample_points && c.sample_points.length >= 2
        ? c.sample_points
        : [
            { label: 'Origin', latitude: params.origin.latitude, longitude: params.origin.longitude },
            {
              label: 'Midpoint',
              latitude: (params.origin.latitude + params.destination.latitude) / 2,
              longitude: (params.origin.longitude + params.destination.longitude) / 2,
            },
            { label: 'Destination', latitude: params.destination.latitude, longitude: params.destination.longitude },
          ];

    const envs = await Promise.all(
      points.map((pt) => getCurrentAirConditions(pt.latitude, pt.longitude))
    );

    const samples: RouteSegmentSample[] = points.map((pt, i) => {
      const env = envs[i];
      const pm25 = env.pollutants.find((p) => p.code === 'PM25')?.value ?? null;
      return {
        label: pt.label,
        latitude: pt.latitude,
        longitude: pt.longitude,
        pm25,
        aqi_in_naqi: env.aqi.value,
        quality: env.source.quality,
        provider: env.source.provider,
      };
    });

    const validSamples = samples.filter((s) => s.pm25 !== null && s.quality !== 'UNAVAILABLE');
    const durationHours = c.duration_seconds / 3600;
    const sources = Array.from(new Set(envs.map((e) => e.source.provider).filter((p) => p !== 'Unavailable')));

    // Require at least 2 valid spatial samples along the route to compute a comparative estimate
    const comparisonEligible = validSamples.length >= 2 && durationHours > 0;
    let meanPm25: number | null = null;
    let relativeExposure: number | null = null;
    const routeLimitations: string[] = [];

    if (comparisonEligible) {
      meanPm25 = Number(
        (validSamples.reduce((s, x) => s + (x.pm25 || 0), 0) / validSamples.length).toFixed(1)
      );
      // Relative commute exposure index = (meanPm25 * durationHours / 60) * 100 (normalized to 1h at CPCB 60 µg/m³)
      relativeExposure = Number((((meanPm25 * durationHours) / 60) * 100).toFixed(1));
      if (samples.length > validSamples.length) {
        routeLimitations.push('One or more corridor waypoints lacked valid observations.');
      }
      routeLimitations.push(
        'Micro-scale road traffic intensity and cabin filtration efficiency are not directly measured.'
      );
    } else {
      routeLimitations.push('Insufficient spatial pollution coverage along this corridor to estimate exposure.');
      globalLimitations.add('Insufficient spatial pollution coverage for one or more route alternatives.');
    }

    evaluatedRoutes.push({
      route_id: c.route_id || `route-${idx + 1}`,
      summary: c.summary || `Route Option ${idx + 1}`,
      route_labels: c.route_labels || [],
      duration_seconds: c.duration_seconds,
      duration_minutes: Math.round(c.duration_seconds / 60),
      distance_meters: c.distance_meters,
      distance_km: Number((c.distance_meters / 1000).toFixed(1)),
      encoded_polyline: c.encoded_polyline,
      relative_exposure_estimate: relativeExposure,
      mean_pm25: meanPm25,
      exposure_confidence: comparisonEligible ? 'MEDIUM' : 'LOW',
      comparison_eligible: comparisonEligible,
      samples,
      sources,
      limitations: routeLimitations,
    });
  }

  const eligibleCount = evaluatedRoutes.filter((r) => r.comparison_eligible).length;
  const comparisonStatus: RouteComparisonResponse['comparison_status'] =
    eligibleCount === 0
      ? 'UNAVAILABLE'
      : eligibleCount === evaluatedRoutes.length
      ? 'COMPARABLE'
      : 'PARTIAL';

  if (evaluatedRoutes.length < 2) {
    globalLimitations.add(
      'Only one route option returned; comparative pollution advantage cannot be established without an alternative.'
    );
  }

  return {
    comparison_id: comparisonId,
    comparison_status: comparisonStatus,
    travel_mode: params.travel_mode,
    origin: {
      name: params.origin.name || 'Origin',
      latitude: params.origin.latitude,
      longitude: params.origin.longitude,
    },
    destination: {
      name: params.destination.name || 'Destination',
      latitude: params.destination.latitude,
      longitude: params.destination.longitude,
    },
    routes: evaluatedRoutes,
    limitations: Array.from(globalLimitations),
  };
}
