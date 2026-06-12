import { AdminLoginForm } from '@/components/admin/admin-login-form';

function normalizeNextPath(value: unknown) {
  if (typeof value !== 'string') return '/admin';
  if (!value.startsWith('/') || value.startsWith('//')) return '/admin';
  if (value === '/admin/login' || value.startsWith('/admin/login?')) return '/admin';
  if (value === '/admin/forbidden' || value.startsWith('/admin/forbidden?')) return '/admin';
  return value;
}

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const nextPath = normalizeNextPath(params.next);

  return (
    <main className="bg-background flex min-h-screen items-center justify-center px-6">
      <section className="flex w-full max-w-sm flex-col gap-8">
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground text-sm font-medium">TBLT Agent</p>
          <h1 className="text-foreground text-2xl font-semibold">관리자 로그인</h1>
        </div>
        <AdminLoginForm nextPath={nextPath} />
      </section>
    </main>
  );
}
