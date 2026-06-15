import { cookies } from 'next/headers';
import type { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import 'server-only';
import type { StudentProfile } from '@/lib/student';

export const STUDENT_SESSION_COOKIE = 'student_session';
const STUDENT_SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

export type StudentSession = StudentProfile & {
  issuedAt: number;
  expiresAt: number;
};

function sessionSecret() {
  const secret =
    process.env.STUDENT_SESSION_SECRET?.trim() ||
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!secret) {
    throw new Error('Missing student session secret.');
  }
  return secret;
}

function base64UrlEncode(value: string) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function sign(payload: string) {
  return createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function createSession(student: StudentProfile): StudentSession {
  const now = Math.floor(Date.now() / 1000);
  return {
    ...student,
    issuedAt: now,
    expiresAt: now + STUDENT_SESSION_MAX_AGE_SECONDS,
  };
}

function serializeSession(session: StudentSession) {
  const payload = base64UrlEncode(JSON.stringify(session));
  return `${payload}.${sign(payload)}`;
}

function parseSession(value: string): StudentSession | null {
  const [payload, signature] = value.split('.');
  if (!payload || !signature || !safeEqual(sign(payload), signature)) return null;

  try {
    const parsed = JSON.parse(base64UrlDecode(payload)) as Partial<StudentSession>;
    if (
      typeof parsed.id !== 'string' ||
      typeof parsed.studentNumber !== 'string' ||
      typeof parsed.name !== 'string' ||
      typeof parsed.classNumber !== 'number' ||
      typeof parsed.rollNumber !== 'number' ||
      typeof parsed.expiresAt !== 'number' ||
      parsed.expiresAt <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return parsed as StudentSession;
  } catch {
    return null;
  }
}

export function setStudentSessionCookie(response: NextResponse, student: StudentProfile) {
  response.cookies.set(STUDENT_SESSION_COOKIE, serializeSession(createSession(student)), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: STUDENT_SESSION_MAX_AGE_SECONDS,
  });
}

export function clearStudentSessionCookie(response: NextResponse) {
  response.cookies.set(STUDENT_SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
}

export async function getStudentSession(): Promise<StudentSession | null> {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(STUDENT_SESSION_COOKIE);
  return cookie?.value ? parseSession(cookie.value) : null;
}
