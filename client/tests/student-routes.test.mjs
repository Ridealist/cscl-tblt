import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');

class FakeNextResponse {
  constructor(body = null, init = {}) {
    this.body = body;
    this.status = init.status ?? 200;
    this.cookies = {
      values: [],
      set: (name, value, options) => {
        this.cookies.values.push({ name, value, options });
      },
    };
  }

  static json(data, init = {}) {
    const response = new FakeNextResponse(JSON.stringify(data), { status: init.status ?? 200 });
    response.jsonBody = data;
    return response;
  }
}

class StudentStoreError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

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
      exports: module.exports,
      module,
      require: requireMock,
    },
    { filename: relativePath }
  );
  return module.exports;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

const STUDENT = {
  id: 'student-id',
  studentNumber: '20260001',
  name: '김민지',
  englishName: 'Minji Kim',
  classNumber: 9,
  rollNumber: 2,
};

function loadStudentLoginRoute(options = {}) {
  const calls = {
    authenticate: [],
    setCookie: [],
  };
  const exports = loadModule('app/api/student/login/route.ts', (specifier) => {
    if (specifier === 'next/server') return { NextResponse: FakeNextResponse };
    if (specifier === '@/lib/student-auth') {
      return {
        setStudentSessionCookie: (response, student) => {
          calls.setCookie.push({ response, student });
          response.cookies.set('student_session', 'signed-cookie', { httpOnly: true });
        },
      };
    }
    if (specifier === '@/lib/student-store') {
      return {
        StudentStoreError,
        authenticateStudentLogin: async (input) => {
          calls.authenticate.push(input);
          if (options.error) throw options.error;
          return options.student ?? STUDENT;
        },
      };
    }
    throw new Error(`Unexpected import in student login route test: ${specifier}`);
  });
  return { ...exports, calls };
}

function loadStudentMeRoute(options = {}) {
  const exports = loadModule('app/api/student/me/route.ts', (specifier) => {
    if (specifier === 'next/server') return { NextResponse: FakeNextResponse };
    if (specifier === '@/lib/student-auth') {
      return {
        getStudentSession: async () =>
          Object.prototype.hasOwnProperty.call(options, 'student') ? options.student : STUDENT,
      };
    }
    throw new Error(`Unexpected import in student me route test: ${specifier}`);
  });
  return exports;
}

function loadStudentLogoutRoute() {
  const calls = { clearCookie: 0 };
  const exports = loadModule('app/api/student/logout/route.ts', (specifier) => {
    if (specifier === 'next/server') return { NextResponse: FakeNextResponse };
    if (specifier === '@/lib/student-auth') {
      return {
        clearStudentSessionCookie: (response) => {
          calls.clearCookie += 1;
          response.cookies.set('student_session', '', { maxAge: 0 });
        },
      };
    }
    throw new Error(`Unexpected import in student logout route test: ${specifier}`);
  });
  return { ...exports, calls };
}

test('POST /api/student/login authenticates and sets the student session cookie', async () => {
  const { POST, calls } = loadStudentLoginRoute();

  const response = await POST({
    json: async () => ({
      access_code: 'a1b2',
      name: '김민지',
      student_number: '20260001',
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(plain(response.jsonBody), { student: STUDENT });
  assert.deepEqual(plain(calls.authenticate), [
    {
      accessCode: 'a1b2',
      name: '김민지',
      studentNumber: '20260001',
    },
  ]);
  assert.equal(calls.setCookie.length, 1);
  assert.equal(response.cookies.values[0].name, 'student_session');
});

test('POST /api/student/login maps store errors', async () => {
  const { POST } = loadStudentLoginRoute({
    error: new StudentStoreError(401, 'invalid_student_login', '학생 정보를 확인할 수 없습니다.'),
  });

  const response = await POST({ json: async () => ({}) });

  assert.equal(response.status, 401);
  assert.deepEqual(plain(response.jsonBody), {
    error: '학생 정보를 확인할 수 없습니다.',
    code: 'invalid_student_login',
  });
});

test('GET /api/student/me returns the current student session', async () => {
  const { GET } = loadStudentMeRoute();

  const response = await GET();

  assert.equal(response.status, 200);
  assert.deepEqual(plain(response.jsonBody), { student: STUDENT });
});

test('GET /api/student/me rejects anonymous students', async () => {
  const { GET } = loadStudentMeRoute({ student: null });

  const response = await GET();

  assert.equal(response.status, 401);
});

test('POST /api/student/logout clears the student session cookie', async () => {
  const { POST, calls } = loadStudentLogoutRoute();

  const response = await POST();

  assert.equal(response.status, 200);
  assert.deepEqual(plain(response.jsonBody), { ok: true });
  assert.equal(calls.clearCookie, 1);
  assert.equal(response.cookies.values[0].options.maxAge, 0);
});
