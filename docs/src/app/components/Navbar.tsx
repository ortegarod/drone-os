"use client";

import React, { useState } from 'react';
import Link from 'next/link';

export default function Navbar() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <nav className="fixed inset-x-0 top-0 z-50 border-b border-slate-200/80 bg-white/88 backdrop-blur-xl supports-[backdrop-filter]:bg-white/75">
      <div className="mx-auto max-w-6xl px-5 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between gap-6">
          <Link href="/" className="text-slate-950 no-underline transition-transform hover:scale-[1.01]" aria-label="DroneOS home">
            <div className="flex items-center gap-3">
              <img src="/droneos-logo.svg" alt="DroneOS logo" width="36" height="36" className="h-9 w-9 rounded-md" />
              <span className="font-bold text-xl tracking-[0.12em] text-slate-950">DroneOS</span>
            </div>
          </Link>

          <div className="hidden items-center md:flex">
            <div className="flex items-center gap-7 text-sm font-medium text-slate-600">
              <Link href="/" className="no-underline transition-colors hover:text-slate-950">Home</Link>
              <Link href="/docs/getting-started/overview" className="no-underline transition-colors hover:text-slate-950">Docs</Link>
              <Link href="/docs/roadmap/overview" className="no-underline transition-colors hover:text-slate-950">Roadmap</Link>
              <a
                href="https://github.com/ortegarod/drone-os"
                className="inline-flex items-center rounded-full border border-slate-300 bg-white px-4 py-2 text-slate-900 no-underline transition-all hover:border-slate-400 hover:bg-slate-50"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="GitHub repository"
              >
                <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" className="mr-3 shrink-0">
                  <path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
                </svg>
                <span className="leading-none">GitHub</span>
              </a>
            </div>
          </div>

          <button
            onClick={() => setIsOpen(!isOpen)}
            type="button"
            className="inline-flex cursor-pointer items-center justify-center rounded-md border border-slate-200 bg-white p-2 text-slate-600 transition-all hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950 md:hidden"
            aria-controls="mobile-menu"
            aria-expanded={isOpen}
          >
            <span className="sr-only">Open main menu</span>
            <span className="text-sm font-medium tracking-wide text-slate-950">{isOpen ? 'CLOSE' : 'MENU'}</span>
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="border-t border-slate-200 bg-white px-5 py-4 shadow-lg md:hidden" id="mobile-menu">
          <div className="flex flex-col gap-1">
            <Link href="/" className="block rounded-md px-3 py-2 text-base font-medium text-slate-700 no-underline transition-all hover:bg-slate-100 hover:text-slate-950">Home</Link>
            <Link href="/docs/getting-started/overview" className="block rounded-md px-3 py-2 text-base font-medium text-slate-700 no-underline transition-all hover:bg-slate-100 hover:text-slate-950">Docs</Link>
            <Link href="/docs/roadmap/overview" className="block rounded-md px-3 py-2 text-base font-medium text-slate-700 no-underline transition-all hover:bg-slate-100 hover:text-slate-950">Roadmap</Link>
            <a href="https://github.com/ortegarod/drone-os" className="flex items-center rounded-md px-3 py-2 text-base font-medium text-slate-700 no-underline transition-all hover:bg-slate-100 hover:text-slate-950" target="_blank" rel="noopener noreferrer">
              <span>GitHub</span>
            </a>
          </div>
        </div>
      )}
    </nav>
  );
}
