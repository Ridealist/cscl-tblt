import { NextResponse } from 'next/server';
import { getStudentSession } from '@/lib/student-auth';

export async function GET() {
  const student = await getStudentSession();
  if (!student) {
    return NextResponse.json(
      { error: 'Student login required.' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  return NextResponse.json({ student }, { headers: { 'Cache-Control': 'no-store' } });
}
