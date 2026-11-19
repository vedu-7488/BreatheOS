import { DELHI_NCR_LOCATIONS } from '../db.js';
import type {
  CurrentAirData,
  DataQuality,
  ForecastAirData,
  ForecastPoint,
  MonitoringStation,
  PollutantReading,
  SourceStatusItem,
} from '../../src/types/breatheos.js';

interface Breakpoint {
  cLow: number;
  cHigh: number;
  iLow: number;
  iHigh: number;
}

const IN_NAQI_BREAKPOINTS: Record<string, Breakpoint[]> = {
  PM25: [
    { cLow: 0, cHigh: 30, iLow: 0, iHigh: 50 },
    { cLow: 30, cHigh: 60, iLow: 51, iHigh: 100 },
    { cLow: 60, cHigh: 90, iLow: 101, iHigh: 200 },
    { cLow: 90, cHigh: 120, iLow: 201, iHigh: 300 },
    { cLow: 120, cHigh: 250, iLow: 301, iHigh: 400 },
    { cLow: 250, cHigh: 500, iLow: 401, iHigh: 500 },
  ],
  PM10: [
    { cLow: 0, cHigh: 50, iLow: 0, iHigh: 50 },
    { cLow: 50, cHigh: 100, iLow: 51, iHigh: 100 },
    { cLow: 100, cHigh: 250, iLow: 101, iHigh: 200 },
    { cLow: 250, cHigh: 350, iLow: 201, iHigh: 300 },
    { cLow: 350, cHigh: 430, iLow: 301, iHigh: 400 },
    { cLow: 430, cHigh: 600, iLow: 401, iHigh: 500 },
  ],
  NO2: [
    { cLow: 0, cHigh: 40, iLow: 0, iHigh: 50 },
    { cLow: 40, cHigh: 80, iLow: 51, iHigh: 100 },
    { cLow: 80, cHigh: 180, iLow: 101, iHigh: 200 },
    { cLow: 180, cHigh: 280, iLow: 201, iHigh: 300 },
    { cLow: 280, cHigh: 400, iLow: 301, iHigh: 400 },
    { cLow: 400, cHigh: 800, iLow: 401, iHigh: 500 },
  ],
  O3: [
    { cLow: 0, cHigh: 50, iLow: 0, iHigh: 50 },
    { cLow: 50, cHigh: 100, iLow: 51, iHigh: 100 },
    { cLow: 100, cHigh: 168, iLow: 101, iHigh: 200 },
    { cLow: 168, cHigh: 208, iLow: 201, iHigh: 300 },
    { cLow: 208, cHigh: 748, iLow: 301, iHigh: 400 },
    { cLow: 748, cHigh: 1000, iLow: 401, iHigh: 500 },
  ],
  SO2: [
    { cLow: 0, cHigh: 40, iLow: 0, iHigh: 50 },
    { cLow: 40, cHigh: 80, iLow: 51, iHigh: 100 },
    { cLow: 80, cHigh: 380, iLow: 101, iHigh: 200 },
    { cLow: 380, cHigh: 800, iLow: 201, iHigh: 300 },
    { cLow: 800, cHigh: 1600, iLow: 301, iHigh: 400 },
    { cLow: 1600, cHigh: 2400, iLow: 401, iHigh: 500 },
  ],
  CO: [
    { cLow: 0, cHigh: 1.0, iLow: 0, iHigh: 50 },
    { cLow: 1.0, cHigh: 2.0, iLow: 51, iHigh: 100 },
    { cLow: 2.0, cHigh: 10.0, iLow: 101, iHigh: 200 },
    { cLow: 10.0, cHigh: 17.0, iLow: 201, iHigh: 300 },
    { cLow: 17.0, cHigh: 34.0, iLow: 301, iHigh: 400 },
    { cLow: 34.0, cHigh: 60.0, iLow: 401, iHigh: 500 },
  ],
};

export function computeSubIndex(pollutant: string, value: number | null): number | null {
  if (value === null || !Number.isFinite(value) || value < 0) return null;
  const bps = IN_NAQI_BREAKPOINTS[pollutant];
  if (!bps) return null;
  for (const bp of bps) {
    if (value <= bp.cHigh) {
      const sub = ((bp.iHigh - bp.iLow) / (bp.cHigh - bp.cLow)) * (value - bp.cLow) + bp.iLow;
      return Math.round(sub);
    }
  }
  return 500;
}

export function getINNaqiCategory(aqi: number | null): string | null {
  if (aqi === null) return null;
  if (aqi <= 50) return 'Good';
  if (aqi <= 100) return 'Satisfactory';
  if (aqi <= 200) return 'Moderate';
  if (aqi <= 300) return 'Poor';
  if (aqi <= 400) return 'Very Poor';
  return 'Severe';
}

export function formatIST(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return (
    new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d) + ' IST'
  );
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function resolveLocationName(lat: number, lng: number): { id?: string; name: string } {
  let best = DELHI_NCR_LOCATIONS[0];
  let bestDist = Infinity;
  for (const loc of DELHI_NCR_LOCATIONS) {
    const d = haversineKm(lat, lng, loc.latitude, loc.longitude);
    if (d < bestDist) {
      bestDist = d;
      best = loc;
    }
  }
  if (bestDist <= 3.5) {
    return { id: best.id, name: best.name };
  }
  return { name: `NCR (${lat.toFixed(3)}, ${lng.toFixed(3)})` };
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const currentCache = new Map<string, CacheEntry<CurrentAirData>>();
const forecastCache = new Map<string, CacheEntry<ForecastAirData>>();
const stationsCache = new Map<string, CacheEntry<MonitoringStation[]>>();

const providerHealth: Record<
  string,
  { status: 'OPERATIONAL' | 'DEGRADED' | 'UNAVAILABLE'; lastSuccessAt: string | null; notes: string }
> = {
  open_meteo_aq: {
    status: 'OPERATIONAL',
    lastSuccessAt: null,
    notes: 'Copernicus CAMS / Open-Meteo 0.1° hourly air quality & weather model.',
  },
  google_air_quality: {
    status: process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY ? 'OPERATIONAL' : 'UNAVAILABLE',
    lastSuccessAt: null,
    notes: 'Google Maps Platform Air Quality API (Current Conditions & Forecast).',
  },
  openaq_v3: {
    status: process.env.OPENAQ_API_KEY ? 'OPERATIONAL' : 'UNAVAILABLE',
    lastSuccessAt: null,
    notes: process.env.OPENAQ_API_KEY
      ? 'OpenAQ v3 ground monitoring station feed (CPCB / DPCC / UPPCB).'
      : 'OpenAQ v3 API key not configured; physical ground station feed unavailable.',
  },
};

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 5500): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

export async function getCurrentAirConditions(
  latitude: number,
  longitude: number
): Promise<CurrentAirData> {
  const cacheKey = `${latitude.toFixed(3)},${longitude.toFixed(3)}`;
  const cached = currentCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const resolved = resolveLocationName(latitude, longitude);
  const mapsKey = process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY;

  // Fetch Open-Meteo AQ + Weather concurrently (plus Google Air Quality API if key is set)
  const openMeteoAqUrl =
    `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${latitude}&longitude=${longitude}` +
    `&current=pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone,european_aqi,us_aqi&timezone=UTC`;
  const openMeteoWeatherUrl =
    `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
    `&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m&timezone=UTC`;

  const [aqRes, wxRes, gmpAqRes] = await Promise.allSettled([
    fetchWithTimeout(openMeteoAqUrl),
    fetchWithTimeout(openMeteoWeatherUrl),
    mapsKey
      ? fetchWithTimeout(`https://airquality.googleapis.com/v1/currentConditions:lookup?key=${mapsKey}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Maps-Solution-ID': 'gmp_mcp_codeassist_v1_aistudio',
          },
          body: JSON.stringify({
            universalAqi: true,
            location: { latitude, longitude },
            extraComputations: ['LOCAL_AQI', 'POLLUTANT_CONCENTRATION'],
            languageCode: 'en',
          }),
        })
      : Promise.resolve(null),
  ]);

  let pm25: number | null = null;
  let pm10: number | null = null;
  let no2: number | null = null;
  let o3: number | null = null;
  let so2: number | null = null;
  let coMgM3: number | null = null;
  let observedAt: string | null = null;
  let providerNames: string[] = [];
  let measurementType: 'OBSERVATION' | 'MODELLED' | 'HYBRID' | 'UNAVAILABLE' = 'UNAVAILABLE';
  let quality: DataQuality = 'UNAVAILABLE';
  let secondaryAqi: CurrentAirData['secondary_aqi'] = null;
  let notesParts: string[] = [];

  if (aqRes.status === 'fulfilled' && aqRes.value.ok) {
    const json = (await aqRes.value.json()) as {
      current?: {
        time?: string;
        pm2_5?: number | null;
        pm10?: number | null;
        nitrogen_dioxide?: number | null;
        ozone?: number | null;
        sulphur_dioxide?: number | null;
        carbon_monoxide?: number | null;
        us_aqi?: number | null;
      };
    };
    const cur = json.current;
    if (cur) {
      pm25 = typeof cur.pm2_5 === 'number' ? cur.pm2_5 : null;
      pm10 = typeof cur.pm10 === 'number' ? cur.pm10 : null;
      no2 = typeof cur.nitrogen_dioxide === 'number' ? cur.nitrogen_dioxide : null;
      o3 = typeof cur.ozone === 'number' ? cur.ozone : null;
      so2 = typeof cur.sulphur_dioxide === 'number' ? cur.sulphur_dioxide : null;
      // Open-Meteo CO is in µg/m³ -> convert to mg/m³ for IN_NAQI
      coMgM3 = typeof cur.carbon_monoxide === 'number' ? Number((cur.carbon_monoxide / 1000).toFixed(2)) : null;
      observedAt = cur.time ? `${cur.time}:00Z`.replace(':00:00Z', ':00Z') : new Date().toISOString();
      if (!observedAt.endsWith('Z')) observedAt = `${observedAt}Z`;
      providerNames.push('Open-Meteo CAMS');
      measurementType = 'MODELLED';
      quality = 'MODELLED';
      providerHealth.open_meteo_aq.status = 'OPERATIONAL';
      providerHealth.open_meteo_aq.lastSuccessAt = new Date().toISOString();
      notesParts.push('Modelled regional concentration grid (0.1° resolution), not a physical CPCB monitor.');
      if (typeof cur.us_aqi === 'number') {
        secondaryAqi = { value: Math.round(cur.us_aqi), index_system: 'US_EPA', category: null };
      }
    }
  } else {
    providerHealth.open_meteo_aq.status = 'DEGRADED';
  }

  // Enrich / cross-check with Google Maps Air Quality API if available
  if (gmpAqRes.status === 'fulfilled' && gmpAqRes.value && gmpAqRes.value.ok) {
    const gJson = (await gmpAqRes.value.json()) as {
      dateTime?: string;
      indexes?: Array<{ code: string; displayName: string; aqi?: number; category?: string }>;
      pollutants?: Array<{ code: string; concentration?: { value?: number } }>;
    };
    providerHealth.google_air_quality.status = 'OPERATIONAL';
    providerHealth.google_air_quality.lastSuccessAt = new Date().toISOString();
    providerNames.push('Google Air Quality API');
    if (gJson.dateTime) observedAt = gJson.dateTime;
    const localInd = gJson.indexes?.find((i) => i.code === 'ind_cpcb');
    const uaqi = gJson.indexes?.find((i) => i.code === 'uaqi');
    if (uaqi && typeof uaqi.aqi === 'number') {
      secondaryAqi = {
        value: uaqi.aqi,
        index_system: 'UAQI',
        category: uaqi.category || null,
      };
    }
    if (gJson.pollutants) {
      const findP = (code: string) => gJson.pollutants?.find((p) => p.code === code)?.concentration?.value;
      if (pm25 === null && typeof findP('pm25') === 'number') pm25 = findP('pm25')!;
      if (pm10 === null && typeof findP('pm10') === 'number') pm10 = findP('pm10')!;
      if (no2 === null && typeof findP('no2') === 'number') no2 = findP('no2')!;
      if (o3 === null && typeof findP('o3') === 'number') o3 = findP('o3')!;
    }
    if (localInd && typeof localInd.aqi === 'number') {
      notesParts.push('Google Air Quality IND_CPCB local index available.');
    }
    if (measurementType === 'UNAVAILABLE') {
      measurementType = 'MODELLED';
      quality = 'MODELLED';
    } else {
      measurementType = 'HYBRID';
    }
  } else if (mapsKey && gmpAqRes.status === 'fulfilled' && gmpAqRes.value) {
    providerHealth.google_air_quality.status = 'DEGRADED';
    providerHealth.google_air_quality.notes = `Google Air Quality API returned HTTP ${gmpAqRes.value.status}.`;
  }

  let weather: CurrentAirData['weather'] = {
    temperature_c: null,
    humidity_pct: null,
    wind_speed_kmh: null,
    wind_direction_deg: null,
    observed_at: null,
    provider: 'Open-Meteo Weather',
  };

  if (wxRes.status === 'fulfilled' && wxRes.value.ok) {
    const wxJson = (await wxRes.value.json()) as {
      current?: {
        time?: string;
        temperature_2m?: number;
        relative_humidity_2m?: number;
        wind_speed_10m?: number;
        wind_direction_10m?: number;
      };
    };
    if (wxJson.current) {
      weather = {
        temperature_c: wxJson.current.temperature_2m ?? null,
        humidity_pct: wxJson.current.relative_humidity_2m ?? null,
        wind_speed_kmh: wxJson.current.wind_speed_10m ?? null,
        wind_direction_deg: wxJson.current.wind_direction_10m ?? null,
        observed_at: wxJson.current.time ? `${wxJson.current.time}Z` : null,
        provider: 'Open-Meteo Weather',
      };
    }
  }

  // Staleness check (> 3 hours old)
  if (observedAt) {
    const ageHours = (Date.now() - new Date(observedAt).getTime()) / 3600000;
    if (ageHours > 3 && quality !== 'UNAVAILABLE') {
      quality = 'STALE';
      notesParts.push(`Data is ${ageHours.toFixed(1)}h old (marked STALE).`);
    }
  }

  const primarySourceName = providerNames.length > 0 ? providerNames.join(' + ') : 'Unavailable';

  const pollutants: PollutantReading[] = [
    {
      code: 'PM25',
      label: 'PM2.5',
      value: pm25 !== null ? Number(pm25.toFixed(1)) : null,
      unit: 'µg/m³',
      sub_index: computeSubIndex('PM25', pm25),
      quality: pm25 !== null ? quality : 'UNAVAILABLE',
      source: primarySourceName,
    },
    {
      code: 'PM10',
      label: 'PM10',
      value: pm10 !== null ? Number(pm10.toFixed(1)) : null,
      unit: 'µg/m³',
      sub_index: computeSubIndex('PM10', pm10),
      quality: pm10 !== null ? quality : 'UNAVAILABLE',
      source: primarySourceName,
    },
    {
      code: 'NO2',
      label: 'NO₂',
      value: no2 !== null ? Number(no2.toFixed(1)) : null,
      unit: 'µg/m³',
      sub_index: computeSubIndex('NO2', no2),
      quality: no2 !== null ? quality : 'UNAVAILABLE',
      source: primarySourceName,
    },
    {
      code: 'O3',
      label: 'O₃',
      value: o3 !== null ? Number(o3.toFixed(1)) : null,
      unit: 'µg/m³',
      sub_index: computeSubIndex('O3', o3),
      quality: o3 !== null ? quality : 'UNAVAILABLE',
      source: primarySourceName,
    },
    {
      code: 'SO2',
      label: 'SO₂',
      value: so2 !== null ? Number(so2.toFixed(1)) : null,
      unit: 'µg/m³',
      sub_index: computeSubIndex('SO2', so2),
      quality: so2 !== null ? quality : 'UNAVAILABLE',
      source: primarySourceName,
    },
    {
      code: 'CO',
      label: 'CO',
      value: coMgM3,
      unit: 'mg/m³',
      sub_index: computeSubIndex('CO', coMgM3),
      quality: coMgM3 !== null ? quality : 'UNAVAILABLE',
      source: primarySourceName,
    },
  ];

  // Official IN_NAQI = max sub-index among available pollutants (requires at least PM2.5 or PM10 + 1 more ideally, we still compute transparently)
  const validSubs = pollutants.filter((p) => p.sub_index !== null) as Array<PollutantReading & { sub_index: number }>;
  let aqiValue: number | null = null;
  let dominant: string | null = null;
  if (validSubs.length > 0) {
    const maxP = validSubs.reduce((acc, cur) => (cur.sub_index > acc.sub_index ? cur : acc), validSubs[0]);
    aqiValue = maxP.sub_index;
    dominant = maxP.label;
  }

  const result: CurrentAirData = {
    location: {
      id: resolved.id,
      name: resolved.name,
      latitude,
      longitude,
    },
    aqi: {
      value: aqiValue,
      index_system: 'IN_NAQI',
      category: getINNaqiCategory(aqiValue),
      dominant_pollutant: dominant,
    },
    secondary_aqi: secondaryAqi,
    pollutants,
    weather,
    source: {
      provider: primarySourceName,
      measurement_type: measurementType,
      observed_at: observedAt,
      observed_at_ist: formatIST(observedAt),
      quality,
      notes:
        notesParts.join(' ') ||
        'Environmental providers temporarily unreachable. Missing values remain unavailable.',
    },
  };

  currentCache.set(cacheKey, { value: result, expiresAt: Date.now() + 5 * 60 * 1000 });
  return result;
}

export async function getAirForecast(
  latitude: number,
  longitude: number,
  hours = 48
): Promise<ForecastAirData> {
  const clampedHours = Math.min(Math.max(hours, 6), 96);
  const cacheKey = `${latitude.toFixed(3)},${longitude.toFixed(3)},${clampedHours}`;
  const cached = forecastCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const resolved = resolveLocationName(latitude, longitude);
  const forecastDays = Math.ceil(clampedHours / 24) + 1;
  const aqUrl =
    `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${latitude}&longitude=${longitude}` +
    `&hourly=pm10,pm2_5,nitrogen_dioxide,ozone&forecast_days=${Math.min(forecastDays, 4)}&timezone=UTC`;
  const wxUrl =
    `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
    `&hourly=wind_speed_10m&forecast_days=${Math.min(forecastDays, 4)}&timezone=UTC`;

  const [aqRes, wxRes] = await Promise.allSettled([fetchWithTimeout(aqUrl), fetchWithTimeout(wxUrl)]);

  const forecast: ForecastPoint[] = [];
  const limitations: string[] = [
    'Hourly forecast is derived from Open-Meteo CAMS atmospheric dispersion modelling (0.1° grid), not physical station sensors.',
  ];

  if (aqRes.status === 'fulfilled' && aqRes.value.ok) {
    const aqData = (await aqRes.value.json()) as {
      hourly?: {
        time: string[];
        pm2_5: Array<number | null>;
        pm10: Array<number | null>;
        nitrogen_dioxide: Array<number | null>;
        ozone: Array<number | null>;
      };
    };
    let windArr: Array<number | null> = [];
    if (wxRes.status === 'fulfilled' && wxRes.value.ok) {
      const wxData = (await wxRes.value.json()) as { hourly?: { wind_speed_10m?: Array<number | null> } };
      windArr = wxData.hourly?.wind_speed_10m || [];
    }

    const nowMs = Date.now() - 3600000;
    const times = aqData.hourly?.time || [];
    for (let i = 0; i < times.length && forecast.length < clampedHours; i++) {
      const iso = `${times[i]}:00Z`.replace(':00:00Z', ':00Z');
      const finalIso = iso.endsWith('Z') ? iso : `${iso}Z`;
      if (new Date(finalIso).getTime() < nowMs) continue;

      const pm25 = aqData.hourly?.pm2_5?.[i] ?? null;
      const pm10 = aqData.hourly?.pm10?.[i] ?? null;
      const no2 = aqData.hourly?.nitrogen_dioxide?.[i] ?? null;
      const o3 = aqData.hourly?.ozone?.[i] ?? null;

      const subs = [
        computeSubIndex('PM25', pm25),
        computeSubIndex('PM10', pm10),
        computeSubIndex('NO2', no2),
        computeSubIndex('O3', o3),
      ].filter((x): x is number => x !== null);
      const aqi = subs.length > 0 ? Math.max(...subs) : null;

      forecast.push({
        timestamp: finalIso,
        timestamp_ist: formatIST(finalIso) || finalIso,
        aqi_in_naqi: aqi,
        pm25: pm25 !== null ? Number(pm25.toFixed(1)) : null,
        pm10: pm10 !== null ? Number(pm10.toFixed(1)) : null,
        no2: no2 !== null ? Number(no2.toFixed(1)) : null,
        o3: o3 !== null ? Number(o3.toFixed(1)) : null,
        wind_speed_kmh: windArr[i] ?? null,
        quality: aqi !== null ? 'MODELLED' : 'UNAVAILABLE',
        provider: 'Open-Meteo CAMS',
      });
    }
  } else {
    limitations.push('Open-Meteo hourly forecast feed is temporarily unavailable.');
  }

  // Find cleanest 3-hour window in the next 24 hours (only from valid forecast points)
  let bestWindow: ForecastAirData['best_window'] = null;
  const next24 = forecast.slice(0, 24).filter((p) => p.pm25 !== null && p.aqi_in_naqi !== null);
  if (next24.length >= 3) {
    let minAvgPm = Infinity;
    for (let i = 0; i <= next24.length - 3; i++) {
      const slice = next24.slice(i, i + 3);
      const avgPm = slice.reduce((s, p) => s + (p.pm25 || 0), 0) / 3;
      const avgAqi = slice.reduce((s, p) => s + (p.aqi_in_naqi || 0), 0) / 3;
      if (avgPm < minAvgPm) {
        minAvgPm = avgPm;
        bestWindow = {
          start_ist: slice[0].timestamp_ist,
          end_ist: slice[2].timestamp_ist,
          avg_pm25: Number(avgPm.toFixed(1)),
          avg_aqi: Math.round(avgAqi),
        };
      }
    }
  }

  const result: ForecastAirData = {
    location: resolved.name,
    latitude,
    longitude,
    index_system: 'IN_NAQI (computed from Open-Meteo CAMS concentrations)',
    measurement_type: 'MODELLED_FORECAST',
    spatial_resolution: '~11 km (0.1° atmospheric grid)',
    forecast,
    best_window: bestWindow,
    limitations,
  };

  forecastCache.set(cacheKey, { value: result, expiresAt: Date.now() + 10 * 60 * 1000 });
  return result;
}

export async function getNearbyStations(
  latitude: number,
  longitude: number,
  radiusKm = 25
): Promise<{ stations: MonitoringStation[]; notice: string | null }> {
  const openAqKey = process.env.OPENAQ_API_KEY;
  if (!openAqKey) {
    return {
      stations: [],
      notice:
        'OpenAQ v3 / CPCB live station feed requires an OPENAQ_API_KEY. Station readings are marked unavailable rather than simulated.',
    };
  }

  const cacheKey = `${latitude.toFixed(2)},${longitude.toFixed(2)},${radiusKm}`;
  const cached = stationsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { stations: cached.value, notice: null };
  }

  try {
    const radiusMeters = Math.min(Math.max(Math.round(radiusKm * 1000), 1000), 25000);
    const url = `https://api.openaq.org/v3/locations?coordinates=${latitude},${longitude}&radius=${radiusMeters}&limit=12`;
    const res = await fetchWithTimeout(url, {
      headers: { 'X-API-Key': openAqKey, Accept: 'application/json' },
    });
    if (!res.ok) {
      providerHealth.openaq_v3.status = 'UNAVAILABLE';
      providerHealth.openaq_v3.notes = `OpenAQ v3 returned HTTP ${res.status}.`;
      return {
        stations: [],
        notice: `OpenAQ v3 station query returned HTTP ${res.status}. Physical station data temporarily unavailable.`,
      };
    }

    const payload = (await res.json()) as {
      results?: Array<{
        id: number;
        name?: string;
        coordinates?: { latitude: number; longitude: number };
        provider?: { name?: string };
        sensors?: Array<{ parameter?: { name?: string } }>;
        datetimeLast?: { utc?: string };
      }>;
    };

    providerHealth.openaq_v3.status = 'OPERATIONAL';
    providerHealth.openaq_v3.lastSuccessAt = new Date().toISOString();

    const stations: MonitoringStation[] = (payload.results || []).map((st) => {
      const dist = st.coordinates
        ? Number(haversineKm(latitude, longitude, st.coordinates.latitude, st.coordinates.longitude).toFixed(1))
        : 0;
      const latestUtc = st.datetimeLast?.utc || null;
      const ageHours = latestUtc ? (Date.now() - new Date(latestUtc).getTime()) / 3600000 : Infinity;
      let q: DataQuality = 'VALID';
      if (!latestUtc) q = 'UNAVAILABLE';
      else if (ageHours > 6) q = 'STALE';

      return {
        station_id: String(st.id),
        name: st.name || `Station ${st.id}`,
        distance_km: dist,
        provider: st.provider?.name || 'OpenAQ v3',
        available_pollutants: Array.from(
          new Set((st.sensors || []).map((s) => s.parameter?.name?.toUpperCase()).filter(Boolean) as string[])
        ),
        latest_observed_at: latestUtc,
        latest_observed_at_ist: formatIST(latestUtc),
        pm25: null,
        quality: q,
      };
    });

    stationsCache.set(cacheKey, { value: stations, expiresAt: Date.now() + 10 * 60 * 1000 });
    return { stations, notice: null };
  } catch {
    providerHealth.openaq_v3.status = 'UNAVAILABLE';
    return {
      stations: [],
      notice: 'Failed to reach OpenAQ v3 ground monitoring endpoint.',
    };
  }
}

export function getSourcesStatus(): SourceStatusItem[] {
  return [
    {
      provider_id: 'open_meteo_aq',
      name: 'Open-Meteo CAMS + Weather',
      role: 'Hourly Air Quality Model & Meteorological Dispersion',
      status: providerHealth.open_meteo_aq.status,
      measurement_type: 'MODELLED_FORECAST',
      last_success_at: providerHealth.open_meteo_aq.lastSuccessAt,
      freshness_label: providerHealth.open_meteo_aq.lastSuccessAt
        ? formatIST(providerHealth.open_meteo_aq.lastSuccessAt) || 'Active'
        : 'Pending first query',
      notes: providerHealth.open_meteo_aq.notes,
    },
    {
      provider_id: 'google_air_quality',
      name: 'Google Maps Air Quality API',
      role: 'Localized AQI Cross-Check & Pollutant Context',
      status: providerHealth.google_air_quality.status,
      measurement_type: 'MODELLED_FORECAST',
      last_success_at: providerHealth.google_air_quality.lastSuccessAt,
      freshness_label: providerHealth.google_air_quality.lastSuccessAt
        ? formatIST(providerHealth.google_air_quality.lastSuccessAt) || 'Active'
        : providerHealth.google_air_quality.status === 'UNAVAILABLE'
        ? 'Not configured'
        : 'Pending query',
      notes: providerHealth.google_air_quality.notes,
    },
    {
      provider_id: 'openaq_v3',
      name: 'OpenAQ v3 (CPCB / DPCC / UPPCB)',
      role: 'Physical Ground Monitoring Stations',
      status: providerHealth.openaq_v3.status,
      measurement_type: 'STATION_OBSERVATION',
      last_success_at: providerHealth.openaq_v3.lastSuccessAt,
      freshness_label: providerHealth.openaq_v3.lastSuccessAt
        ? formatIST(providerHealth.openaq_v3.lastSuccessAt) || 'Active'
        : 'Unavailable',
      notes: providerHealth.openaq_v3.notes,
    },
    {
      provider_id: 'google_routes',
      name: 'Google Maps Routes API',
      role: 'Delhi NCR Commute Geometry & Traffic-Aware Duration',
      status: process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY ? 'OPERATIONAL' : 'UNAVAILABLE',
      measurement_type: 'ROUTING',
      last_success_at: null,
      freshness_label: 'On-demand',
      notes: 'Used via @vis.gl/react-google-maps Routes SDK and server spatial assessment.',
    },
  ];
}
