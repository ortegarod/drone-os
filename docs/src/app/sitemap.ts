import type { MetadataRoute } from 'next';
import { source } from '@/lib/source';

export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  const docsPages = source.getPages().map((page) => ({
    url: `https://docs.droneos.dev${page.url}`,
    changeFrequency: 'weekly' as const,
    priority: 0.8,
  }));

  return [
    {
      url: 'https://droneos.dev',
      changeFrequency: 'weekly',
      priority: 1.0,
    },
    ...docsPages,
  ];
}
