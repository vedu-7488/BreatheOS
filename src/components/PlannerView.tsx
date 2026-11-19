import React, { useState } from 'react';
import { Calendar, Send } from 'lucide-react';
import { api } from '../lib/api';
import type { AssistantChatResponse, DailyPlanResponse, NCRLocation } from '../types/breatheos';

interface PlannerViewProps {
  location: NCRLocation;
}

interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
  meta?: AssistantChatResponse;
}

const SUGGESTED_PROMPTS = [
  'When is the cleanest 3-hour outdoor window in the next 24h?',
  'How should I structure my morning commute and outdoor walk today?',
  'What does my AirTwin timeline assume about my indoor office hours?',
];

export function PlannerView({ location }: PlannerViewProps) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [chatLoading, setChatLoading] = useState(false);

  const [dailyPlan, setDailyPlan] = useState<DailyPlanResponse | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendMessage(promptText: string) {
    if (!promptText.trim() || chatLoading) return;
    const text = promptText.trim();
    setInput('');
    setError(null);
    setTurns((prev) => [...prev, { role: 'user', text }]);
    setChatLoading(true);
    try {
      const resp = await api.chatAssistant({
        message: text,
        session_id: sessionId,
        context: { location_id: location.id, timezone: 'Asia/Kolkata' },
      });
      setSessionId(resp.session_id);
      setTurns((prev) => [...prev, { role: 'assistant', text: resp.answer, meta: resp }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Assistant request failed.');
    } finally {
      setChatLoading(false);
    }
  }

  async function handleGeneratePlan() {
    setPlanLoading(true);
    setError(null);
    try {
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      const plan = await api.generatePlan({
        plan_date: today,
        location_id: location.id,
      });
      setDailyPlan(plan);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate daily action plan.');
    } finally {
      setPlanLoading(false);
    }
  }

  const latestTrace = [...turns].reverse().find((t) => t.meta)?.meta;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-slate-500">
            Supervisor & Specialist Orchestration · {location.name} · Asia/Kolkata
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 mt-1">
            AI Action Planner & Assistant
          </h1>
          <p className="text-sm text-slate-600 mt-1 max-w-2xl">
            Coordinated recommendations grounded strictly in live environmental tools, AirTwin segments, and deterministic indoor rules.
          </p>
        </div>

        <button
          type="button"
          onClick={handleGeneratePlan}
          disabled={planLoading}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-[#0D6E6E] hover:bg-[#095454] rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
        >
          <Calendar className="w-3.5 h-3.5" />
          {planLoading ? 'Generating Plan...' : 'Generate Daily Plan'}
        </button>
      </div>

      {error && (
        <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">{error}</div>
      )}

      {dailyPlan && (
        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Daily Action Plan · {dailyPlan.plan_date} ({dailyPlan.location_name})
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Agents: {dailyPlan.agent_trace.agents_used.join(', ')} · Status: {dailyPlan.agent_trace.status}
              </p>
            </div>
          </div>

          <p className="text-sm text-slate-700 leading-relaxed">{dailyPlan.summary}</p>

          <div className="divide-y divide-slate-100">
            {dailyPlan.recommended_actions.map((item, idx) => (
              <div key={idx} className="py-3.5 grid grid-cols-1 lg:grid-cols-12 gap-3">
                <div className="lg:col-span-3">
                  <p className="text-xs font-mono-tabular font-medium text-[#0D6E6E]">{item.window_ist}</p>
                  <p className="text-xs font-semibold text-slate-900 mt-0.5">{item.activity}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">Confidence: {item.confidence}</p>
                </div>
                <div className="lg:col-span-6 space-y-1">
                  <p className="text-sm text-slate-900">{item.recommendation}</p>
                  <p className="text-xs text-slate-500">Alternative: {item.alternative_action}</p>
                </div>
                <div className="lg:col-span-3 text-xs text-slate-600 lg:text-right">
                  {item.supporting_evidence}
                </div>
              </div>
            ))}
          </div>

          <div className="pt-3 border-t border-slate-100 text-xs text-slate-500 space-y-1">
            <p>Sources: {dailyPlan.sources.join(' · ')}</p>
            {dailyPlan.limitations.slice(0, 2).map((l, i) => (
              <p key={i}>Limitation: {l}</p>
            ))}
          </div>
        </section>
      )}

      {/* Assistant Chat + Agent Execution Trace Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <section className="lg:col-span-7 bg-white border border-slate-200 rounded-xl flex flex-col min-h-[460px]">
          <div className="px-6 py-4 border-b border-slate-200">
            <h2 className="text-sm font-semibold text-slate-900">Supervisor Assistant</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Ask about commute timing, outdoor windows, or AirTwin assumptions
            </p>
          </div>

          <div className="flex-1 p-6 space-y-4 overflow-y-auto max-h-[420px]">
            {turns.length === 0 ? (
              <div className="space-y-3">
                <p className="text-sm text-slate-600">
                  Start a grounded planning query for <span className="font-medium text-slate-900">{location.name}</span>:
                </p>
                <div className="space-y-2">
                  {SUGGESTED_PROMPTS.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => sendMessage(q)}
                      className="block w-full text-left px-3.5 py-2.5 text-xs text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              turns.map((turn, idx) => (
                <div key={idx} className={turn.role === 'user' ? 'text-right' : 'text-left'}>
                  <div
                    className={`inline-block max-w-[90%] rounded-xl px-4 py-3 text-sm leading-relaxed ${
                      turn.role === 'user'
                        ? 'bg-[#0D6E6E] text-white text-left'
                        : 'bg-slate-50 border border-slate-200 text-slate-800'
                    }`}
                  >
                    <p className="whitespace-pre-line">{turn.text}</p>
                    {turn.meta && turn.meta.recommendations.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-slate-200 space-y-2">
                        {turn.meta.recommendations.map((rec, rIdx) => (
                          <div key={rIdx} className="text-xs">
                            <p className="font-semibold text-slate-900">
                              {rec.title}
                              {rec.time_window ? ` · ${rec.time_window}` : ''}
                            </p>
                            <p className="text-slate-700 mt-0.5">{rec.action}</p>
                            <p className="text-slate-500 mt-0.5">Evidence: {rec.evidence}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
            {chatLoading && (
              <p className="text-xs text-slate-500">Supervisor coordinating specialist backend tools...</p>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendMessage(input);
            }}
            className="p-4 border-t border-slate-200 flex items-center gap-2"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={`Ask about ${location.name} air, commute, or routine...`}
              className="flex-1 px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0D6E6E]/20"
            />
            <button
              type="submit"
              disabled={chatLoading || !input.trim()}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-[#0D6E6E] hover:bg-[#095454] rounded-lg disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Send className="w-3.5 h-3.5" />
              Send
            </button>
          </form>
        </section>

        {/* Evidence & Specialist Agent Trace Panel */}
        <section className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Agent Execution Trace & Evidence</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Verifiable tool calls, data sources, and explicit limitations
            </p>
          </div>

          {latestTrace ? (
            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3 pb-3 border-b border-slate-100">
                <div>
                  <p className="text-slate-500">Intent</p>
                  <p className="font-medium text-slate-900 mt-0.5">{latestTrace.intent}</p>
                </div>
                <div>
                  <p className="text-slate-500">Status</p>
                  <p className="font-medium text-slate-900 mt-0.5">{latestTrace.agent_trace.status}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-slate-500">Model & Specialists</p>
                  <p className="font-mono-tabular text-slate-800 mt-0.5">
                    {latestTrace.agent_trace.model} · {latestTrace.agent_trace.agents_used.join(', ')}
                  </p>
                </div>
              </div>

              <div>
                <p className="font-medium text-slate-800 mb-2">Executed Tool Steps</p>
                <div className="space-y-2">
                  {latestTrace.agent_trace.steps.map((st, idx) => (
                    <div key={idx} className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg">
                      <p className="font-medium text-slate-900">
                        Step {st.step} · {st.agent} ({st.tool})
                      </p>
                      <p className="text-slate-600 mt-0.5">{st.summary}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="font-medium text-slate-800 mb-1">Sources</p>
                <ul className="text-slate-600 space-y-0.5">
                  {latestTrace.sources.map((s, i) => (
                    <li key={i}>• {s}</li>
                  ))}
                </ul>
              </div>

              <div>
                <p className="font-medium text-slate-800 mb-1">Limitations</p>
                <ul className="text-slate-600 space-y-0.5">
                  {latestTrace.limitations.map((l, i) => (
                    <li key={i}>• {l}</li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-500 leading-relaxed">
              Submit a question or generate a daily plan to inspect the Supervisor Agent&apos;s specialist selections, backend tool responses, and preserved environmental sources.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
