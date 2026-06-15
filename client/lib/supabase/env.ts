export interface SupabasePublicEnv {
  url: string;
  publishableKey: string;
}

function readPublicEnv(): Partial<SupabasePublicEnv> {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL?.trim(),
    publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim(),
  };
}

export function hasSupabasePublicEnv(): boolean {
  const env = readPublicEnv();
  return Boolean(env.url && env.publishableKey);
}

export function getSupabasePublicEnv(): SupabasePublicEnv {
  const { url, publishableKey } = readPublicEnv();

  if (!url || !publishableKey) {
    const missing = [
      url ? null : 'NEXT_PUBLIC_SUPABASE_URL',
      publishableKey ? null : 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    ].filter(Boolean);
    throw new Error(`Missing Supabase environment variables: ${missing.join(', ')}`);
  }

  return {
    url,
    publishableKey,
  };
}
