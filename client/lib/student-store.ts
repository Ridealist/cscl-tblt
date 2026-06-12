import { timingSafeEqual } from 'crypto';
import 'server-only';
import type { StudentProfile } from '@/lib/student';
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from '@/lib/supabase/admin';

const STUDENT_COLUMNS =
  'id,student_number,name,english_name,class_number,roll_number,active,access_code,metadata';

type StudentRow = {
  id?: unknown;
  student_number?: unknown;
  name?: unknown;
  english_name?: unknown;
  class_number?: unknown;
  roll_number?: unknown;
  active?: unknown;
  access_code?: unknown;
};

export class StudentStoreError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'StudentStoreError';
    this.status = status;
    this.code = code;
  }
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeName(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeStudentNumber(value: string) {
  return value.trim().replace(/\s+/g, '');
}

function normalizeAccessCode(value: string) {
  return value.trim().toLowerCase();
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function invalidLoginError() {
  return new StudentStoreError(401, 'invalid_student_login', '학생 정보를 확인할 수 없습니다.');
}

function studentFromRow(row: StudentRow): StudentProfile | null {
  const id = text(row.id);
  const studentNumber = text(row.student_number);
  const name = text(row.name);
  const classNumber =
    typeof row.class_number === 'number' ? row.class_number : Number(row.class_number);
  const rollNumber =
    typeof row.roll_number === 'number' ? row.roll_number : Number(row.roll_number);
  if (
    !id ||
    !studentNumber ||
    !name ||
    !Number.isFinite(classNumber) ||
    !Number.isFinite(rollNumber)
  ) {
    return null;
  }

  return {
    id,
    studentNumber,
    name,
    ...(text(row.english_name) ? { englishName: text(row.english_name) } : {}),
    classNumber,
    rollNumber,
  };
}

function nameMatches(student: StudentProfile, inputName: string) {
  const normalizedInput = normalizeName(inputName);
  return [student.name, student.englishName].some(
    (candidate) => candidate && normalizeName(candidate) === normalizedInput
  );
}

function accessCodeMatches(row: StudentRow, inputAccessCode: string) {
  const storedAccessCode = text(row.access_code);
  return Boolean(
    storedAccessCode && safeEqual(storedAccessCode, normalizeAccessCode(inputAccessCode))
  );
}

export async function authenticateStudentLogin({
  accessCode,
  name,
  studentNumber,
}: {
  accessCode: string;
  name: string;
  studentNumber: string;
}): Promise<StudentProfile> {
  const normalizedStudentNumber = normalizeStudentNumber(studentNumber);
  const normalizedName = text(name);
  const normalizedAccessCode = text(accessCode);
  if (!normalizedStudentNumber || !normalizedName || !normalizedAccessCode) {
    throw invalidLoginError();
  }
  if (!hasSupabaseAdminEnv()) {
    throw new StudentStoreError(
      503,
      'supabase_not_configured',
      'Supabase student login is not configured.'
    );
  }

  const supabase = createSupabaseAdminClient();
  const { data: studentRow, error: studentError } = await supabase
    .from('students')
    .select(STUDENT_COLUMNS)
    .eq('student_number', normalizedStudentNumber)
    .eq('active', true)
    .maybeSingle();
  if (studentError) {
    throw new StudentStoreError(500, 'student_read_failed', '학생 정보를 불러오지 못했습니다.');
  }

  const student = studentRow ? studentFromRow(studentRow as StudentRow) : null;
  if (!student || !nameMatches(student, normalizedName)) {
    throw invalidLoginError();
  }

  if (!accessCodeMatches(studentRow as StudentRow, normalizedAccessCode)) throw invalidLoginError();

  return student;
}
