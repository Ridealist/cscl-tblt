'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export function AdminLoginForm({ nextPath }: { nextPath: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const supabase = createSupabaseBrowserClient();
      const { data, error: loginError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (loginError || !data.user) {
        throw new Error(loginError?.message ?? '로그인에 실패했습니다.');
      }

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('role')
        .eq('user_id', data.user.id)
        .maybeSingle();

      if (profileError) {
        throw new Error('관리자 권한을 확인하지 못했습니다.');
      }

      if (profile?.role !== 'admin') {
        await supabase.auth.signOut();
        setError('관리자 권한이 없는 계정입니다.');
        return;
      }

      router.replace(nextPath);
      router.refresh();
    } catch (loginError) {
      const message =
        loginError instanceof Error ? loginError.message : '로그인 중 오류가 발생했습니다.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="admin-email" className="text-foreground text-sm font-medium">
          이메일
        </label>
        <input
          id="admin-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={submitting}
          required
          className="border-input bg-background text-foreground focus:ring-ring h-10 rounded-md border px-3 text-sm transition-shadow outline-none focus:ring-2 disabled:opacity-60"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="admin-password" className="text-foreground text-sm font-medium">
          비밀번호
        </label>
        <input
          id="admin-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={submitting}
          required
          className="border-input bg-background text-foreground focus:ring-ring h-10 rounded-md border px-3 text-sm transition-shadow outline-none focus:ring-2 disabled:opacity-60"
        />
      </div>

      {error && (
        <p className="border-destructive/30 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm">
          {error}
        </p>
      )}

      <Button type="submit" disabled={submitting} className="w-full">
        <LogIn />
        {submitting ? '로그인 중...' : '로그인'}
      </Button>
    </form>
  );
}
