import type {
  ApiEnvelope,
  ApiErrorEnvelope,
  AssistantChatResponse,
  CurrentAirData,
  DailyPlanResponse,
  ExposureReportData,
  ForecastAirData,
  IndoorRecommendResponse,
  MonitoringStation,
  NCRLocation,
  RouteComparisonResponse,
  SourceStatusItem,
  TravelMode,
  UserActivity,
  UserProfile,
  WeeklyInsightsData,
} from '../types/breatheos';

const TOKEN_KEY = 'breatheos_jwt';

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string | null) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

export class ApiClientError extends Error {
  code: string;
  retryable: boolean;
  status: number;

  constructor(message: string, code: string, retryable: boolean, status: number) {
    super(message);
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init.headers as Record<string, string>) || {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(path, { ...init, headers });
  const json = (await res.json()) as ApiEnvelope<T> | ApiErrorEnvelope;

  if (!res.ok || 'error' in json) {
    const errPayload = 'error' in json ? json.error : { code: 'HTTP_ERROR', message: res.statusText, retryable: false };
    throw new ApiClientError(errPayload.message, errPayload.code, errPayload.retryable, res.status);
  }

  return json.data;
}

export const api = {
  getMapsConfig: () => request<{ apiKey: string; configured: boolean }>('/api/v1/config/maps'),
  getLocations: () => request<NCRLocation[]>('/api/v1/locations'),

  demoLogin: async () => {
    const res = await request<{ token: string; profile: UserProfile }>('/api/v1/auth/demo', { method: 'POST' });
    setStoredToken(res.token);
    return res;
  },
  login: async (email: string, password: string) => {
    const res = await request<{ token: string; profile: UserProfile }>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setStoredToken(res.token);
    return res;
  },
  register: async (payload: { email: string; password: string; full_name: string; default_location_id: string }) => {
    const res = await request<{ token: string; profile: UserProfile }>('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setStoredToken(res.token);
    return res;
  },
  getMe: () => request<UserProfile>('/api/v1/auth/me'),
  updatePreferences: (payload: Partial<Pick<UserProfile, 'default_location_id' | 'commute_mode' | 'sensitivity_group'>>) =>
    request<UserProfile>('/api/v1/preferences', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  getCurrentAir: (lat: number, lng: number) =>
    request<CurrentAirData>(`/api/v1/air/current?latitude=${lat}&longitude=${lng}`),
  getAirForecast: (lat: number, lng: number, hours = 48) =>
    request<ForecastAirData>(`/api/v1/air/forecast?latitude=${lat}&longitude=${lng}&hours=${hours}`),
  getStations: (lat: number, lng: number, radiusKm = 25) =>
    request<{ stations: MonitoringStation[]; notice: string | null }>(
      `/api/v1/air/stations?latitude=${lat}&longitude=${lng}&radius_km=${radiusKm}`
    ),
  getSourcesStatus: () => request<SourceStatusItem[]>('/api/v1/sources/status'),

  getActivities: () => request<UserActivity[]>('/api/v1/activities'),
  createActivity: (payload: {
    activity_type: UserActivity['activity_type'];
    title: string;
    start_time: string;
    end_time: string;
    location: { id?: string; name?: string; latitude: number; longitude: number };
    environment: UserActivity['environment'];
    indoor_pm25_reading?: number | null;
    indoor_purifier_on?: boolean;
    notes?: string;
  }) =>
    request<UserActivity>('/api/v1/activities', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateActivity: (
    id: string,
    payload: Partial<{
      activity_type: UserActivity['activity_type'];
      title: string;
      start_time: string;
      end_time: string;
      location: { id?: string; name?: string; latitude: number; longitude: number };
      environment: UserActivity['environment'];
      indoor_pm25_reading: number | null;
      indoor_purifier_on: boolean;
      notes: string | null;
    }>
  ) =>
    request<UserActivity>(`/api/v1/activities/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteActivity: (id: string) =>
    request<{ deleted: boolean }>(`/api/v1/activities/${id}`, { method: 'DELETE' }),

  estimateExposure: (payload: {
    period_start: string;
    period_end: string;
    persist?: boolean;
    segments: Array<{
      activity_id: string;
      title?: string;
      activity_type: UserActivity['activity_type'];
      start_time?: string;
      end_time?: string;
      duration_minutes: number;
      latitude: number;
      longitude: number;
      environment: UserActivity['environment'];
      indoor_pm25_reading?: number | null;
      indoor_purifier_on?: boolean;
    }>;
  }) =>
    request<ExposureReportData>('/api/v1/exposure/estimate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  compareRoutes: (payload: {
    origin: { name?: string; latitude: number; longitude: number };
    destination: { name?: string; latitude: number; longitude: number };
    travel_mode: TravelMode;
    candidates: Array<{
      route_id?: string;
      summary: string;
      route_labels?: string[];
      duration_seconds: number;
      distance_meters: number;
      encoded_polyline?: string;
      sample_points?: Array<{ label: string; latitude: number; longitude: number }>;
    }>;
  }) =>
    request<RouteComparisonResponse>('/api/v1/routes/compare', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  recommendIndoor: (payload: {
    room_type: string;
    ventilation_type: 'NATURAL' | 'MECHANICAL_HVAC' | 'SEALED';
    has_air_purifier: boolean;
    indoor_sensor_available: boolean;
    measured_indoor_pm25?: number | null;
    outdoor_location: { name?: string; latitude: number; longitude: number };
  }) =>
    request<IndoorRecommendResponse>('/api/v1/indoor/recommend', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  chatAssistant: (payload: {
    message: string;
    session_id: string | null;
    context: { location_id: string; timezone: string };
  }) =>
    request<AssistantChatResponse>('/api/v1/assistant/chat', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  generatePlan: (payload: { plan_date: string; location_id: string }) =>
    request<DailyPlanResponse>('/api/v1/plan/generate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getWeeklyInsights: () => request<WeeklyInsightsData>('/api/v1/insights/weekly'),
};
