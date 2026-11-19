import 'dotenv/config';
import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { db, DELHI_NCR_LOCATIONS, initDatabase } from './server/db.js';
import {
  hashPassword,
  requireAuth,
  signToken,
  verifyPassword,
  type AuthenticatedRequest,
} from './server/auth.js';
import {
  formatIST,
  getAirForecast,
  getCurrentAirConditions,
  getNearbyStations,
  getSourcesStatus,
} from './server/services/environmental.js';
import { calculateExposureReport, type ExposureSegmentInput } from './server/services/airtwin.js';
import { generateIndoorRecommendations } from './server/services/indoor.js';
import { compareRoutesWithPollution } from './server/services/routes.js';
import { generateDailyActionPlan, runSupervisorChat } from './server/services/agents.js';
import type { ActivityType, EnvironmentType, TravelMode, UserProfile } from './src/types/breatheos.js';

initDatabase();

const app = express();
app.use(express.json({ limit: '1mb' }));

// Attach request_id to every API request
app.use((req: AuthenticatedRequest, _res, next) => {
  req.requestId = crypto.randomUUID();
  next();
});

function ok<T>(res: express.Response, req: AuthenticatedRequest, data: T, status = 200) {
  res.status(status).json({
    data,
    meta: {
      request_id: req.requestId || crypto.randomUUID(),
      generated_at: new Date().toISOString(),
    },
  });
}

function fail(
  res: express.Response,
  req: AuthenticatedRequest,
  status: number,
  code: string,
  message: string,
  retryable = false
) {
  res.status(status).json({
    error: { code, message, retryable },
    meta: { request_id: req.requestId || crypto.randomUUID() },
  });
}

function getProfileWithPrefs(userId: string): UserProfile | null {
  const row = db
    .prepare(
      `SELECT p.id, p.email, p.full_name, p.is_demo,
              COALESCE(u.default_location_id, 'noida-sector-62') as default_location_id,
              COALESCE(u.commute_mode, 'DRIVE') as commute_mode,
              COALESCE(u.sensitivity_group, 'GENERAL') as sensitivity_group
       FROM profiles p
       LEFT JOIN user_preferences u ON p.id = u.user_id
       WHERE p.id = ?`
    )
    .get(userId) as Record<string, unknown> | undefined;

  if (!row) return null;
  return {
    id: String(row.id),
    email: String(row.email),
    full_name: String(row.full_name),
    is_demo: Boolean(row.is_demo),
    default_location_id: String(row.default_location_id),
    commute_mode: row.commute_mode as TravelMode,
    sensitivity_group: row.sensitivity_group as UserProfile['sensitivity_group'],
  };
}

// --- Public Config & Locations ---
app.get('/api/v1/config/maps', (req: AuthenticatedRequest, res) => {
  const apiKey = process.env.VITE_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '';
  ok(res, req, { apiKey, configured: Boolean(apiKey) });
});

app.get('/api/v1/locations', (req: AuthenticatedRequest, res) => {
  ok(res, req, DELHI_NCR_LOCATIONS);
});

// --- Auth Endpoints ---
app.post('/api/v1/auth/demo', (req: AuthenticatedRequest, res) => {
  const row = db
    .prepare('SELECT id, email, full_name, is_demo FROM profiles WHERE email = ?')
    .get('ananya.verma@breatheos.in') as { id: string; email: string; full_name: string; is_demo: number } | undefined;

  if (!row) {
    fail(res, req, 500, 'DEMO_PROFILE_MISSING', 'Demo profile unavailable.', true);
    return;
  }
  const token = signToken({
    id: row.id,
    email: row.email,
    full_name: row.full_name,
    is_demo: true,
  });
  ok(res, req, { token, profile: getProfileWithPrefs(row.id) });
});

app.post('/api/v1/auth/register', (req: AuthenticatedRequest, res) => {
  const { email, password, full_name, default_location_id } = req.body || {};
  if (!email || !password || !full_name) {
    fail(res, req, 400, 'VALIDATION_ERROR', 'Email, password, and full_name are required.');
    return;
  }
  const normalizedEmail = String(email).trim().toLowerCase();
  const existing = db.prepare('SELECT id FROM profiles WHERE email = ?').get(normalizedEmail);
  if (existing) {
    fail(res, req, 409, 'EMAIL_EXISTS', 'An account with this email already exists.');
    return;
  }

  const userId = crypto.randomUUID();
  const now = new Date().toISOString();
  const passwordHash = hashPassword(String(password));
  const locId = DELHI_NCR_LOCATIONS.some((l) => l.id === default_location_id)
    ? String(default_location_id)
    : 'noida-sector-62';

  db.prepare(
    `INSERT INTO profiles (id, email, password_hash, full_name, is_demo, created_at)
     VALUES (?, ?, ?, ?, 0, ?)`
  ).run(userId, normalizedEmail, passwordHash, String(full_name).trim(), now);

  db.prepare(
    `INSERT INTO user_preferences (user_id, default_location_id, commute_mode, sensitivity_group, updated_at)
     VALUES (?, ?, 'DRIVE', 'GENERAL', ?)`
  ).run(userId, locId, now);

  const token = signToken({
    id: userId,
    email: normalizedEmail,
    full_name: String(full_name).trim(),
    is_demo: false,
  });
  ok(res, req, { token, profile: getProfileWithPrefs(userId) }, 201);
});

app.post('/api/v1/auth/login', (req: AuthenticatedRequest, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    fail(res, req, 400, 'VALIDATION_ERROR', 'Email and password are required.');
    return;
  }
  const normalizedEmail = String(email).trim().toLowerCase();
  const row = db
    .prepare('SELECT id, email, password_hash, full_name, is_demo FROM profiles WHERE email = ?')
    .get(normalizedEmail) as
    | { id: string; email: string; password_hash: string; full_name: string; is_demo: number }
    | undefined;

  if (!row || !verifyPassword(String(password), row.password_hash)) {
    fail(res, req, 401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
    return;
  }

  const token = signToken({
    id: row.id,
    email: row.email,
    full_name: row.full_name,
    is_demo: Boolean(row.is_demo),
  });
  ok(res, req, { token, profile: getProfileWithPrefs(row.id) });
});

app.get('/api/v1/auth/me', requireAuth, (req: AuthenticatedRequest, res) => {
  const profile = getProfileWithPrefs(req.user!.id);
  if (!profile) {
    fail(res, req, 404, 'PROFILE_NOT_FOUND', 'User profile not found.');
    return;
  }
  ok(res, req, profile);
});

app.patch('/api/v1/preferences', requireAuth, (req: AuthenticatedRequest, res) => {
  const { default_location_id, commute_mode, sensitivity_group } = req.body || {};
  const current = getProfileWithPrefs(req.user!.id);
  if (!current) {
    fail(res, req, 404, 'PROFILE_NOT_FOUND', 'User profile not found.');
    return;
  }
  const nextLoc = DELHI_NCR_LOCATIONS.some((l) => l.id === default_location_id)
    ? String(default_location_id)
    : current.default_location_id;
  const nextMode = ['DRIVE', 'TRANSIT', 'WALK', 'TWO_WHEELER'].includes(commute_mode)
    ? commute_mode
    : current.commute_mode;
  const nextGroup = ['GENERAL', 'ATHLETE', 'RESPIRATORY_SENSITIVE'].includes(sensitivity_group)
    ? sensitivity_group
    : current.sensitivity_group;

  db.prepare(
    `INSERT INTO user_preferences (user_id, default_location_id, commute_mode, sensitivity_group, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       default_location_id = excluded.default_location_id,
       commute_mode = excluded.commute_mode,
       sensitivity_group = excluded.sensitivity_group,
       updated_at = excluded.updated_at`
  ).run(req.user!.id, nextLoc, nextMode, nextGroup, new Date().toISOString());

  ok(res, req, getProfileWithPrefs(req.user!.id));
});

// --- Environmental Endpoints ---
app.get('/api/v1/air/current', async (req: AuthenticatedRequest, res) => {
  const lat = Number(req.query.latitude);
  const lng = Number(req.query.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    fail(res, req, 400, 'INVALID_COORDINATES', 'Valid numeric latitude and longitude are required.');
    return;
  }
  try {
    const data = await getCurrentAirConditions(lat, lng);
    ok(res, req, data);
  } catch {
    fail(res, req, 503, 'DATA_PROVIDER_UNAVAILABLE', 'Environmental data is temporarily unavailable.', true);
  }
});

app.get('/api/v1/air/forecast', async (req: AuthenticatedRequest, res) => {
  const lat = Number(req.query.latitude);
  const lng = Number(req.query.longitude);
  const hours = req.query.hours ? Number(req.query.hours) : 48;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    fail(res, req, 400, 'INVALID_COORDINATES', 'Valid numeric latitude and longitude are required.');
    return;
  }
  try {
    const data = await getAirForecast(lat, lng, hours);
    ok(res, req, data);
  } catch {
    fail(res, req, 503, 'DATA_PROVIDER_UNAVAILABLE', 'Forecast data is temporarily unavailable.', true);
  }
});

app.get('/api/v1/air/stations', async (req: AuthenticatedRequest, res) => {
  const lat = Number(req.query.latitude);
  const lng = Number(req.query.longitude);
  const radiusKm = req.query.radius_km ? Number(req.query.radius_km) : 25;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    fail(res, req, 400, 'INVALID_COORDINATES', 'Valid numeric latitude and longitude are required.');
    return;
  }
  const data = await getNearbyStations(lat, lng, radiusKm);
  ok(res, req, data);
});

app.get('/api/v1/sources/status', (req: AuthenticatedRequest, res) => {
  ok(res, req, getSourcesStatus());
});

// --- User Activities CRUD (Strictly Authenticated & Isolated by req.user.id) ---
app.get('/api/v1/activities', requireAuth, (req: AuthenticatedRequest, res) => {
  const rows = db
    .prepare(
      `SELECT id, user_id, activity_type, title, start_time, end_time, location_id, location_name,
              latitude, longitude, environment, indoor_pm25_reading, indoor_purifier_on, notes
       FROM user_activities WHERE user_id = ? ORDER BY start_time ASC`
    )
    .all(req.user!.id) as Array<Record<string, unknown>>;

  const items = rows.map((r) => ({
    id: String(r.id),
    user_id: String(r.user_id),
    activity_type: r.activity_type as ActivityType,
    title: String(r.title),
    start_time: String(r.start_time),
    end_time: String(r.end_time),
    location_id: String(r.location_id),
    location_name: String(r.location_name),
    latitude: Number(r.latitude),
    longitude: Number(r.longitude),
    environment: r.environment as EnvironmentType,
    indoor_pm25_reading: r.indoor_pm25_reading === null ? null : Number(r.indoor_pm25_reading),
    indoor_purifier_on: Boolean(r.indoor_purifier_on),
    notes: r.notes ? String(r.notes) : null,
  }));
  ok(res, req, items);
});

app.post('/api/v1/activities', requireAuth, (req: AuthenticatedRequest, res) => {
  const body = req.body || {};
  const { activity_type, title, start_time, end_time, location, environment, indoor_pm25_reading, indoor_purifier_on, notes } = body;
  if (!activity_type || !title || !start_time || !end_time || !location || !environment) {
    fail(res, req, 400, 'VALIDATION_ERROR', 'Missing required activity fields.');
    return;
  }
  const startMs = new Date(start_time).getTime();
  const endMs = new Date(end_time).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
    fail(res, req, 400, 'INVALID_DURATION', 'end_time must be strictly after start_time.');
    return;
  }
  const lat = Number(location.latitude);
  const lng = Number(location.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    fail(res, req, 400, 'INVALID_COORDINATES', 'Valid location latitude and longitude required.');
    return;
  }

  const matchedLoc = DELHI_NCR_LOCATIONS.find((l) => l.id === location.id);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO user_activities (
      id, user_id, activity_type, title, start_time, end_time, location_id, location_name,
      latitude, longitude, environment, indoor_pm25_reading, indoor_purifier_on, notes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    req.user!.id,
    String(activity_type),
    String(title).trim(),
    new Date(startMs).toISOString(),
    new Date(endMs).toISOString(),
    matchedLoc?.id || String(location.id || 'custom'),
    matchedLoc?.name || String(location.name || 'Delhi NCR'),
    lat,
    lng,
    String(environment),
    typeof indoor_pm25_reading === 'number' && Number.isFinite(indoor_pm25_reading)
      ? indoor_pm25_reading
      : null,
    indoor_purifier_on ? 1 : 0,
    notes ? String(notes) : null,
    now
  );

  const created = db.prepare('SELECT * FROM user_activities WHERE id = ?').get(id) as Record<string, unknown>;
  ok(
    res,
    req,
    {
      ...created,
      indoor_purifier_on: Boolean(created.indoor_purifier_on),
    },
    201
  );
});

app.patch('/api/v1/activities/:activity_id', requireAuth, (req: AuthenticatedRequest, res) => {
  const existing = db
    .prepare('SELECT * FROM user_activities WHERE id = ? AND user_id = ?')
    .get(req.params.activity_id, req.user!.id) as Record<string, unknown> | undefined;

  if (!existing) {
    fail(res, req, 404, 'ACTIVITY_NOT_FOUND', 'Activity not found for authenticated user.');
    return;
  }

  const b = req.body || {};
  const nextStart = b.start_time ? new Date(b.start_time).toISOString() : String(existing.start_time);
  const nextEnd = b.end_time ? new Date(b.end_time).toISOString() : String(existing.end_time);
  if (new Date(nextEnd).getTime() <= new Date(nextStart).getTime()) {
    fail(res, req, 400, 'INVALID_DURATION', 'end_time must be after start_time.');
    return;
  }

  const locObj = b.location || {};
  const matchedLoc = DELHI_NCR_LOCATIONS.find((l) => l.id === locObj.id);

  db.prepare(
    `UPDATE user_activities SET
      activity_type = ?, title = ?, start_time = ?, end_time = ?,
      location_id = ?, location_name = ?, latitude = ?, longitude = ?,
      environment = ?, indoor_pm25_reading = ?, indoor_purifier_on = ?, notes = ?
     WHERE id = ? AND user_id = ?`
  ).run(
    String(b.activity_type || existing.activity_type),
    b.title ? String(b.title).trim() : String(existing.title),
    nextStart,
    nextEnd,
    String(matchedLoc?.id || locObj.id || existing.location_id),
    String(matchedLoc?.name || locObj.name || existing.location_name),
    typeof locObj.latitude === 'number' ? locObj.latitude : Number(existing.latitude),
    typeof locObj.longitude === 'number' ? locObj.longitude : Number(existing.longitude),
    String(b.environment || existing.environment),
    b.indoor_pm25_reading === null
      ? null
      : typeof b.indoor_pm25_reading === 'number'
      ? b.indoor_pm25_reading
      : existing.indoor_pm25_reading === null
      ? null
      : Number(existing.indoor_pm25_reading),
    typeof b.indoor_purifier_on === 'boolean'
      ? b.indoor_purifier_on
        ? 1
        : 0
      : Number(existing.indoor_purifier_on),
    b.notes !== undefined
      ? b.notes
        ? String(b.notes)
        : null
      : existing.notes === null
      ? null
      : String(existing.notes),
    String(req.params.activity_id),
    req.user!.id
  );

  const updated = db.prepare('SELECT * FROM user_activities WHERE id = ?').get(req.params.activity_id) as Record<string, unknown>;
  ok(res, req, { ...updated, indoor_purifier_on: Boolean(updated.indoor_purifier_on) });
});

app.delete('/api/v1/activities/:activity_id', requireAuth, (req: AuthenticatedRequest, res) => {
  const result = db
    .prepare('DELETE FROM user_activities WHERE id = ? AND user_id = ?')
    .run(req.params.activity_id, req.user!.id);
  if (result.changes === 0) {
    fail(res, req, 404, 'ACTIVITY_NOT_FOUND', 'Activity not found for authenticated user.');
    return;
  }
  ok(res, req, { deleted: true, activity_id: req.params.activity_id });
});

// --- AirTwin Exposure Endpoints ---
app.post('/api/v1/exposure/estimate', requireAuth, async (req: AuthenticatedRequest, res) => {
  const { period_start, period_end, segments, persist } = req.body || {};
  if (!period_start || !period_end || !Array.isArray(segments) || segments.length === 0) {
    fail(res, req, 400, 'VALIDATION_ERROR', 'period_start, period_end, and non-empty segments are required.');
    return;
  }
  try {
    const report = await calculateExposureReport(
      String(period_start),
      String(period_end),
      segments as ExposureSegmentInput[]
    );

    if (persist !== false) {
      const covPct =
        report.total_tracked_minutes > 0
          ? Math.round((report.calculable_minutes / report.total_tracked_minutes) * 100)
          : 0;
      db.prepare(
        `INSERT INTO exposure_reports (
          id, user_id, methodology_version, status, period_start, period_end,
          mean_relative_index, coverage_pct, limitations_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        report.report_id,
        req.user!.id,
        report.methodology_version,
        report.status,
        report.period_start,
        report.period_end,
        report.mean_relative_index,
        covPct,
        JSON.stringify(report.limitations),
        report.generated_at
      );

      const insSeg = db.prepare(
        `INSERT INTO exposure_segments (
          id, report_id, activity_id, activity_type, environment, duration_minutes,
          relative_index, confidence, quality, assumptions_json, sources_json, contributions_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const seg of report.segments) {
        insSeg.run(
          crypto.randomUUID(),
          report.report_id,
          seg.activity_id,
          seg.activity_type,
          seg.environment,
          seg.duration_minutes,
          seg.relative_index,
          seg.confidence,
          seg.quality,
          JSON.stringify(seg.assumptions),
          JSON.stringify(seg.source_ids),
          JSON.stringify(seg.contributions)
        );
      }
    }

    ok(res, req, report);
  } catch (err) {
    fail(
      res,
      req,
      400,
      'EXPOSURE_CALCULATION_ERROR',
      err instanceof Error ? err.message : 'Unable to compute exposure report.'
    );
  }
});

app.get('/api/v1/exposure/history', requireAuth, (req: AuthenticatedRequest, res) => {
  const rows = db
    .prepare(
      `SELECT id, methodology_version, status, period_start, period_end, mean_relative_index,
              coverage_pct, limitations_json, created_at
       FROM exposure_reports WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`
    )
    .all(req.user!.id) as Array<Record<string, unknown>>;

  ok(
    res,
    req,
    rows.map((r) => ({
      report_id: String(r.id),
      methodology_version: String(r.methodology_version),
      status: String(r.status),
      period_start: String(r.period_start),
      period_end: String(r.period_end),
      mean_relative_index: r.mean_relative_index === null ? null : Number(r.mean_relative_index),
      coverage_pct: Number(r.coverage_pct),
      limitations: JSON.parse(String(r.limitations_json || '[]')),
      created_at: String(r.created_at),
      created_at_ist: formatIST(String(r.created_at)),
    }))
  );
});

// --- AirRoute Endpoint ---
app.post('/api/v1/routes/compare', async (req: AuthenticatedRequest, res) => {
  const { origin, destination, travel_mode, candidates } = req.body || {};
  if (!origin || !destination) {
    fail(res, req, 400, 'VALIDATION_ERROR', 'origin and destination coordinates are required.');
    return;
  }
  const result = await compareRoutesWithPollution({
    origin,
    destination,
    travel_mode: travel_mode || 'DRIVE',
    candidates,
  });
  ok(res, req, result);
});

// --- Indoor Air Coach Endpoint ---
app.post('/api/v1/indoor/recommend', async (req: AuthenticatedRequest, res) => {
  const {
    room_type,
    ventilation_type,
    has_air_purifier,
    indoor_sensor_available,
    measured_indoor_pm25,
    outdoor_location,
  } = req.body || {};

  if (!room_type || !ventilation_type || !outdoor_location) {
    fail(res, req, 400, 'VALIDATION_ERROR', 'room_type, ventilation_type, and outdoor_location are required.');
    return;
  }

  const result = await generateIndoorRecommendations({
    room_type: String(room_type),
    ventilation_type,
    has_air_purifier: Boolean(has_air_purifier),
    indoor_sensor_available: Boolean(indoor_sensor_available),
    measured_indoor_pm25:
      typeof measured_indoor_pm25 === 'number' && Number.isFinite(measured_indoor_pm25)
        ? measured_indoor_pm25
        : null,
    outdoor_location,
  });
  ok(res, req, result);
});

// --- AI Assistant & Planner Endpoints ---
app.post('/api/v1/assistant/chat', requireAuth, async (req: AuthenticatedRequest, res) => {
  const { message, session_id, context } = req.body || {};
  if (!message || !String(message).trim()) {
    fail(res, req, 400, 'VALIDATION_ERROR', 'message is required.');
    return;
  }
  const result = await runSupervisorChat({
    userId: req.user!.id,
    message: String(message).trim(),
    sessionId: session_id ? String(session_id) : null,
    locationId: context?.location_id ? String(context.location_id) : 'noida-sector-62',
  });
  ok(res, req, result);
});

app.post('/api/v1/plan/generate', requireAuth, async (req: AuthenticatedRequest, res) => {
  const { plan_date, location_id } = req.body || {};
  const result = await generateDailyActionPlan({
    userId: req.user!.id,
    planDate: plan_date ? String(plan_date) : new Date().toISOString().slice(0, 10),
    locationId: location_id ? String(location_id) : 'noida-sector-62',
  });
  ok(res, req, result);
});

// --- Weekly Insights Endpoint ---
app.get('/api/v1/insights/weekly', requireAuth, (req: AuthenticatedRequest, res) => {
  const reports = db
    .prepare(
      `SELECT id, status, period_start, mean_relative_index, coverage_pct, limitations_json, created_at
       FROM exposure_reports WHERE user_id = ? ORDER BY period_start ASC LIMIT 14`
    )
    .all(req.user!.id) as Array<Record<string, unknown>>;

  const activitiesCount = (
    db.prepare('SELECT COUNT(*) as c FROM user_activities WHERE user_id = ?').get(req.user!.id) as { c: number }
  ).c;

  const recs = db
    .prepare(
      `SELECT id, intent, summary, created_at FROM recommendations WHERE user_id = ? ORDER BY created_at DESC LIMIT 8`
    )
    .all(req.user!.id) as Array<Record<string, unknown>>;

  const dailySeries = reports.map((r) => ({
    date: String(r.period_start).slice(0, 10),
    mean_relative_index: r.mean_relative_index === null ? null : Number(r.mean_relative_index),
    coverage_pct: Number(r.coverage_pct),
    segments_count: activitiesCount,
    status: String(r.status) as 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE',
  }));

  const comparableDays = dailySeries.filter((d) => d.status === 'COMPLETE' || (d.status === 'PARTIAL' && d.coverage_pct >= 75));
  const avgCoverage =
    dailySeries.length > 0
      ? Math.round(dailySeries.reduce((s, d) => s + d.coverage_pct, 0) / dailySeries.length)
      : 0;

  // Week-over-week comparison ONLY if >= 6 comparable days exist across two distinct windows
  const canCompareWoW = comparableDays.length >= 6;
  let wowDelta: number | null = null;
  if (canCompareWoW) {
    const mid = Math.floor(comparableDays.length / 2);
    const firstHalf = comparableDays.slice(0, mid);
    const secondHalf = comparableDays.slice(mid);
    const avg1 = firstHalf.reduce((s, x) => s + (x.mean_relative_index || 0), 0) / firstHalf.length;
    const avg2 = secondHalf.reduce((s, x) => s + (x.mean_relative_index || 0), 0) / secondHalf.length;
    if (avg1 > 0) wowDelta = Number((((avg2 - avg1) / avg1) * 100).toFixed(1));
  }

  const limitations: string[] = [];
  if (!canCompareWoW) {
    limitations.push(
      `Week-over-week progress is marked INSUFFICIENT_DATA (${comparableDays.length} comparable day(s) recorded; minimum 6 comparable days required to avoid misleading trend claims).`
    );
  }
  limitations.push(
    'Exposure history reflects relative concentration-time indices from recorded AirTwin methodology v1.0 runs.'
  );

  ok(res, req, {
    period_days: 7,
    completed_segments_count: activitiesCount,
    comparable_days_count: comparableDays.length,
    coverage_percent: avgCoverage,
    week_over_week_status: canCompareWoW ? 'COMPARABLE' : 'INSUFFICIENT_DATA',
    week_over_week_delta_pct: wowDelta,
    daily_series: dailySeries,
    recommendation_history: recs.map((r) => ({
      id: String(r.id),
      created_at_ist: formatIST(String(r.created_at)) || String(r.created_at),
      intent: String(r.intent),
      summary: String(r.summary),
    })),
    limitations,
  });
});

async function startServer() {
  const PORT = 3000;
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`BreatheOS server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
