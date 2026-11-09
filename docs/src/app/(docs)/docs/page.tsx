'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function DocsIndex() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/docs/getting-started/overview');
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">
      <a href="/docs/getting-started/overview">Redirecting to documentation…</a>
    </div>
  );
}
