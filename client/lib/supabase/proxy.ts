import { type NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import type { User } from '@supabase/supabase-js';
import { getSupabasePublicEnv, hasSupabasePublicEnv } from '@/lib/supabase/env';

type MiddlewareSupabaseContext = {
  supabase: ReturnType<typeof createServerClient>;
  response: NextResponse;
};

type AdminRequestAuth =
  | {
      ok: true;
      response: NextResponse;
      user: User;
    }
  | {
      ok: false;
      response: NextResponse;
      user: User | null;
      status: 401 | 403 | 500 | 503;
      error: string;
    };

function createMiddlewareSupabaseClient(request: NextRequest): MiddlewareSupabaseContext | null {
  if (!hasSupabasePublicEnv()) {
    return null;
  }

  const { url, publishableKey } = getSupabasePublicEnv();
  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  return { supabase, response };
}

export async function updateSupabaseSession(request: NextRequest) {
  const context = createMiddlewareSupabaseClient(request);
  if (!context) {
    return NextResponse.next({ request });
  }

  await context.supabase.auth.getUser();
  return context.response;
}

export async function getAdminAuthFromRequest(request: NextRequest): Promise<AdminRequestAuth> {
  const context = createMiddlewareSupabaseClient(request);
  if (!context) {
    return {
      ok: false,
      response: NextResponse.next({ request }),
      user: null,
      status: 503,
      error: 'Supabase authentication is not configured.',
    };
  }

  const { supabase, response } = context;
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return {
      ok: false,
      response,
      user: null,
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
      response,
      user,
      status: 500,
      error: 'Unable to verify admin role.',
    };
  }

  if (profile?.role !== 'admin') {
    return {
      ok: false,
      response,
      user,
      status: 403,
      error: 'Admin role required.',
    };
  }

  return {
    ok: true,
    response,
    user,
  };
}
