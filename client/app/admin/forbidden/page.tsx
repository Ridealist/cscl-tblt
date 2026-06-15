import Link from 'next/link';
import { AdminLogoutButton } from '@/components/admin/admin-logout-button';

export default function AdminForbiddenPage() {
  return (
    <main className="bg-background flex min-h-screen items-center justify-center px-6">
      <section className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground text-sm font-medium">CSCL TBLT</p>
          <h1 className="text-foreground text-2xl font-semibold">관리자 권한 필요</h1>
          <p className="text-muted-foreground text-sm">로그인된 계정에 관리자 권한이 없습니다.</p>
        </div>
        <div className="flex items-center gap-2">
          <AdminLogoutButton />
          <Link
            href="/"
            className="text-muted-foreground hover:text-foreground text-sm transition-colors"
          >
            학생 화면으로 이동
          </Link>
        </div>
      </section>
    </main>
  );
}
