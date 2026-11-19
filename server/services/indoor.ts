import type {
  ConfidenceLevel,
  IndoorRecommendationItem,
  IndoorRecommendResponse,
} from '../../src/types/breatheos.js';
import { getAirForecast, getCurrentAirConditions } from './environmental.js';

export interface IndoorRecommendInput {
  room_type: string;
  ventilation_type: 'NATURAL' | 'MECHANICAL_HVAC' | 'SEALED';
  has_air_purifier: boolean;
  indoor_sensor_available: boolean;
  measured_indoor_pm25?: number | null;
  outdoor_location: {
    name?: string;
    latitude: number;
    longitude: number;
  };
}

export async function generateIndoorRecommendations(
  input: IndoorRecommendInput
): Promise<IndoorRecommendResponse> {
  const [outdoor, forecast] = await Promise.all([
    getCurrentAirConditions(input.outdoor_location.latitude, input.outdoor_location.longitude),
    getAirForecast(input.outdoor_location.latitude, input.outdoor_location.longitude, 24),
  ]);

  const outdoorPm25 = outdoor.pollutants.find((p) => p.code === 'PM25')?.value ?? null;
  const outdoorAqi = outdoor.aqi.value;
  const windKmh = outdoor.weather.wind_speed_kmh;
  const hasMeasuredIndoor =
    input.indoor_sensor_available &&
    typeof input.measured_indoor_pm25 === 'number' &&
    Number.isFinite(input.measured_indoor_pm25);

  const recommendations: IndoorRecommendationItem[] = [];
  const assumptions: string[] = [];
  const actionsRequiringMeasurements: string[] = [];

  if (!hasMeasuredIndoor) {
    assumptions.push(
      'No live indoor PM2.5 / CO₂ sensor reading was provided; indoor air quality is unmeasured and cannot be equated to outdoor levels.'
    );
    actionsRequiringMeasurements.push(
      'Verify actual indoor PM2.5 reduction after running filtration or closing windows using a calibrated laser particle monitor.'
    );
    actionsRequiringMeasurements.push(
      'Monitor indoor CO₂ levels during extended sealed-room periods to determine safe brief ventilation intervals.'
    );
  } else {
    assumptions.push(
      `Evaluated using user-supplied indoor PM2.5 reading (${input.measured_indoor_pm25} µg/m³) alongside outdoor environmental context.`
    );
  }

  // Deterministic rules based on outdoor AQI, wind dispersion, room type, and ventilation
  if (outdoorPm25 === null || outdoorAqi === null) {
    recommendations.push({
      id: 'outdoor-unavailable',
      action: 'Hold window-opening decisions until outdoor air observations recover',
      priority: 'HIGH',
      reason: 'Outdoor PM2.5 / IN_NAQI data is currently unavailable; avoid assuming outdoor air is cleaner than indoor air.',
      requires_indoor_measurement: !hasMeasuredIndoor,
    });
  } else if (outdoorAqi >= 201) {
    // Poor, Very Poor, or Severe outdoor air
    if (input.ventilation_type === 'NATURAL') {
      recommendations.push({
        id: 'seal-windows',
        action: `Keep ${input.room_type.toLowerCase().replace('_', ' ')} windows and balcony doors closed during current ${outdoor.aqi.category} outdoor conditions (IN_NAQI ${outdoorAqi})`,
        priority: 'HIGH',
        reason: `Outdoor PM2.5 is ${outdoorPm25} µg/m³ (${outdoor.source.provider}), substantially above the 60 µg/m³ 24h CPCB standard.`,
        requires_indoor_measurement: false,
      });
    } else if (input.ventilation_type === 'MECHANICAL_HVAC') {
      recommendations.push({
        id: 'recirculate-hvac',
        action: 'Set mechanical HVAC to recirculation mode and inspect return-air filter seating',
        priority: 'HIGH',
        reason: `Fresh-air intake during IN_NAQI ${outdoorAqi} draws elevated fine particulate load indoors unless MERV-13+ filtration is confirmed.`,
        requires_indoor_measurement: !hasMeasuredIndoor,
      });
    }

    if (forecast.best_window) {
      recommendations.push({
        id: 'ventilation-window',
        action: `Schedule brief 10–15 minute cross-ventilation during the lowest forecast window (${forecast.best_window.start_ist} – ${forecast.best_window.end_ist})`,
        priority: 'MEDIUM',
        reason: `Forecasted outdoor PM2.5 dips to ~${forecast.best_window.avg_pm25} µg/m³ (IN_NAQI ~${forecast.best_window.avg_aqi}), helping flush indoor CO₂ with lower particulate ingress.`,
        requires_indoor_measurement: false,
      });
    }
  } else {
    // Moderate / Satisfactory / Good outdoor air
    recommendations.push({
      id: 'controlled-ventilation',
      action: `Allow controlled cross-ventilation for 20–30 minutes while outdoor IN_NAQI is ${outdoorAqi} (${outdoor.aqi.category})`,
      priority: 'MEDIUM',
      reason:
        windKmh && windKmh >= 8
          ? `Outdoor wind speed (${windKmh} km/h) supports active dispersion.`
          : 'Moderate outdoor load allows refreshing indoor air, especially if indoor cooking or occupancy has raised indoor particulates/CO₂.',
      requires_indoor_measurement: !hasMeasuredIndoor,
    });
  }

  if (input.has_air_purifier) {
    if (hasMeasuredIndoor && input.measured_indoor_pm25! > 35) {
      recommendations.push({
        id: 'purifier-boost',
        action: 'Operate HEPA purifier at medium-high fan speed until measured indoor PM2.5 drops below 35 µg/m³',
        priority: 'HIGH',
        reason: `Measured indoor PM2.5 (${input.measured_indoor_pm25} µg/m³) remains elevated.`,
        requires_indoor_measurement: false,
      });
    } else {
      recommendations.push({
        id: 'purifier-verify',
        action: 'Run portable HEPA purifier continuously with room doors closed; clean pre-filter weekly',
        priority: 'MEDIUM',
        reason: hasMeasuredIndoor
          ? `Measured indoor PM2.5 is ${input.measured_indoor_pm25} µg/m³; continuous low/auto mode maintains boundary.`
          : 'Purifier effectiveness cannot be quantified without an indoor PM2.5 sensor, so keeping doors closed minimizes infiltration load.',
        requires_indoor_measurement: !hasMeasuredIndoor,
      });
    }
  } else {
    recommendations.push({
      id: 'no-purifier-mitigation',
      action: 'Use wet-mopping instead of dry sweeping and run kitchen exhaust during cooking',
      priority: 'MEDIUM',
      reason: 'Without mechanical HEPA filtration, indoor resuspension and cooking aerosols are major unmeasured particulate sources.',
      requires_indoor_measurement: !hasMeasuredIndoor,
    });
  }

  const confidence: ConfidenceLevel = hasMeasuredIndoor
    ? outdoor.source.quality === 'UNAVAILABLE'
      ? 'MEDIUM'
      : 'HIGH'
    : outdoor.source.quality === 'UNAVAILABLE'
    ? 'LOW'
    : 'MEDIUM';

  return {
    room_type: input.room_type,
    ventilation_type: input.ventilation_type,
    has_air_purifier: input.has_air_purifier,
    indoor_sensor_available: input.indoor_sensor_available,
    indoor_measurement_status: hasMeasuredIndoor ? 'MEASURED' : 'UNMEASURED',
    measured_indoor_pm25: hasMeasuredIndoor ? input.measured_indoor_pm25! : null,
    outdoor_context: {
      location_name: input.outdoor_location.name || outdoor.location.name || 'Delhi NCR',
      aqi_in_naqi: outdoorAqi,
      pm25: outdoorPm25,
      wind_speed_kmh: windKmh,
      observed_at_ist: outdoor.source.observed_at_ist,
      quality: outdoor.source.quality,
      provider: outdoor.source.provider,
    },
    recommendations,
    confidence,
    assumptions,
    actions_requiring_measurements: actionsRequiringMeasurements,
  };
}
