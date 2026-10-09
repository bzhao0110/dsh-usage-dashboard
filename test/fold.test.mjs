/**
 * Minimal fold tests for the tokenStats projection.
 *
 * Timestamps are fixed UTC values so `dayOf` (toISOString → UTC date) is
 * deterministic regardless of the machine's timezone.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTokenStatsEvent, foldTokenStatsEvents } from '../lib/index.js';

const DAY = '2026-10-08';
const T1 = Date.UTC(2026, 9, 8, 1, 0, 0);
const T2 = Date.UTC(2026, 9, 8, 2, 0, 0);

function reqHeader(provider, model) {
  return {
    type: 'request/header',
    time: T1,
    data: { header: { config: { provider, model } } },
  };
}

function stepStart(turn, step) {
  return { type: 'step/start', time: T1, data: { turn, step } };
}

function usage(turn, step, buckets, time = T1) {
  return {
    type: 'assistant/message',
    time,
    data: { turn, step, usage: buckets },
  };
}

function stepEnd(turn, step) {
  return { type: 'step/end', time: T1, data: { turn, step } };
}

test('empty event list folds to zero state', () => {
  assert.deepEqual(foldTokenStatsEvents([]), { totalTokens: 0, requests: 0, byDay: {} });
});

test('one request folds tokens into day and model buckets', () => {
  const view = foldTokenStatsEvents([
    reqHeader('prov', 'model-a'),
    stepStart(0, 0),
    usage(0, 0, { inputTokens: 100, cacheReadTokens: 20, cacheWriteTokens: 30, outputTokens: 50 }),
    stepEnd(0, 0),
  ]);
  assert.equal(view.totalTokens, 200);
  assert.equal(view.requests, 1);
  assert.equal(view.byDay[DAY].tokens, 200);
  assert.equal(view.byDay[DAY].byModel[JSON.stringify(['prov', 'model-a'])], 200);
});

test('repeated usage chunks on the same (turn, step) replace, not add', () => {
  const view = foldTokenStatsEvents([
    reqHeader('prov', 'model-a'),
    stepStart(0, 0),
    usage(0, 0, { inputTokens: 100, outputTokens: 50 }),
    usage(0, 0, { inputTokens: 10, outputTokens: 5 }, T2),
    stepEnd(0, 0),
  ]);
  assert.equal(view.totalTokens, 15);
  assert.equal(view.byDay[DAY].tokens, 15);
});

test('irrelevant events are ignored and state stays immutable', () => {
  const state = applyTokenStatsEvent(undefined, { type: 'session/created', time: T1, data: {} });
  assert.equal(state, undefined);
  const before = foldTokenStatsEvents([reqHeader('p', 'm')]);
  applyTokenStatsEvent(
    { totalTokens: 0, requests: 0, byDay: {} },
    { type: 'step/start', time: T1, data: { turn: 0, step: 0 } },
  );
  assert.deepEqual(before, { totalTokens: 0, requests: 0, byDay: {} });
});

test('compaction summary counts as a request and folds its usage', () => {
  const view = foldTokenStatsEvents([
    reqHeader('prov', 'model-b'),
    {
      type: 'compaction/summary',
      time: T2,
      data: { provider: 'prov', model: 'model-b', usage: { inputTokens: 7, outputTokens: 3 } },
    },
  ]);
  assert.equal(view.requests, 1);
  assert.equal(view.totalTokens, 10);
});

test('usage without a known route is ignored', () => {
  const view = foldTokenStatsEvents([
    stepStart(0, 0),
    usage(0, 0, { inputTokens: 100, outputTokens: 1 }),
    stepEnd(0, 0),
  ]);
  assert.equal(view.totalTokens, 0);
  assert.equal(view.requests, 1);
});
