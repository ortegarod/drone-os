import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Container({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn('mx-auto w-full max-w-6xl px-5 sm:px-6 lg:px-8', className)}>{children}</div>;
}

export function Section({
  className,
  surface = 'base',
  children,
}: {
  className?: string;
  surface?: 'base' | 'muted';
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        'py-20 sm:py-24 lg:py-28',
        surface === 'muted' ? 'bg-slate-50' : 'bg-background',
        className,
      )}
    >
      {children}
    </section>
  );
}

export function PageIntro({
  title,
  description,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mx-auto max-w-3xl text-center', className)}>
      <h1 className="mb-4 text-3xl font-bold tracking-tight text-foreground sm:text-4xl md:text-5xl">{title}</h1>
      {description ? (
        <p className="text-base leading-8 text-muted-foreground sm:text-lg md:text-xl">{description}</p>
      ) : null}
    </div>
  );
}
