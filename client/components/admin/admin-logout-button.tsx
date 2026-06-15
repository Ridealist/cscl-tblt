'use client';

import { useState } from 'react';
import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export function AdminLogoutButton() {
  const [pending, setPending] = useState(false);

  async function handleLogout() {
    setPending(true);
    try {
      const supabase = createSupabaseBrowserClient();
      await supabase.auth.signOut();
    } finally {
      window.location.assign('/admin/login');
    }
  }

  return (
    <Button type="button" variant="ghost" size="sm" onClick={handleLogout} disabled={pending}>
      <LogOut />
      {pending ? '로그아웃 중...' : '로그아웃'}
    </Button>
  );
}
