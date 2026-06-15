import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');

function loadModule(relativePath, requireMock, processMock) {
  const sourceUrl = new URL(`../${relativePath}`, import.meta.url);
  const source = readFileSync(sourceUrl, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: fileURLToPath(sourceUrl),
  });

  const module = { exports: {} };
  vm.runInNewContext(
    transpiled.outputText,
    {
      URLSearchParams,
      exports: module.exports,
      module,
      process: processMock,
      require: requireMock,
    },
    { filename: relativePath }
  );
  return module.exports;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function createQuery(table, options, calls) {
  const query = {
    table,
    selectColumns: null,
    filters: [],
    inFilters: [],
    orders: [],
    limitValue: null,
    rangeValue: null,
    select(columns) {
      this.selectColumns = columns;
      calls.selects.push({ table, columns });
      return this;
    },
    order(column, orderOptions) {
      this.orders.push({ column, options: orderOptions });
      calls.orders.push({ table, column, options: orderOptions });
      return this;
    },
    limit(value) {
      this.limitValue = value;
      calls.limits.push({ table, value });
      return this;
    },
    eq(column, value) {
      this.filters.push({ column, value });
      calls.filters.push({ table, column, value });
      return this;
    },
    in(column, values) {
      this.inFilters.push({ column, values });
      calls.inFilters.push({ table, column, values });
      return this;
    },
    range(from, to) {
      this.rangeValue = { from, to };
      calls.ranges.push({ table, from, to });
      return this;
    },
    maybeSingle: async () => {
      calls.maybeSingles.push({ table, filters: query.filters });
      return options.singleResult ?? { data: null, error: null };
    },
    then(resolve, reject) {
      const result =
        table === 'class_sessions'
          ? (options.sessionResult ?? { data: [], error: null })
          : (options.eventResult ?? { data: [], error: null });
      if (table === 'conversation_events' && query.rangeValue && Array.isArray(result.data)) {
        return Promise.resolve({
          ...result,
          data: result.data.slice(query.rangeValue.from, query.rangeValue.to + 1),
        }).then(resolve, reject);
      }
      return Promise.resolve(result).then(resolve, reject);
    },
  };
  return query;
}

function createSupabaseClient(options, calls) {
  return {
    from(table) {
      calls.tables.push(table);
      assert.ok(['class_sessions', 'conversation_events'].includes(table));
      return createQuery(table, options, calls);
    },
  };
}

function loadConversationLogStore(options = {}) {
  const calls = {
    filters: [],
    inFilters: [],
    limits: [],
    maybeSingles: [],
    orders: [],
    ranges: [],
    selects: [],
    tables: [],
  };
  const processMock = {
    cwd: () => '/repo/client',
    env: {
      NODE_ENV: options.nodeEnv ?? 'development',
      CONVERSATION_LOG_FILE_FALLBACK: options.fileFallbackEnv,
    },
  };
  const files = options.files ?? {};

  const exports = loadModule(
    'lib/conversation-log-store.ts',
    (specifier) => {
      if (specifier === 'server-only') return {};
      if (specifier === 'path') return path;
      if (specifier === 'fs') {
        return {
          readFileSync: (target, encoding) => {
            assert.equal(encoding, 'utf-8');
            if (!(target in files)) throw new Error(`missing file: ${target}`);
            return files[target];
          },
          readdirSync: (target) => {
            assert.equal(target, '/repo/logs');
            return Object.keys(files).map((file) => path.basename(file));
          },
          statSync: (target) => ({
            mtimeMs: options.mtimeByPath?.[target] ?? 1234,
          }),
        };
      }
      if (specifier === '@/lib/supabase/admin') {
        return {
          createSupabaseAdminClient: () => createSupabaseClient(options, calls),
          hasSupabaseAdminEnv: () => options.hasSupabaseAdminEnv !== false,
        };
      }
      throw new Error(`Unexpected import in conversation log store test: ${specifier}`);
    },
    processMock
  );

  return { ...exports, calls };
}

const SESSION_ROW = {
  id: '11111111-1111-4111-8111-111111111111',
  livekit_session_id: 'RM_livekit',
  room_name: '1반-1그룹',
  agent_mode: 'realtime',
  agent_role: 'collaborative',
  activity_type: 'free_conversation',
  evaluation_id: 'pretest_6_10',
  evaluation_prompt_id: 'pretest_6_10',
  evaluation_prompt_version: '2026-06-10',
  feedback_condition_id: 'explicit_correction',
  task_card_id: 'school_event_invitation',
  prompt_version_id: '22222222-2222-4222-8222-222222222222',
  egress_id: 'egress-123',
  recording_path: 'recordings/1.mp3',
  session_purpose: 'evaluation',
  metadata: {
    prompt_source: 'custom',
  },
  started_at: '2026-06-12T01:00:00.000Z',
  ended_at: null,
};

test('readConversationLogSessions maps Supabase sessions and aggregates event counts', async () => {
  const { calls, readConversationLogSessions } = loadConversationLogStore({
    sessionResult: { data: [SESSION_ROW], error: null },
    eventResult: {
      data: [
        {
          session_id: SESSION_ROW.id,
          created_at: '2026-06-12T01:00:01.000Z',
        },
        {
          session_id: SESSION_ROW.id,
          created_at: '2026-06-12T01:00:03.000Z',
        },
      ],
      error: null,
    },
  });

  const sessions = await readConversationLogSessions({
    agentMode: 'realtime',
    activityType: 'free_conversation',
    evaluationId: 'pretest_6_10',
    limit: 20,
    sessionPurpose: 'evaluation',
  });

  assert.deepEqual(plain(sessions), [
    {
      id: SESSION_ROW.id,
      source: 'supabase',
      room: '1반-1그룹',
      session_id: 'RM_livekit',
      entry_count: 2,
      last_modified: Date.parse('2026-06-12T01:00:03.000Z'),
      started_at: '2026-06-12T01:00:00.000Z',
      ended_at: null,
      metadata: {
        agent_mode: 'realtime',
        agent_role: 'collaborative',
        activity_type: 'free_conversation',
        evaluation_id: 'pretest_6_10',
        evaluation_prompt_id: 'pretest_6_10',
        evaluation_prompt_version: '2026-06-10',
        feedback_condition_id: 'explicit_correction',
        task_card_id: 'school_event_invitation',
        prompt_version_id: '22222222-2222-4222-8222-222222222222',
        egress_id: 'egress-123',
        recording_path: 'recordings/1.mp3',
        session_purpose: 'evaluation',
        prompt_source: 'custom',
      },
    },
  ]);
  assert.deepEqual(plain(calls.filters), [
    { table: 'class_sessions', column: 'agent_mode', value: 'realtime' },
    { table: 'class_sessions', column: 'activity_type', value: 'free_conversation' },
    { table: 'class_sessions', column: 'evaluation_id', value: 'pretest_6_10' },
    { table: 'class_sessions', column: 'session_purpose', value: 'evaluation' },
  ]);
  assert.deepEqual(plain(calls.inFilters), [
    {
      table: 'conversation_events',
      column: 'session_id',
      values: [SESSION_ROW.id],
    },
  ]);
});

test('readConversationLogSessions keeps distinct class sessions with reused LiveKit SID', async () => {
  const secondSessionRow = {
    ...SESSION_ROW,
    id: '33333333-3333-4333-8333-333333333333',
    started_at: '2026-06-12T01:05:00.000Z',
  };
  const { readConversationLogSessions } = loadConversationLogStore({
    sessionResult: { data: [SESSION_ROW, secondSessionRow], error: null },
    eventResult: {
      data: [
        {
          session_id: SESSION_ROW.id,
          created_at: '2026-06-12T01:00:01.000Z',
        },
        {
          session_id: secondSessionRow.id,
          created_at: '2026-06-12T01:05:01.000Z',
        },
      ],
      error: null,
    },
  });

  const sessions = await readConversationLogSessions();

  assert.deepEqual(
    plain(
      sessions.map((session) => ({
        id: session.id,
        livekitSessionId: session.session_id,
        entryCount: session.entry_count,
      }))
    ),
    [
      {
        id: SESSION_ROW.id,
        livekitSessionId: 'RM_livekit',
        entryCount: 1,
      },
      {
        id: secondSessionRow.id,
        livekitSessionId: 'RM_livekit',
        entryCount: 1,
      },
    ]
  );
});

test('readConversationLogSessions paginates events before aggregating session counts', async () => {
  const eventRows = Array.from({ length: 1001 }, (_, index) => ({
    session_id: SESSION_ROW.id,
    created_at: `2026-06-12T01:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`,
  }));
  const { calls, readConversationLogSessions } = loadConversationLogStore({
    sessionResult: { data: [SESSION_ROW], error: null },
    eventResult: { data: eventRows, error: null },
  });

  const sessions = await readConversationLogSessions();

  assert.equal(sessions[0].entry_count, 1001);
  assert.equal(sessions[0].last_modified, Date.parse(eventRows[1000].created_at));
  assert.deepEqual(plain(calls.ranges), [
    { table: 'conversation_events', from: 0, to: 999 },
    { table: 'conversation_events', from: 1000, to: 1999 },
  ]);
});

test('readConversationLogData maps Supabase event stream payload ordered by sequence query', async () => {
  const { calls, readConversationLogData } = loadConversationLogStore({
    singleResult: { data: SESSION_ROW, error: null },
    eventResult: {
      data: [
        {
          session_id: SESSION_ROW.id,
          sequence: 1,
          role: 'user',
          text: 'I am free.',
          participant_identity: 'student-1',
          participant_name: 'Minji',
          student_id: '22222222-2222-4222-8222-222222222222',
          student_name: '김민지',
          metadata: {},
          created_at: '2026-06-12T01:00:01.000Z',
        },
        {
          session_id: SESSION_ROW.id,
          sequence: 2,
          role: 'agent',
          text: 'Great. What time?',
          metadata: {},
          created_at: '2026-06-12T01:00:02.000Z',
        },
      ],
      error: null,
    },
  });

  const log = await readConversationLogData({ sessionId: SESSION_ROW.id });

  assert.equal(log.id, SESSION_ROW.id);
  assert.equal(log.source, 'supabase');
  assert.equal(log.session_id, 'RM_livekit');
  assert.equal(log.entries.length, 2);
  assert.deepEqual(plain(log.entries.map((entry) => [entry.sequence, entry.role, entry.text])), [
    [1, 'user', 'I am free.'],
    [2, 'agent', 'Great. What time?'],
  ]);
  assert.equal(log.entries[0].student_id, '22222222-2222-4222-8222-222222222222');
  assert.equal(log.entries[0].student_name, '김민지');
  assert.deepEqual(plain(calls.orders), [
    { table: 'conversation_events', column: 'sequence', options: { ascending: true } },
    { table: 'conversation_events', column: 'created_at', options: { ascending: true } },
  ]);
});

test('readConversationLogData paginates Supabase events for long streams', async () => {
  const eventRows = Array.from({ length: 1001 }, (_, index) => ({
    session_id: SESSION_ROW.id,
    sequence: index + 1,
    role: index % 2 === 0 ? 'user' : 'agent',
    text: `Message ${index + 1}`,
    metadata: {},
    created_at: `2026-06-12T01:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`,
  }));
  const { calls, readConversationLogData } = loadConversationLogStore({
    singleResult: { data: SESSION_ROW, error: null },
    eventResult: { data: eventRows, error: null },
  });

  const log = await readConversationLogData({ sessionId: SESSION_ROW.id });

  assert.equal(log.entries.length, 1001);
  assert.deepEqual(plain(log.entries.slice(-2).map((entry) => [entry.sequence, entry.text])), [
    [1000, 'Message 1000'],
    [1001, 'Message 1001'],
  ]);
  assert.deepEqual(plain(calls.ranges), [
    { table: 'conversation_events', from: 0, to: 999 },
    { table: 'conversation_events', from: 1000, to: 1999 },
  ]);
});

test('readConversationLogSessions falls back to file logs in local development only', async () => {
  const filePath = '/repo/logs/RM_livekit--260612_10:00.json';
  const { readConversationLogSessions } = loadConversationLogStore({
    hasSupabaseAdminEnv: false,
    files: {
      [filePath]: JSON.stringify({
        session_id: 'RM_livekit',
        room: '1반-1그룹',
        metadata: { agent_mode: 'pipeline' },
        entries: [{ role: 'agent', text: 'Hi.', timestamp: '2026-06-12T01:00:00Z' }],
      }),
    },
    mtimeByPath: {
      [filePath]: 5678,
    },
  });

  const sessions = await readConversationLogSessions();

  assert.deepEqual(plain(sessions), [
    {
      id: 'file:RM_livekit--260612_10:00.json',
      source: 'file',
      filename: 'RM_livekit--260612_10:00.json',
      room: '1반-1그룹',
      session_id: 'RM_livekit',
      entry_count: 1,
      last_modified: 5678,
      metadata: { agent_mode: 'pipeline' },
    },
  ]);
});

test('readConversationLogData rejects file fallback names outside the logs directory', async () => {
  const { readConversationLogData } = loadConversationLogStore({
    hasSupabaseAdminEnv: false,
    files: {},
  });

  for (const filename of ['../package.json', '/repo/logs/session.json', 'nested/session.json']) {
    await assert.rejects(
      () => readConversationLogData({ filename }),
      (error) => error.code === 'invalid_filename' && error.status === 400
    );
  }
});

test('readConversationLogSessions does not hide configured Supabase read failures with file fallback', async () => {
  const filePath = '/repo/logs/RM_livekit--260612_10:00.json';
  const { readConversationLogSessions } = loadConversationLogStore({
    sessionResult: { data: null, error: { message: 'boom' } },
    files: {
      [filePath]: JSON.stringify({
        session_id: 'RM_livekit',
        room: '1반-1그룹',
        metadata: { agent_mode: 'pipeline' },
        entries: [{ role: 'agent', text: 'Hi.', timestamp: '2026-06-12T01:00:00Z' }],
      }),
    },
  });

  await assert.rejects(
    () => readConversationLogSessions(),
    (error) => error.code === 'supabase_read_failed' && error.status === 500
  );
});

test('readConversationLogSessions rejects missing Supabase in production', async () => {
  const { readConversationLogSessions } = loadConversationLogStore({
    hasSupabaseAdminEnv: false,
    nodeEnv: 'production',
  });

  await assert.rejects(
    () => readConversationLogSessions(),
    (error) => error.code === 'supabase_not_configured' && error.status === 503
  );
});

test('parseConversationLogSessionFilters normalizes supported query filters', () => {
  const { parseConversationLogSessionFilters } = loadConversationLogStore();

  assert.deepEqual(
    plain(
      parseConversationLogSessionFilters(
        new URLSearchParams(
          'agentMode=realtime&agentRole=collaborative&activityType=free_conversation&evaluationId=pretest_6_10&feedbackConditionId=explicit_correction&promptVersionId=abc&room=1%EB%B0%98-1%EA%B7%B8%EB%A3%B9&sessionPurpose=evaluation&limit=10'
        )
      )
    ),
    {
      agentMode: 'realtime',
      agentRole: 'collaborative',
      activityType: 'free_conversation',
      evaluationId: 'pretest_6_10',
      feedbackConditionId: 'explicit_correction',
      promptVersionId: 'abc',
      room: '1반-1그룹',
      sessionPurpose: 'evaluation',
      limit: 10,
    }
  );
});
