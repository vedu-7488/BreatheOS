export type DataQuality = 'VALID' | 'MODELLED' | 'STALE' | 'UNAVAILABLE' | 'INSUFFICIENT';
export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';
export type EnvironmentType = 'OUTDOOR' | 'INDOOR' | 'TRANSIT';
export type ActivityType = 'COMMUTE' | 'WORK' | 'EXERCISE' | 'ERRAND' | 'HOME';
export type TravelMode = 'DRIVE' | 'TRANSIT' | 'WALK' | 'TWO_WHEELER';

export interface ApiMeta {
  request_id: string;
  generated_at: string;
}

export interface ApiEnvelope<T> {
  data: T;
  meta: ApiMeta;
}

export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    retryable: boolean;
  };
  meta: {
    request_id: string;
  };
}

export interface NCRLocation {
  id: string;
  name: string;
  zone: 'Delhi' | 'Noida';
  latitude: number;
  longitude: number;
  description: string;
}

export interface PollutantReading {
  code: 'PM25' | 'PM10' | 'NO2' | 'O3' | 'SO2' | 'CO';
  label: string;
  value: number | null;
  unit: string;
  sub_index: number | null;
  quality: DataQuality;
  source: string;
}

export interface WeatherContext {
  temperature_c: number | null;
  humidity_pct: number | null;
  wind_speed_kmh: number | null;
  wind_direction_deg: number | null;
  observed_at: string | null;
  provider: string;
}

export interface CurrentAirData {
  location: {
    id?: string;
    name?: string;
    latitude: number;
    longitude: number;
  };
  aqi: {
    value: number | null;
    index_system: 'IN_NAQI' | 'UAQI' | 'PROVIDER_DEFINED';
    category: string | null;
    dominant_pollutant: string | null;
  };
  secondary_aqi?: {
    value: number | null;
    index_system: string;
    category: string | null;
  } | null;
  pollutants: PollutantReading[];
  weather: WeatherContext;
  source: {
    provider: string;
    measurement_type: 'OBSERVATION' | 'MODELLED' | 'HYBRID' | 'UNAVAILABLE';
    observed_at: string | null;
    observed_at_ist: string | null;
    quality: DataQuality;
    notes: string;
  };
}

export interface ForecastPoint {
  timestamp: string;
  timestamp_ist: string;
  aqi_in_naqi: number | null;
  pm25: number | null;
  pm10: number | null;
  no2: number | null;
  o3: number | null;
  wind_speed_kmh: number | null;
  quality: DataQuality;
  provider: string;
}

export interface ForecastAirData {
  location: string;
  latitude: number;
  longitude: number;
  index_system: string;
  measurement_type: 'MODELLED_FORECAST';
  spatial_resolution: string;
  forecast: ForecastPoint[];
  best_window: {
    start_ist: string;
    end_ist: string;
    avg_pm25: number;
    avg_aqi: number;
  } | null;
  limitations: string[];
}

export interface MonitoringStation {
  station_id: string;
  name: string;
  distance_km: number;
  provider: string;
  available_pollutants: string[];
  latest_observed_at: string | null;
  latest_observed_at_ist: string | null;
  pm25: number | null;
  quality: DataQuality;
}

export interface SourceStatusItem {
  provider_id: string;
  name: string;
  role: string;
  status: 'OPERATIONAL' | 'DEGRADED' | 'UNAVAILABLE';
  measurement_type: 'STATION_OBSERVATION' | 'MODELLED_FORECAST' | 'ROUTING';
  last_success_at: string | null;
  freshness_label: string;
  notes: string;
}

export interface UserActivity {
  id: string;
  user_id: string;
  activity_type: ActivityType;
  title: string;
  start_time: string;
  end_time: string;
  location_id: string;
  location_name: string;
  latitude: number;
  longitude: number;
  environment: EnvironmentType;
  indoor_pm25_reading: number | null;
  indoor_purifier_on: boolean;
  notes: string | null;
}

export interface PollutantContribution {
  pollutant: string;
  concentration: number | null;
  unit: string;
  duration_hours: number;
  contribution: number | null;
  reference_baseline_24h: number;
  relative_index: number | null;
}

export interface ExposureSegmentResult {
  activity_id: string;
  title: string;
  activity_type: ActivityType;
  environment: EnvironmentType;
  start_time: string;
  end_time: string;
  start_ist: string;
  end_ist: string;
  duration_minutes: number;
  contributions: PollutantContribution[];
  relative_index: number | null;
  confidence: ConfidenceLevel;
  quality: DataQuality | 'ASSUMED';
  indoor_status: 'NOT_APPLICABLE' | 'MEASURED_SENSOR' | 'ASSUMED_INFILTRATION' | 'UNAVAILABLE';
  assumptions: string[];
  source_ids: string[];
}

export interface ExposureReportData {
  report_id: string;
  methodology_version: string;
  reference_baseline_version: string;
  status: 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE';
  period_start: string;
  period_end: string;
  total_tracked_minutes: number;
  calculable_minutes: number;
  mean_relative_index: number | null;
  segments: ExposureSegmentResult[];
  limitations: string[];
  generated_at: string;
}

export interface RouteSegmentSample {
  label: string;
  latitude: number;
  longitude: number;
  pm25: number | null;
  aqi_in_naqi: number | null;
  quality: DataQuality;
  provider: string;
}

export interface RouteOptionComparison {
  route_id: string;
  summary: string;
  route_labels: string[];
  duration_seconds: number;
  duration_minutes: number;
  distance_meters: number;
  distance_km: number;
  encoded_polyline?: string;
  relative_exposure_estimate: number | null;
  mean_pm25: number | null;
  exposure_confidence: ConfidenceLevel;
  comparison_eligible: boolean;
  samples: RouteSegmentSample[];
  sources: string[];
  limitations: string[];
}

export interface RouteComparisonResponse {
  comparison_id: string;
  comparison_status: 'COMPARABLE' | 'PARTIAL' | 'UNAVAILABLE';
  travel_mode: TravelMode;
  origin: { name: string; latitude: number; longitude: number };
  destination: { name: string; latitude: number; longitude: number };
  routes: RouteOptionComparison[];
  limitations: string[];
}

export interface IndoorRecommendationItem {
  id: string;
  action: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  reason: string;
  requires_indoor_measurement: boolean;
}

export interface IndoorRecommendResponse {
  room_type: string;
  ventilation_type: string;
  has_air_purifier: boolean;
  indoor_sensor_available: boolean;
  indoor_measurement_status: 'MEASURED' | 'UNMEASURED';
  measured_indoor_pm25: number | null;
  outdoor_context: {
    location_name: string;
    aqi_in_naqi: number | null;
    pm25: number | null;
    wind_speed_kmh: number | null;
    observed_at_ist: string | null;
    quality: DataQuality;
    provider: string;
  };
  recommendations: IndoorRecommendationItem[];
  confidence: ConfidenceLevel;
  assumptions: string[];
  actions_requiring_measurements: string[];
}

export interface AgentStepTrace {
  step: number;
  agent: string;
  tool: string;
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  summary: string;
}

export interface AssistantChatResponse {
  session_id: string;
  intent: string;
  answer: string;
  recommendations: Array<{
    title: string;
    action: string;
    time_window?: string;
    evidence: string;
  }>;
  sources: string[];
  limitations: string[];
  agent_trace: {
    model: string;
    agents_used: string[];
    steps: AgentStepTrace[];
    status: 'COMPLETE' | 'PARTIAL' | 'FALLBACK';
  };
}

export interface DailyPlanResponse {
  plan_id: string;
  plan_date: string;
  location_name: string;
  summary: string;
  recommended_actions: Array<{
    window_ist: string;
    activity: string;
    recommendation: string;
    alternative_action: string;
    supporting_evidence: string;
    confidence: ConfidenceLevel;
  }>;
  sources: string[];
  limitations: string[];
  agent_trace: {
    model: string;
    agents_used: string[];
    status: 'COMPLETE' | 'PARTIAL' | 'FALLBACK';
  };
}

export interface WeeklyInsightsData {
  period_days: number;
  completed_segments_count: number;
  comparable_days_count: number;
  coverage_percent: number;
  week_over_week_status: 'COMPARABLE' | 'INSUFFICIENT_DATA';
  week_over_week_delta_pct: number | null;
  daily_series: Array<{
    date: string;
    mean_relative_index: number | null;
    coverage_pct: number;
    segments_count: number;
    status: 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE';
  }>;
  recommendation_history: Array<{
    id: string;
    created_at_ist: string;
    intent: string;
    summary: string;
  }>;
  limitations: string[];
}

export interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  default_location_id: string;
  commute_mode: TravelMode;
  sensitivity_group: 'GENERAL' | 'ATHLETE' | 'RESPIRATORY_SENSITIVE';
  is_demo: boolean;
}
