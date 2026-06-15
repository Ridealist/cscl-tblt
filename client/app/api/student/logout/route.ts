import { NextResponse } from 'next/server';
import { clearStudentSessionCookie } from '@/lib/student-auth';

export async function POST() {
  const response = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  clearStudentSessionCookie(response);
  return response;
}
