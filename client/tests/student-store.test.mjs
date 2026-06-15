import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
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
      Buffer,
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
    filters: [],
    eq(column, value) {
      this.filters.push({ column, value });
      calls.filters.push({ table, column, value });
      return this;
    },
    or(value) {
      calls.ors.push({ table, value });
      return this;
    },
    limit(value) {
      calls.limits.push({ table, value });
      return this;
    },
    maybeSingle: async () => {
      calls.maybeSingles.push({ table, filters: query.filters });
      return options.studentResult ?? { data: null, error: null };
    },
    select(columns) {
      calls.selects.push({ table, columns });
      return this;
    },
    then(resolve, reject) {
      const result = { data: [], error: null };
      return Promise.resolve(result).then(resolve, reject);
    },
  };
  return query;
}

function loadStudentStore(options = {}) {
  const calls = {
    filters: [],
    limits: [],
    maybeSingles: [],
    ors: [],
    selects: [],
    tables: [],
  };
  const exports = loadModule(
    'lib/student-store.ts',
    (specifier) => {
      if (specifier === 'server-only') return {};
      if (specifier === 'crypto') return require('crypto');
      if (specifier === '@/lib/supabase/admin') {
        return {
          createSupabaseAdminClient: () => ({
            from(table) {
              calls.tables.push(table);
              assert.equal(table, 'students');
              return createQuery(table, options, calls);
            },
          }),
          hasSupabaseAdminEnv: () => options.hasSupabaseAdminEnv !== false,
        };
      }
      throw new Error(`Unexpected import in student store test: ${specifier}`);
    },
    { env: {} }
  );
  return { ...exports, calls };
}

const STUDENT_ROW = {
  id: '11111111-1111-4111-8111-111111111111',
  student_number: '20260001',
  name: '김민지',
  english_name: 'Minji Kim',
  class_number: 9,
  roll_number: 2,
  access_code: 'a1b2',
  active: true,
  metadata: {},
};

test('authenticateStudentLogin returns a student for matching roster name and student access code', async () => {
  const { authenticateStudentLogin, calls } = loadStudentStore({
    studentResult: { data: STUDENT_ROW, error: null },
  });

  const student = await authenticateStudentLogin({
    accessCode: ' A1B2 ',
    name: '김민지',
    studentNumber: ' 20260001 ',
  });

  assert.deepEqual(plain(student), {
    id: STUDENT_ROW.id,
    studentNumber: '20260001',
    name: '김민지',
    englishName: 'Minji Kim',
    classNumber: 9,
    rollNumber: 2,
  });
  assert.deepEqual(plain(calls.filters), [
    { table: 'students', column: 'student_number', value: '20260001' },
    { table: 'students', column: 'active', value: true },
  ]);
  assert.deepEqual(plain(calls.ors), []);
});

test('authenticateStudentLogin rejects mismatched student access codes', async () => {
  const { authenticateStudentLogin } = loadStudentStore({
    studentResult: { data: STUDENT_ROW, error: null },
  });

  await assert.rejects(
    () =>
      authenticateStudentLogin({
        accessCode: 'z9y8',
        name: 'Minji Kim',
        studentNumber: '20260001',
      }),
    (error) => error.code === 'invalid_student_login' && error.status === 401
  );
});

test('authenticateStudentLogin rejects mismatched names', async () => {
  const { authenticateStudentLogin } = loadStudentStore({
    studentResult: { data: STUDENT_ROW, error: null },
  });

  await assert.rejects(
    () =>
      authenticateStudentLogin({
        accessCode: 'a1b2',
        name: '다른학생',
        studentNumber: '20260001',
      }),
    (error) => error.code === 'invalid_student_login' && error.status === 401
  );
});

test('authenticateStudentLogin rejects missing Supabase admin env', async () => {
  const { authenticateStudentLogin } = loadStudentStore({ hasSupabaseAdminEnv: false });

  await assert.rejects(
    () =>
      authenticateStudentLogin({
        accessCode: 'a1b2',
        name: '김민지',
        studentNumber: '20260001',
      }),
    (error) => error.code === 'supabase_not_configured' && error.status === 503
  );
});
