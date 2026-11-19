import crypto from 'node:crypto';
import { FunctionDeclaration, GoogleGenAI, Type, type Content, type Part } from '@google/genai';
import { db, DELHI_NCR_LOCATIONS } from '../db.js';
import type {
  AgentStepTrace,
  AssistantChatResponse,
  ConfidenceLevel,
  DailyPlanResponse,
  UserActivity,
} from '../../src/types/breatheos.js';
import { formatIST, getAirForecast, getCurrentAirConditions } from './environmental.js';
import { calculateExposureReport } from './airtwin.js';
import { generateIndoorRecommendations } from './indoor.js';

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-4-hydrogen';

function getGenAIClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'get_current_air',
    description:
      'Retrieve current ambient air quality (IN_NAQI, PM2.5, PM10, NO2, O3), weather dispersion (wind, humidity), provider attribution, and quality status for a Delhi NCR coordinate.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        latitude: { type: Type.NUMBER, description: 'Latitude in Delhi NCR' },
        longitude: { type: Type.NUMBER, description: 'Longitude in Delhi NCR' },
      },
      required: ['latitude', 'longitude'],
    },
  },
  {
    name: 'get_air_forecast',
    description:
      'Retrieve modelled hourly air quality forecast (up to 48 hours) and the cleanest 3-hour outdoor window in Asia/Kolkata time.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        latitude: { type: Type.NUMBER },
        longitude: { type: Type.NUMBER },
        hours: { type: Type.NUMBER, description: 'Forecast horizon hours (12 to 48)' },
      },
      required: ['latitude', 'longitude'],
    },
  },
  {
    name: 'get_user_exposure',
    description:
      'Fetch the authenticated user routine activities and run the deterministic AirTwin v1.0 exposure engine to obtain segment-level relative indices, assumptions, and limitations.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        include_details: { type: Type.BOOLEAN, description: 'Include full segment list' },
      },
    },
  },
  {
    name: 'get_indoor_guidance',
    description:
      'Run the deterministic Indoor Air Coach rules comparing outdoor air conditions against room ventilation and purifier availability.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        room_type: { type: Type.STRING, description: 'BEDROOM, LIVING_ROOM, HOME_OFFICE, or OFFICE' },
        ventilation_type: { type: Type.STRING, description: 'NATURAL, MECHANICAL_HVAC, or SEALED' },
        has_air_purifier: { type: Type.BOOLEAN },
        latitude: { type: Type.NUMBER },
        longitude: { type: Type.NUMBER },
      },
      required: ['room_type', 'ventilation_type', 'has_air_purifier', 'latitude', 'longitude'],
    },
  },
];

const AGENT_NAME_BY_TOOL: Record<string, string> = {
  get_current_air: 'AirIntelligenceAgent',
  get_air_forecast: 'AirIntelligenceAgent',
  get_user_exposure: 'AirTwinAgent',
  get_indoor_guidance: 'IndoorAirAgent',
};

function getUserActivitiesForAgent(userId: string): UserActivity[] {
  const rows = db
    .prepare(
      `SELECT id, user_id, activity_type, title, start_time, end_time, location_id, location_name,
              latitude, longitude, environment, indoor_pm25_reading, indoor_purifier_on, notes
       FROM user_activities WHERE user_id = ? ORDER BY start_time ASC`
    )
    .all(userId) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    user_id: String(r.user_id),
    activity_type: r.activity_type as UserActivity['activity_type'],
    title: String(r.title),
    start_time: String(r.start_time),
    end_time: String(r.end_time),
    location_id: String(r.location_id),
    location_name: String(r.location_name),
    latitude: Number(r.latitude),
    longitude: Number(r.longitude),
    environment: r.environment as UserActivity['environment'],
    indoor_pm25_reading: r.indoor_pm25_reading === null ? null : Number(r.indoor_pm25_reading),
    indoor_purifier_on: Boolean(r.indoor_purifier_on),
    notes: r.notes ? String(r.notes) : null,
  }));
}

async function executeAllowlistedTool(
  userId: string,
  name: string,
  args: Record<string, unknown>
): Promise<{ result: unknown; sourceLabel: string; summary: string; status: 'SUCCESS' | 'PARTIAL' }> {
  if (name === 'get_current_air') {
    const lat = Number(args.latitude ?? 28.6279);
    const lng = Number(args.longitude ?? 77.3649);
    const data = await getCurrentAirConditions(lat, lng);
    return {
      result: data,
      sourceLabel: `${data.source.provider} (${data.source.observed_at_ist || 'timestamp unavailable'})`,
      summary:
        data.aqi.value !== null
          ? `IN_NAQI ${data.aqi.value} (${data.aqi.category}), PM2.5 ${data.pollutants.find((p) => p.code === 'PM25')?.value ?? 'N/A'} µg/m³`
          : 'Current air readings unavailable',
      status: data.source.quality === 'UNAVAILABLE' ? 'PARTIAL' : 'SUCCESS',
    };
  }

  if (name === 'get_air_forecast') {
    const lat = Number(args.latitude ?? 28.6279);
    const lng = Number(args.longitude ?? 77.3649);
    const hours = Math.min(Number(args.hours ?? 24), 48);
    const data = await getAirForecast(lat, lng, hours);
    return {
      result: {
        location: data.location,
        index_system: data.index_system,
        best_window: data.best_window,
        sample_points: data.forecast.slice(0, 12),
        limitations: data.limitations,
      },
      sourceLabel: 'Open-Meteo CAMS Hourly Forecast Model',
      summary: data.best_window
        ? `Best 3h window: ${data.best_window.start_ist}–${data.best_window.end_ist} (avg PM2.5 ${data.best_window.avg_pm25} µg/m³)`
        : 'Forecast points unavailable',
      status: data.forecast.length > 0 ? 'SUCCESS' : 'PARTIAL',
    };
  }

  if (name === 'get_user_exposure') {
    const activities = getUserActivitiesForAgent(userId);
    if (activities.length === 0) {
      return {
        result: { status: 'UNAVAILABLE', segments: [], message: 'No activities logged yet.' },
        sourceLabel: 'AirTwin v1.0 Engine',
        summary: 'No user activity segments found for today.',
        status: 'PARTIAL',
      };
    }
    const report = await calculateExposureReport(
      activities[0].start_time,
      activities[activities.length - 1].end_time,
      activities.map((a) => ({
        activity_id: a.id,
        title: a.title,
        activity_type: a.activity_type,
        start_time: a.start_time,
        end_time: a.end_time,
        duration_minutes: Math.max(
          15,
          Math.round((new Date(a.end_time).getTime() - new Date(a.start_time).getTime()) / 60000)
        ),
        latitude: a.latitude,
        longitude: a.longitude,
        environment: a.environment,
        indoor_pm25_reading: a.indoor_pm25_reading,
        indoor_purifier_on: a.indoor_purifier_on,
      }))
    );
    return {
      result: report,
      sourceLabel: `AirTwin v${report.methodology_version} (${report.reference_baseline_version})`,
      summary: `Evaluated ${report.segments.length} segments; mean relative index ${report.mean_relative_index ?? 'Unavailable'} (${report.status})`,
      status: report.status === 'COMPLETE' ? 'SUCCESS' : 'PARTIAL',
    };
  }

  if (name === 'get_indoor_guidance') {
    const guidance = await generateIndoorRecommendations({
      room_type: String(args.room_type || 'HOME_OFFICE'),
      ventilation_type: (args.ventilation_type as 'NATURAL' | 'MECHANICAL_HVAC' | 'SEALED') || 'NATURAL',
      has_air_purifier: Boolean(args.has_air_purifier),
      indoor_sensor_available: false,
      outdoor_location: {
        latitude: Number(args.latitude ?? 28.6279),
        longitude: Number(args.longitude ?? 77.3649),
      },
    });
    return {
      result: guidance,
      sourceLabel: `Indoor Air Coach Rules + ${guidance.outdoor_context.provider}`,
      summary: `${guidance.recommendations.length} indoor actions generated (indoor status: ${guidance.indoor_measurement_status})`,
      status: 'SUCCESS',
    };
  }

  throw new Error(`Tool ${name} is not allowlisted.`);
}

const SYSTEM_INSTRUCTION = `You are the BreatheOS Supervisor Agent for Delhi NCR (Delhi & Noida).
You coordinate specialist backend tools (AirIntelligenceAgent, AirTwinAgent, IndoorAirAgent) to give working professionals and commuters practical, evidence-grounded daily recommendations.

CRITICAL SCIENTIFIC & PRODUCT BOUNDARIES:
1. BreatheOS is NOT a medical application. Never diagnose, predict medical conditions, or claim absolute safety.
2. Never claim to measure actual inhaled biological dose; AirTwin computes comparative concentration-time relative indices.
3. Never invent environmental readings, AQI numbers, or station values. Always cite ONLY numbers returned by your backend tools.
4. Distinguish modelled forecasts (Open-Meteo CAMS) from physical ground station observations, and always state when indoor air quality is unmeasured.
5. Express all times in Asia/Kolkata (IST).
6. Keep maximum 3 orchestration steps and execute independent tool calls together in parallel.`;

export async function runSupervisorChat(params: {
  userId: string;
  message: string;
  sessionId: string | null;
  locationId: string;
}): Promise<AssistantChatResponse> {
  const sessionId = params.sessionId || crypto.randomUUID();
  const loc =
    DELHI_NCR_LOCATIONS.find((l) => l.id === params.locationId) || DELHI_NCR_LOCATIONS[0];

  const steps: AgentStepTrace[] = [];
  const agentsUsed = new Set<string>(['SupervisorAgent']);
  const collectedSources = new Set<string>();
  const collectedLimitations = new Set<string>();

  const ai = getGenAIClient();

  // Load recent session history if any
  let history: Array<{ role: string; text: string }> = [];
  const existingSession = db
    .prepare('SELECT messages_json FROM chat_sessions WHERE id = ? AND user_id = ?')
    .get(sessionId, params.userId) as { messages_json: string } | undefined;
  if (existingSession) {
    try {
      history = JSON.parse(existingSession.messages_json);
    } catch {
      history = [];
    }
  }

  if (ai) {
    try {
      const userPromptText = `User location context: ${loc.name} (${loc.zone}, lat ${loc.latitude}, lng ${loc.longitude}). Current time IST: ${formatIST(new Date().toISOString())}.\n\nUser request: ${params.message}`;
      const contents: Content[] = [
        ...history.slice(-4).map((h) => ({
          role: h.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: h.text }],
        })),
        { role: 'user', parts: [{ text: userPromptText }] },
      ];

      let stepNum = 0;
      const MAX_STEPS = 2; // Up to 2 tool-calling rounds + 1 final synthesis = 3 orchestration steps max

      while (stepNum < MAX_STEPS) {
        const resp = await ai.models.generateContent({
          model: GEMINI_MODEL,
          contents,
          config: {
            systemInstruction: SYSTEM_INSTRUCTION,
            tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
          },
        });

        const modelContent = resp.candidates?.[0]?.content;
        const calls = resp.functionCalls;

        if (!calls || calls.length === 0) {
          break;
        }

        if (modelContent) {
          contents.push(modelContent);
        }

        stepNum += 1;
        // Execute requested specialist tools concurrently
        const settled = await Promise.all(
          calls.slice(0, 4).map(async (fc) => {
            const toolName = fc.name || '';
            const agent = AGENT_NAME_BY_TOOL[toolName] || 'SpecialistAgent';
            agentsUsed.add(agent);
            try {
              const out = await executeAllowlistedTool(
                params.userId,
                toolName,
                (fc.args as Record<string, unknown>) || {}
              );
              collectedSources.add(out.sourceLabel);
              steps.push({
                step: stepNum,
                agent,
                tool: toolName,
                status: out.status,
                summary: out.summary,
              });
              return { fc, response: out.result };
            } catch (err) {
              steps.push({
                step: stepNum,
                agent,
                tool: toolName,
                status: 'FAILED',
                summary: err instanceof Error ? err.message : 'Tool execution error',
              });
              return {
                fc,
                response: { error: err instanceof Error ? err.message : 'Tool failed' },
              };
            }
          })
        );

        const responseParts: Part[] = settled.map((item) => ({
          functionResponse: {
            id: item.fc.id,
            name: item.fc.name || 'tool',
            response: { output: item.response },
          },
        }));
        contents.push({ role: 'user', parts: responseParts });
      }

      // Final structured synthesis pass with Pydantic-equivalent JSON schema
      const finalResp = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: [
          ...contents,
          {
            role: 'user',
            parts: [
              {
                text: 'Synthesize your final validated response now using ONLY data observed in tool outputs. Explicitly preserve limitations and missing-data caveats.',
              },
            ],
          },
        ],
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              intent: {
                type: Type.STRING,
                description:
                  'One of: COMMUTE_PLANNING, DAILY_PLAN, EXERCISE_WINDOW, INDOOR_VENTILATION, EXPOSURE_ANALYSIS, GENERAL_AIR_QUERY',
              },
              answer: {
                type: Type.STRING,
                description: 'Concise, grounded explanation citing exact observed values and IST windows.',
              },
              recommendations: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    action: { type: Type.STRING },
                    time_window: { type: Type.STRING },
                    evidence: { type: Type.STRING },
                  },
                  required: ['title', 'action', 'evidence'],
                },
              },
              sources: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              limitations: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
            },
            required: ['intent', 'answer', 'recommendations', 'sources', 'limitations'],
          },
        },
      });

      const parsed = JSON.parse(finalResp.text || '{}') as {
        intent?: string;
        answer?: string;
        recommendations?: AssistantChatResponse['recommendations'];
        sources?: string[];
        limitations?: string[];
      };

      const finalSources = Array.from(new Set([...collectedSources, ...(parsed.sources || [])]));
      const finalLimitations = Array.from(
        new Set([
          ...collectedLimitations,
          ...(parsed.limitations || []),
          'BreatheOS provides informational environmental context and relative exposure estimates, not medical advice.',
        ])
      );

      const result: AssistantChatResponse = {
        session_id: sessionId,
        intent: parsed.intent || 'GENERAL_AIR_QUERY',
        answer: parsed.answer || 'Environmental analysis completed.',
        recommendations: parsed.recommendations || [],
        sources: finalSources,
        limitations: finalLimitations,
        agent_trace: {
          model: GEMINI_MODEL,
          agents_used: Array.from(agentsUsed),
          steps,
          status: steps.some((s) => s.status !== 'SUCCESS') ? 'PARTIAL' : 'COMPLETE',
        },
      };

      persistChatAndRun(params.userId, sessionId, params.message, result, history);
      return result;
    } catch (err) {
      collectedLimitations.add(
        `Gemini orchestration fallback triggered: ${err instanceof Error ? err.message : 'upstream error'}.`
      );
    }
  } else {
    collectedLimitations.add(
      'GEMINI_API_KEY is not configured; deterministic environmental summary returned.'
    );
  }

  // Deterministic graceful fallback using real environmental & AirTwin data
  const [air, forecast] = await Promise.all([
    getCurrentAirConditions(loc.latitude, loc.longitude),
    getAirForecast(loc.latitude, loc.longitude, 24),
  ]);
  const pm25 = air.pollutants.find((p) => p.code === 'PM25')?.value ?? null;
  steps.push({
    step: 1,
    agent: 'AirIntelligenceAgent',
    tool: 'get_current_air + get_air_forecast',
    status: air.source.quality === 'UNAVAILABLE' ? 'PARTIAL' : 'SUCCESS',
    summary: `Fallback retrieval for ${loc.name}: IN_NAQI ${air.aqi.value ?? 'Unavailable'}`,
  });

  const fallbackResult: AssistantChatResponse = {
    session_id: sessionId,
    intent: 'COMMUTE_PLANNING',
    answer:
      air.aqi.value !== null
        ? `For ${loc.name}, current IN_NAQI is ${air.aqi.value} (${air.aqi.category}) with PM2.5 at ${pm25 ?? 'Unavailable'} µg/m³ via ${air.source.provider} (${air.source.observed_at_ist}).${forecast.best_window ? ` The cleanest modelled 3-hour outdoor window in the next 24h is ${forecast.best_window.start_ist}–${forecast.best_window.end_ist} (avg PM2.5 ${forecast.best_window.avg_pm25} µg/m³).` : ''}`
        : `Environmental data for ${loc.name} is temporarily unavailable. BreatheOS will not fabricate air quality readings.`,
    recommendations: forecast.best_window
      ? [
          {
            title: 'Prefer cleaner outdoor window',
            action: `Schedule outdoor errands or walks around ${forecast.best_window.start_ist}–${forecast.best_window.end_ist}.`,
            time_window: `${forecast.best_window.start_ist} – ${forecast.best_window.end_ist}`,
            evidence: `Open-Meteo CAMS forecast avg PM2.5 ${forecast.best_window.avg_pm25} µg/m³`,
          },
        ]
      : [],
    sources: [air.source.provider, 'Open-Meteo CAMS Hourly Forecast'],
    limitations: [
      ...Array.from(collectedLimitations),
      ...forecast.limitations,
    ],
    agent_trace: {
      model: `${GEMINI_MODEL} (deterministic-fallback)`,
      agents_used: ['SupervisorAgent', 'AirIntelligenceAgent'],
      steps,
      status: 'FALLBACK',
    },
  };

  persistChatAndRun(params.userId, sessionId, params.message, fallbackResult, history);
  return fallbackResult;
}

function persistChatAndRun(
  userId: string,
  sessionId: string,
  userMessage: string,
  resp: AssistantChatResponse,
  prevHistory: Array<{ role: string; text: string }>
) {
  const now = new Date().toISOString();
  const updatedHistory = [
    ...prevHistory.slice(-10),
    { role: 'user', text: userMessage },
    { role: 'assistant', text: resp.answer },
  ];
  db.prepare(`
    INSERT INTO chat_sessions (id, user_id, messages_json, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET messages_json = excluded.messages_json, updated_at = excluded.updated_at
  `).run(sessionId, userId, JSON.stringify(updatedHistory), now);

  db.prepare(`
    INSERT INTO agent_runs (id, user_id, session_id, intent, model, agents_used_json, steps_json, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    userId,
    sessionId,
    resp.intent,
    resp.agent_trace.model,
    JSON.stringify(resp.agent_trace.agents_used),
    JSON.stringify(resp.agent_trace.steps),
    resp.agent_trace.status,
    now
  );

  if (resp.recommendations.length > 0) {
    db.prepare(`
      INSERT INTO recommendations (id, user_id, intent, summary, evidence_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      userId,
      resp.intent,
      resp.recommendations[0].action,
      JSON.stringify(resp.sources),
      now
    );
  }
}

export async function generateDailyActionPlan(params: {
  userId: string;
  planDate: string;
  locationId: string;
}): Promise<DailyPlanResponse> {
  const loc =
    DELHI_NCR_LOCATIONS.find((l) => l.id === params.locationId) || DELHI_NCR_LOCATIONS[0];
  const activities = getUserActivitiesForAgent(params.userId);

  const [currentAir, forecast, exposure] = await Promise.all([
    getCurrentAirConditions(loc.latitude, loc.longitude),
    getAirForecast(loc.latitude, loc.longitude, 24),
    activities.length > 0
      ? calculateExposureReport(
          activities[0].start_time,
          activities[activities.length - 1].end_time,
          activities.map((a) => ({
            activity_id: a.id,
            title: a.title,
            activity_type: a.activity_type,
            start_time: a.start_time,
            end_time: a.end_time,
            duration_minutes: Math.max(
              15,
              Math.round((new Date(a.end_time).getTime() - new Date(a.start_time).getTime()) / 60000)
            ),
            latitude: a.latitude,
            longitude: a.longitude,
            environment: a.environment,
            indoor_pm25_reading: a.indoor_pm25_reading,
            indoor_purifier_on: a.indoor_purifier_on,
          }))
        )
      : Promise.resolve(null),
  ]);

  const ai = getGenAIClient();
  const planId = crypto.randomUUID();
  const evidenceContext = {
    location: loc.name,
    current_aqi_in_naqi: currentAir.aqi,
    current_pm25: currentAir.pollutants.find((p) => p.code === 'PM25')?.value ?? null,
    weather: currentAir.weather,
    source: currentAir.source,
    best_forecast_window: forecast.best_window,
    forecast_next_12h: forecast.forecast.slice(0, 12).map((f) => ({
      ist: f.timestamp_ist,
      aqi: f.aqi_in_naqi,
      pm25: f.pm25,
      wind: f.wind_speed_kmh,
    })),
    airtwin_summary: exposure
      ? {
          status: exposure.status,
          mean_relative_index: exposure.mean_relative_index,
          segments: exposure.segments.map((s) => ({
            title: s.title,
            type: s.activity_type,
            env: s.environment,
            ist: `${s.start_ist} - ${s.end_ist}`,
            relative_index: s.relative_index,
            quality: s.quality,
          })),
        }
      : null,
  };

  if (ai) {
    try {
      const resp = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: `Generate an actionable, evidence-backed daily plan for ${params.planDate} in ${loc.name} using ONLY the verified environmental & AirTwin data below:\n\n${JSON.stringify(evidenceContext)}`,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: { type: Type.STRING },
              recommended_actions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    window_ist: { type: Type.STRING },
                    activity: { type: Type.STRING },
                    recommendation: { type: Type.STRING },
                    alternative_action: { type: Type.STRING },
                    supporting_evidence: { type: Type.STRING },
                    confidence: { type: Type.STRING },
                  },
                  required: [
                    'window_ist',
                    'activity',
                    'recommendation',
                    'alternative_action',
                    'supporting_evidence',
                    'confidence',
                  ],
                },
              },
              limitations: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ['summary', 'recommended_actions', 'limitations'],
          },
        },
      });

      const parsed = JSON.parse(resp.text || '{}') as {
        summary?: string;
        recommended_actions?: Array<{
          window_ist: string;
          activity: string;
          recommendation: string;
          alternative_action: string;
          supporting_evidence: string;
          confidence: string;
        }>;
        limitations?: string[];
      };

      const plan: DailyPlanResponse = {
        plan_id: planId,
        plan_date: params.planDate,
        location_name: loc.name,
        summary: parsed.summary || `Daily plan for ${loc.name} based on live environmental context.`,
        recommended_actions: (parsed.recommended_actions || []).map((a) => ({
          ...a,
          confidence: (['HIGH', 'MEDIUM', 'LOW'].includes(a.confidence)
            ? a.confidence
            : 'MEDIUM') as ConfidenceLevel,
        })),
        sources: [
          `${currentAir.source.provider} (${currentAir.source.observed_at_ist || 'N/A'})`,
          'Open-Meteo CAMS Forecast',
          ...(exposure ? [`AirTwin v${exposure.methodology_version}`] : []),
        ],
        limitations: Array.from(
          new Set([
            ...(parsed.limitations || []),
            ...forecast.limitations,
            ...(exposure?.limitations || []),
          ])
        ),
        agent_trace: {
          model: GEMINI_MODEL,
          agents_used: ['SupervisorAgent', 'AirIntelligenceAgent', 'AirTwinAgent', 'IndoorAirAgent'],
          status: exposure?.status === 'COMPLETE' ? 'COMPLETE' : 'PARTIAL',
        },
      };

      db.prepare(
        `INSERT INTO daily_plans (id, user_id, plan_date, location_id, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(planId, params.userId, params.planDate, loc.id, JSON.stringify(plan), new Date().toISOString());

      return plan;
    } catch {
      // Fall through to deterministic plan
    }
  }

  const pm25Val = currentAir.pollutants.find((p) => p.code === 'PM25')?.value ?? null;
  const fallbackPlan: DailyPlanResponse = {
    plan_id: planId,
    plan_date: params.planDate,
    location_name: loc.name,
    summary: `Deterministic daily guidance for ${loc.name}. Current IN_NAQI is ${currentAir.aqi.value ?? 'Unavailable'} (${currentAir.aqi.category ?? 'Unknown'}).`,
    recommended_actions: [
      {
        window_ist: forecast.best_window
          ? `${forecast.best_window.start_ist} – ${forecast.best_window.end_ist}`
          : 'Midday dispersion check',
        activity: 'Outdoor Exercise / Walk',
        recommendation: forecast.best_window
          ? `Use the lowest modelled PM2.5 window (~${forecast.best_window.avg_pm25} µg/m³) for outdoor activity.`
          : 'Check forecast recovery before scheduling prolonged outdoor exertion.',
        alternative_action: 'Move exercise indoors with filtration if outdoor IN_NAQI exceeds 200.',
        supporting_evidence: `${currentAir.source.provider} PM2.5 ${pm25Val ?? 'Unavailable'} µg/m³`,
        confidence: 'MEDIUM',
      },
      {
        window_ist: '09:00 – 10:00 IST & 18:00 – 19:30 IST',
        activity: 'Delhi–Noida Commute',
        recommendation: 'Compare corridor alternatives in AirRoute and keep vehicle HVAC on recirculation during peak congestion.',
        alternative_action: 'Shift departure ±45 minutes if schedule permits.',
        supporting_evidence: 'Peak boundary-layer inversion & arterial traffic overlap',
        confidence: 'LOW',
      },
    ],
    sources: [currentAir.source.provider, 'Open-Meteo CAMS Forecast'],
    limitations: [...forecast.limitations, 'Deterministic fallback plan used.'],
    agent_trace: {
      model: `${GEMINI_MODEL} (deterministic-fallback)`,
      agents_used: ['SupervisorAgent', 'AirIntelligenceAgent'],
      status: 'FALLBACK',
    },
  };

  return fallbackPlan;
}
