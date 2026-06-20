import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');

function loadModule(relativePath, requireMock) {
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
      require: requireMock,
    },
    { filename: relativePath }
  );
  return module.exports;
}

function loadDashboardHelpers() {
  return loadModule('lib/conversation-dashboard.ts', (specifier) => {
    if (specifier === '@/lib/session-activity') {
      return {
        getActivityTypeForSessionPurpose: (sessionPurpose) =>
          sessionPurpose === 'evaluation' ? 'free_conversation' : 'task_solution',
        getSessionPurposeForActivity: (activityType) =>
          activityType === 'free_conversation' ? 'evaluation' : 'practice',
      };
    }
    return require(specifier);
  });
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('buildLogSessionsQuery includes supported server filters only', () => {
  const { buildLogSessionsQuery } = loadDashboardHelpers();

  assert.equal(
    buildLogSessionsQuery({
      activityType: 'free_conversation',
      evaluationId: ' pretest_6_10 ',
      search: 'Minji',
      sessionPurpose: 'evaluation',
    }),
    '?sessionPurpose=evaluation&activityType=free_conversation&evaluationId=pretest_6_10'
  );

  assert.equal(
    buildLogSessionsQuery({
      activityType: 'all',
      evaluationId: '',
      search: 'ignored',
      sessionPurpose: 'all',
    }),
    ''
  );
});

test('dashboard grouping uses purpose, class metadata, and student labels for realtime sessions', () => {
  const { getDashboardStudentLabel, groupDashboardSessions, inferDashboardActivityType } =
    loadDashboardHelpers();

  const sessions = [
    {
      id: 'eval-session',
      room: 'eval_9_2_minji_kim_a1b2c3d4',
      session_id: 'RM_eval',
      metadata: {
        agent_mode: 'realtime',
        session_purpose: 'evaluation',
        activity_type: 'free_conversation',
        student_class_number: 9,
        student_display_name: 'Minji Kim',
      },
    },
    {
      id: 'task-session',
      room: 'task_9_3_jun_ho_b2c3d4e5',
      session_id: 'RM_task',
      metadata: {
        agent_mode: 'realtime',
        session_purpose: 'practice',
        activity_type: 'task_solution',
        student_class_number: 9,
        student_name: 'Jun Ho',
      },
    },
  ];

  const groups = groupDashboardSessions(sessions);

  assert.deepEqual(
    plain(
      groups.map((group) => ({
        label: group.label,
        sections: group.sections.map((section) => ({
          label: section.label,
          ids: section.sessions.map((session) => session.id),
        })),
      }))
    ),
    [
      { label: 'Evaluation', sections: [{ label: '9반', ids: ['eval-session'] }] },
      { label: 'Practice', sections: [{ label: '9반', ids: ['task-session'] }] },
    ]
  );
  assert.equal(getDashboardStudentLabel(sessions[0]), 'Minji Kim');
  assert.equal(getDashboardStudentLabel(sessions[1]), 'Jun Ho');
  assert.equal(inferDashboardActivityType(sessions[0]), 'free_conversation');
});

test('dashboard search matches student metadata and room fallback', () => {
  const { filterDashboardSessions } = loadDashboardHelpers();
  const sessions = [
    {
      id: '1',
      room: 'eval_9_2_minji_kim_a1b2c3d4',
      session_id: 'RM_1',
      metadata: { student_display_name: 'Minji Kim' },
    },
    {
      id: '2',
      room: 'task_9_3_jun_ho_b2c3d4e5',
      session_id: 'RM_2',
      metadata: { student_number: '20260002' },
    },
  ];

  assert.deepEqual(plain(filterDashboardSessions(sessions, 'minji').map((session) => session.id)), [
    '1',
  ]);
  assert.deepEqual(
    plain(filterDashboardSessions(sessions, 'jun_ho').map((session) => session.id)),
    ['2']
  );
});

test('dashboard grouping keeps legacy pipeline sessions under class then group', () => {
  const { groupDashboardSessions } = loadDashboardHelpers();
  const groups = groupDashboardSessions([
    {
      id: 'g1',
      room: '9반-1그룹',
      session_id: 'RM_g1',
      metadata: { agent_mode: 'pipeline' },
    },
    {
      id: 'g2',
      room: '9반-2그룹',
      session_id: 'RM_g2',
      metadata: { agent_mode: 'pipeline' },
    },
  ]);

  assert.deepEqual(
    plain(
      groups.map((group) => ({
        label: group.label,
        sections: group.sections.map((section) => ({
          label: section.label,
          ids: section.sessions.map((session) => session.id),
        })),
      }))
    ),
    [
      {
        label: '9반',
        sections: [
          { label: '1그룹', ids: ['g1'] },
          { label: '2그룹', ids: ['g2'] },
        ],
      },
    ]
  );
});
