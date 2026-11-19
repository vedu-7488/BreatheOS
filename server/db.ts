import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { NCRLocation } from '../src/types/breatheos.js';

const DATA_DIR = path.resolve(process.cwd(), '.data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'breatheos.sqlite');
export const db = new DatabaseSync(DB_PATH);

export const DELHI_NCR_LOCATIONS: NCRLocation[] = [
  {
    id: 'noida-sector-62',
    name: 'Noida Sector 62',
    zone: 'Noida',
    latitude: 28.6279,
    longitude: 77.3649,
    description: 'IT & Institutional Corridor along NH-24 / Delhi–Meerut Expressway',
  },
  {
    id: 'noida-sector-18',
    name: 'Noida Sector 18',
    zone: 'Noida',
    latitude: 28.5708,
    longitude: 77.3261,
    description: 'Commercial hub near DND Flyway and Sector 18 Metro',
  },
  {
    id: 'connaught-place',
    name: 'Connaught Place',
    zone: 'Delhi',
    latitude: 28.6329,
    longitude: 77.2195,
    description: 'Central New Delhi business & Rajiv Chowk transit hub',
  },
  {
    id: 'anand-vihar',
    name: 'Anand Vihar',
    zone: 'Delhi',
    latitude: 28.6469,
    longitude: 77.3160,
    description: 'East Delhi ISBT & arterial freight junction',
  },
  {
    id: 'rk-puram',
    name: 'R.K. Puram',
    zone: 'Delhi',
    latitude: 28.5633,
    longitude: 77.1767,
    description: 'South Delhi institutional & Ring Road residential sector',
  },
  {
    id: 'ito-delhi',
    name: 'ITO Junction',
    zone: 'Delhi',
    latitude: 28.6289,
    longitude: 77.2405,
    description: 'Central Delhi Yamuna corridor & civic offices',
  },
];

export function initDatabase() {
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_preferences (
      user_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
      default_location_id TEXT NOT NULL,
      commute_mode TEXT NOT NULL DEFAULT 'DRIVE',
      sensitivity_group TEXT NOT NULL DEFAULT 'GENERAL',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS locations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      zone TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      description TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL,
      last_success_at TEXT,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS monitoring_stations (
      station_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      zone TEXT NOT NULL,
      available_pollutants_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS air_observations (
      id TEXT PRIMARY KEY,
      location_id TEXT,
      provider_id TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      observed_at TEXT NOT NULL,
      index_system TEXT NOT NULL,
      aqi_value REAL,
      pm25 REAL,
      pm10 REAL,
      no2 REAL,
      o3 REAL,
      quality TEXT NOT NULL,
      raw_metadata_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS air_quality_snapshots (
      id TEXT PRIMARY KEY,
      location_id TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_activities (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      activity_type TEXT NOT NULL,
      title TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      location_id TEXT NOT NULL,
      location_name TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      environment TEXT NOT NULL,
      indoor_pm25_reading REAL,
      indoor_purifier_on INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_activities_user ON user_activities(user_id, start_time);

    CREATE TABLE IF NOT EXISTS exposure_reports (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      methodology_version TEXT NOT NULL,
      status TEXT NOT NULL,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      mean_relative_index REAL,
      coverage_pct REAL NOT NULL,
      limitations_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_exposure_reports_user ON exposure_reports(user_id, period_start);

    CREATE TABLE IF NOT EXISTS exposure_segments (
      id TEXT PRIMARY KEY,
      report_id TEXT NOT NULL REFERENCES exposure_reports(id) ON DELETE CASCADE,
      activity_id TEXT NOT NULL,
      activity_type TEXT NOT NULL,
      environment TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL,
      relative_index REAL,
      confidence TEXT NOT NULL,
      quality TEXT NOT NULL,
      assumptions_json TEXT NOT NULL,
      sources_json TEXT NOT NULL,
      contributions_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS route_comparisons (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      origin_lat REAL NOT NULL,
      origin_lng REAL NOT NULL,
      dest_lat REAL NOT NULL,
      dest_lng REAL NOT NULL,
      travel_mode TEXT NOT NULL,
      comparison_status TEXT NOT NULL,
      limitations_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS route_options (
      id TEXT PRIMARY KEY,
      comparison_id TEXT NOT NULL REFERENCES route_comparisons(id) ON DELETE CASCADE,
      summary TEXT NOT NULL,
      duration_seconds INTEGER NOT NULL,
      distance_meters INTEGER NOT NULL,
      relative_exposure_estimate REAL,
      exposure_confidence TEXT NOT NULL,
      sources_json TEXT NOT NULL,
      limitations_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS indoor_profiles (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      room_type TEXT NOT NULL,
      ventilation_type TEXT NOT NULL,
      has_air_purifier INTEGER NOT NULL,
      indoor_sensor_available INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS daily_plans (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      plan_date TEXT NOT NULL,
      location_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS recommendations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      intent TEXT NOT NULL,
      summary TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      messages_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      session_id TEXT,
      intent TEXT NOT NULL,
      model TEXT NOT NULL,
      agents_used_json TEXT NOT NULL,
      steps_json TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  // Upsert pilot locations
  const insertLoc = db.prepare(`
    INSERT INTO locations (id, name, zone, latitude, longitude, description)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      zone = excluded.zone,
      latitude = excluded.latitude,
      longitude = excluded.longitude,
      description = excluded.description
  `);
  for (const loc of DELHI_NCR_LOCATIONS) {
    insertLoc.run(loc.id, loc.name, loc.zone, loc.latitude, loc.longitude, loc.description);
  }

  // Seed demo user if not present
  const demoUser = db.prepare(`SELECT id FROM profiles WHERE email = ?`).get('ananya.verma@breatheos.in') as { id: string } | undefined;
  if (!demoUser) {
    const demoId = '00000000-0000-4000-8000-000000000001';
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync('breatheos-demo-2026', salt, 64).toString('hex');
    const nowIso = new Date().toISOString();

    db.prepare(`
      INSERT INTO profiles (id, email, password_hash, full_name, is_demo, created_at)
      VALUES (?, ?, ?, ?, 1, ?)
    `).run(demoId, 'ananya.verma@breatheos.in', `${salt}:${hash}`, 'Ananya Verma', nowIso);

    db.prepare(`
      INSERT INTO user_preferences (user_id, default_location_id, commute_mode, sensitivity_group, updated_at)
      VALUES (?, 'noida-sector-62', 'DRIVE', 'GENERAL', ?)
    `).run(demoId, nowIso);

    // Seed today's realistic Delhi-Noida commute & routine in IST (UTC+05:30)
    const todayDate = new Date().toISOString().slice(0, 10);
    const activities = [
      {
        id: crypto.randomUUID(),
        type: 'EXERCISE',
        title: 'Morning Park Walk (Sector 62)',
        start: `${todayDate}T01:30:00Z`, // 07:00 IST
        end: `${todayDate}T02:15:00Z`,   // 07:45 IST
        locId: 'noida-sector-62',
        locName: 'Noida Sector 62',
        lat: 28.6279,
        lng: 77.3649,
        env: 'OUTDOOR',
        indoorPm25: null,
        purifier: 0,
        notes: 'Morning walk near Sector 62 green belt',
      },
      {
        id: crypto.randomUUID(),
        type: 'COMMUTE',
        title: 'Morning Commute (Noida Sec 62 -> Connaught Place)',
        start: `${todayDate}T03:30:00Z`, // 09:00 IST
        end: `${todayDate}T04:30:00Z`,   // 10:00 IST
        locId: 'ito-delhi',
        locName: 'ITO Junction',
        lat: 28.6289,
        lng: 77.2405,
        env: 'TRANSIT',
        indoorPm25: null,
        purifier: 0,
        notes: 'NH-24 and ITO corridor transit segment',
      },
      {
        id: crypto.randomUUID(),
        type: 'WORK',
        title: 'Office Work Block (Connaught Place)',
        start: `${todayDate}T04:30:00Z`, // 10:00 IST
        end: `${todayDate}T12:00:00Z`,   // 17:30 IST
        locId: 'connaught-place',
        locName: 'Connaught Place',
        lat: 28.6329,
        lng: 77.2195,
        env: 'INDOOR',
        indoorPm25: null,
        purifier: 1,
        notes: 'Central HVAC office building; no personal indoor PM2.5 monitor paired',
      },
      {
        id: crypto.randomUUID(),
        type: 'COMMUTE',
        title: 'Evening Return Commute (CP -> Noida Sec 62)',
        start: `${todayDate}T12:30:00Z`, // 18:00 IST
        end: `${todayDate}T13:45:00Z`,   // 19:15 IST
        locId: 'anand-vihar',
        locName: 'Anand Vihar',
        lat: 28.6469,
        lng: 77.3160,
        env: 'TRANSIT',
        indoorPm25: null,
        purifier: 0,
        notes: 'Peak evening traffic via Vikas Marg / Anand Vihar border',
      },
      {
        id: crypto.randomUUID(),
        type: 'HOME',
        title: 'Home Evening & Sleep Prep',
        start: `${todayDate}T14:00:00Z`, // 19:30 IST
        end: `${todayDate}T17:30:00Z`,   // 23:00 IST
        locId: 'noida-sector-62',
        locName: 'Noida Sector 62',
        lat: 28.6279,
        lng: 77.3649,
        env: 'INDOOR',
        indoorPm25: 42.0,
        purifier: 1,
        notes: 'Bedroom HEPA purifier active; portable laser PM2.5 monitor reading 42 µg/m³',
      },
    ];

    const insertAct = db.prepare(`
      INSERT INTO user_activities (
        id, user_id, activity_type, title, start_time, end_time,
        location_id, location_name, latitude, longitude, environment,
        indoor_pm25_reading, indoor_purifier_on, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const a of activities) {
      insertAct.run(
        a.id, demoId, a.type, a.title, a.start, a.end,
        a.locId, a.locName, a.lat, a.lng, a.env,
        a.indoorPm25, a.purifier, a.notes, nowIso
      );
    }

    // Seed 4 recent exposure reports for Weekly Insights continuity (marking partial where indoor unmeasured)
    const insertReport = db.prepare(`
      INSERT INTO exposure_reports (
        id, user_id, methodology_version, status, period_start, period_end,
        mean_relative_index, coverage_pct, limitations_json, created_at
      ) VALUES (?, ?, '1.0', ?, ?, ?, ?, ?, ?, ?)
    `);

    const nowMs = Date.now();
    const pastSnapshots = [
      { daysAgo: 4, idx: 184.2, cov: 86, status: 'PARTIAL', lims: ['Office indoor segment relied on infiltration assumptions.'] },
      { daysAgo: 3, idx: 162.8, cov: 92, status: 'COMPLETE', lims: [] },
      { daysAgo: 2, idx: 198.5, cov: 88, status: 'PARTIAL', lims: ['Evening commute interpolated between Anand Vihar and Noida Sec 62.'] },
      { daysAgo: 1, idx: 149.4, cov: 94, status: 'COMPLETE', lims: [] },
    ];
    for (const s of pastSnapshots) {
      const d = new Date(nowMs - s.daysAgo * 86400000).toISOString().slice(0, 10);
      insertReport.run(
        crypto.randomUUID(),
        demoId,
        s.status,
        `${d}T00:00:00Z`,
        `${d}T23:59:59Z`,
        s.idx,
        s.cov,
        JSON.stringify(s.lims),
        new Date(nowMs - s.daysAgo * 86400000).toISOString()
      );
    }

    db.prepare(`
      INSERT INTO recommendations (id, user_id, intent, summary, evidence_json, created_at)
      VALUES (?, ?, 'COMMUTE_PLANNING', ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      demoId,
      'Shifted outdoor walk from 06:30 IST inversion peak to 08:30 IST dispersion window based on Open-Meteo boundary-layer forecast.',
      JSON.stringify(['Open-Meteo Hourly PM2.5 Forecast', 'AirTwin v1.0 Segment Baseline']),
      new Date(nowMs - 86400000).toISOString()
    );
  }
}
