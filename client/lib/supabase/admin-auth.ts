import { NextResponse } from 'next/server';
import 'server-only';
import type { User } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase/server';

type AdminAuthResult =
  | {
      ok: true;
      user: User;
    }
  | {
      ok: false;
      status: 401 | 403 | 500 | 503;
      error: string;
    };

export async function getAdminAuthResult(): Promise<AdminAuthResult> {
  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;

  try {
    supabase = await createSupabaseServerClient();
  } catch {
    return {
      ok: false,
      status: 503,
      error: 'Supabase authentication is not configured.',
    };
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return {
      ok: false,
      status: 401,
      error: 'Authentication required.',
    };
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();

  if (profileError) {
    return {
      ok: false,
      status: 500,
      error: 'Unable to verify admin role.',
    };
  }

  if (profile?.role !== 'admin') {
    return {
      ok: false,
      status: 403,
      error: 'Admin role required.',
    };
  }

  return {
    ok: true,
    user,
  };
}

export async function requireAdmin() {
  const auth = await getAdminAuthResult();
  if (auth.ok) {
    return null;
  }

  return NextResponse.json({ error: auth.error }, { status: auth.status });
}
