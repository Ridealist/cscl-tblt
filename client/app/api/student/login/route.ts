import { NextResponse } from 'next/server';
import { setStudentSessionCookie } from '@/lib/student-auth';
import { StudentStoreError, authenticateStudentLogin } from '@/lib/student-store';

function errorResponse(error: unknown) {
  if (error instanceof StudentStoreError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  return NextResponse.json({ error: '학생 로그인에 실패했습니다.' }, { status: 500 });
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const student = await authenticateStudentLogin({
      accessCode: typeof body?.access_code === 'string' ? body.access_code : '',
      name: typeof body?.name === 'string' ? body.name : '',
      studentNumber: typeof body?.student_number === 'string' ? body.student_number : '',
    });
    const response = NextResponse.json({ student }, { headers: { 'Cache-Control': 'no-store' } });
    setStudentSessionCookie(response, student);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
