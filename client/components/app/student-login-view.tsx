'use client';

import { FormEvent, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { StudentProfile } from '@/lib/student';

interface StudentLoginViewProps {
  onLogin: (student: StudentProfile) => void;
}

export function StudentLoginView({
  onLogin,
  ref,
}: React.ComponentProps<'div'> & StudentLoginViewProps) {
  const [studentNumber, setStudentNumber] = useState('');
  const [name, setName] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const studentNumberRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setError('');
    setSubmitting(true);

    try {
      const res = await fetch('/api/student/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_code: accessCode,
          name,
          student_number: studentNumber,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data.error === 'string' ? data.error : '학생 정보를 확인할 수 없습니다.'
        );
      }
      onLogin(data.student);
    } catch (err) {
      setError(err instanceof Error ? err.message : '학생 로그인을 완료하지 못했습니다.');
      studentNumberRef.current?.focus();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div ref={ref} className="mx-auto flex w-full max-w-sm flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-foreground text-xl font-semibold">TBLT Agent</h1>
        <p className="text-muted-foreground text-sm">학번과 access code로 입장하세요.</p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-foreground text-sm font-semibold">학번</span>
          <input
            ref={studentNumberRef}
            value={studentNumber}
            onChange={(event) => {
              setStudentNumber(event.target.value);
              setError('');
            }}
            autoComplete="username"
            className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-primary rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2"
            placeholder="예: 20260001"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-foreground text-sm font-semibold">이름</span>
          <input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setError('');
            }}
            autoComplete="name"
            className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-primary rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2"
            placeholder="예: 김민지"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-foreground text-sm font-semibold">Access code</span>
          <input
            value={accessCode}
            onChange={(event) => {
              setAccessCode(event.target.value);
              setError('');
            }}
            autoComplete="one-time-code"
            className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-primary rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2"
            placeholder="수업 access code"
          />
        </label>

        {error && <p className="text-destructive text-xs">{error}</p>}

        <Button
          type="submit"
          size="lg"
          disabled={submitting}
          className="w-full rounded-full font-mono text-xs font-bold tracking-wider uppercase"
        >
          {submitting ? 'CHECKING...' : 'START CHAT'}
        </Button>
      </form>
    </div>
  );
}
