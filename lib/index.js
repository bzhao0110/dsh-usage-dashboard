/**
 * dsh-token-stats — server half.
 *
 * Registers a `tokenStats` session projection that folds the same usage
 * events dsh-usage consumes (request/header, step/start, assistant usage,
 * step/end, compaction/summary) into a compact per-session statistic:
 *
 *   { totalTokens, requests, firstTime, lastTime,
 *     byDay:  { "YYYY-MM-DD": { tokens, byModel: { "provider\u0000model": n } } } }
 *
 * The harness replays persisted session logs through registered projections
 * (lazily, on first touch), so the projection covers historical sessions
 * without this plugin shipping its own log reader. The client aggregates
 * every session's view value into the dashboard.
 *
 * Folds are immutable: the registry detects changes via `Object.is` on the
 * state reference, so every applied event returns a new top-level object and
 * clones any day bucket it touches.
 */

/** Minimal schema object: the projection cache only needs `.parse`. */
const stateSchema = {
  parse(value) {
    if (typeof value !== 'object' || value === null) throw new Error('dsh-token-stats: invalid state row');
    return value;
  },
};

/** Wire views are schema-validated too: `wire.viewSchema.parse` runs on every cold restore. */
const viewSchema = {
  parse(value) {
    if (typeof value !== 'object' || value === null) throw new Error('dsh-token-stats: invalid view');
    return value;
  },
};

/**
 * Wire view: explicit construction, no undefined-valued keys. Projection
 * values ride inside forwarded host events (api-session/added etc.), which
 * the gateway validates with `isJsonValue` — any `undefined` property fails
 * that check and aborts the surrounding operation (e.g. session creation).
 */
function viewOf(state) {
  const view = {
    totalTokens: state.totalTokens,
    requests: state.requests,
    byDay: state.byDay,
  };
  if (state.firstTime !== undefined) view.firstTime = state.firstTime;
  if (state.lastTime !== undefined) view.lastTime = state.lastTime;
  return view;
}

function dayOf(time) {
  return new Date(time).toISOString().slice(0, 10);
}

function usageBuckets(usage) {
  return {
    input: usage.inputTokens ?? 0,
    cacheRead: usage.cacheReadTokens ?? 0,
    cacheWrite: usage.cacheWriteTokens ?? 0,
    output: usage.outputTokens ?? 0,
  };
}

function totalOf(buckets) {
  return buckets.input + buckets.cacheRead + buckets.cacheWrite + buckets.output;
}

function routeKey(route) {
  return JSON.stringify([route.provider, route.model]);
}

function withDay(state, day, nextDay) {
  const byDay = { ...state.byDay };
  if (nextDay === undefined) delete byDay[day];
  else byDay[day] = nextDay;
  return byDay;
}

/** Subtract a previously recorded sample (repeated usage chunks replace). */
function removeSample(state, sample) {
  const day = state.byDay[sample.day];
  if (day === undefined) return state;
  const tokens = day.tokens - sample.tokens;
  if (tokens > 0) {
    const byModel = { ...day.byModel };
    const left = (byModel[sample.model] ?? 0) - sample.tokens;
    if (left > 0) byModel[sample.model] = left;
    else delete byModel[sample.model];
    return { ...state, totalTokens: state.totalTokens - sample.tokens, byDay: withDay(state, sample.day, { tokens, byModel }) };
  }
  return { ...state, totalTokens: state.totalTokens - sample.tokens, byDay: withDay(state, sample.day, undefined) };
}

function addSample(state, sample) {
  const day = state.byDay[sample.day] ?? { tokens: 0, byModel: {} };
  const byModel = { ...day.byModel };
  byModel[sample.model] = (byModel[sample.model] ?? 0) + sample.tokens;
  return {
    ...state,
    totalTokens: state.totalTokens + sample.tokens,
    byDay: withDay(state, sample.day, { tokens: day.tokens + sample.tokens, byModel }),
    firstTime: state.firstTime === undefined || sample.time < state.firstTime ? sample.time : state.firstTime,
    lastTime: state.lastTime === undefined || sample.time > state.lastTime ? sample.time : state.lastTime,
  };
}

function usageOf(event) {
  if (event.type === 'assistant/chunk' && event.data.chunk?.type === 'usage') {
    return event.data.chunk.usage;
  }
  if (event.type === 'assistant/message') return event.data.usage;
  return undefined;
}

export function applyTokenStatsEvent(state, event) {
  if (event.type === 'request/header') {
    const currentRoute = {
      provider: event.data.header.config.provider,
      model: event.data.header.config.model,
    };
    const openStep = state.openStep === undefined ? undefined : { ...state.openStep, route: currentRoute };
    return { ...state, currentRoute, ...(openStep === undefined ? {} : { openStep }) };
  }
  if (event.type === 'step/start') {
    return {
      ...state,
      openStep: {
        turn: event.data.turn,
        step: event.data.step,
        route: state.currentRoute,
        hadUsage: false,
      },
    };
  }
  const usage = usageOf(event);
  if (usage !== undefined) {
    const route = state.openStep?.route ?? state.currentRoute;
    if (route === undefined) return state;
    const sample = {
      turn: event.data.turn,
      step: event.data.step,
      tokens: totalOf(usageBuckets(usage)),
      day: dayOf(event.time),
      time: event.time,
      model: routeKey(route),
    };
    // A step can stream several usage chunks; only the newest counts.
    let next = state;
    if (state.lastSample !== undefined
      && state.lastSample.turn === sample.turn
      && state.lastSample.step === sample.step) {
      next = removeSample(state, state.lastSample);
    }
    if (sample.tokens > 0) next = addSample(next, sample);
    const openStep = next.openStep === undefined ? undefined : { ...next.openStep, hadUsage: true };
    return { ...next, lastSample: sample, ...(openStep === undefined ? {} : { openStep }) };
  }
  if (event.type === 'step/end') {
    const open = state.openStep;
    const closed = open !== undefined && open.turn === event.data.turn && open.step === event.data.step;
    const { openStep: _drop, ...rest } = state;
    return { ...(closed ? rest : state), requests: state.requests + 1 };
  }
  if (event.type === 'compaction/summary') {
    let next = { ...state, requests: state.requests + 1 };
    if (event.data.usage !== undefined) {
      const tokens = totalOf(usageBuckets(event.data.usage));
      if (tokens > 0) {
        next = addSample(next, {
          tokens,
          day: dayOf(event.time),
          time: event.time,
          model: routeKey({ provider: event.data.provider, model: event.data.model }),
        });
      }
    }
    return next;
  }
  return state;
}

/** Fold an event slice without a live session (used by tests and tooling). */
export function foldTokenStatsEvents(events) {
  let state = {
    totalTokens: 0,
    requests: 0,
    byDay: {},
  };
  for (const event of events) state = applyTokenStatsEvent(state, event);
  const { currentRoute: _r, openStep: _s, lastSample: _l, ...view } = state;
  return view;
}

export const name = 'token-stats';
export const inject = ['sessionProjections'];

export function apply(ctx) {
  ctx.sessionProjections.register({
    key: 'tokenStats',
    stateSchema,
    stateVersion: 1,
    init: () => ({
      totalTokens: 0,
      requests: 0,
      byDay: {},
    }),
    apply: applyTokenStatsEvent,
    wire: {
      view: viewOf,
      viewSchema,
    },
  });
}
