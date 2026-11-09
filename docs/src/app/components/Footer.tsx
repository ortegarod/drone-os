"use client";

import Link from 'next/link';
import { Separator } from '@/components/ui/separator';

export default function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-white py-12 text-slate-500">
      <div className="mx-auto max-w-6xl px-5 sm:px-6 lg:px-8">
        <Separator className="mb-8 bg-slate-200" />
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-950">DroneOS</p>
            <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
              A programmable drone SDK and command center on PX4 and ROS 2.
            </p>
          </div>

          <div className="flex flex-col items-start gap-4 text-sm md:items-end">
            <div className="flex flex-wrap gap-5">
              <a href="https://github.com/ortegarod/drone-os" className="transition-colors hover:text-slate-950" target="_blank" rel="noopener noreferrer">GitHub</a>
              <Link href="/docs/getting-started/overview" className="transition-colors hover:text-slate-950">Docs</Link>
              <Link href="/docs/roadmap/overview" className="transition-colors hover:text-slate-950">Roadmap</Link>
              <a href="https://github.com/ortegarod/drone-os/issues" className="transition-colors hover:text-slate-950" target="_blank" rel="noopener noreferrer">Issues</a>
            </div>
            <p className="text-sm">Open-source under Apache-2.0</p>
          </div>
        </div>
      </div>
    </footer>
  );
}
