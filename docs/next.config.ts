import type { NextConfig } from 'next';
import { createMDX } from 'fumadocs-mdx/next';
import path from 'path';

const nextConfig: NextConfig = {
  output: 'export',
  pageExtensions: ['js', 'jsx', 'md', 'mdx', 'ts', 'tsx'],
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@/content': path.resolve('./content'),
    };
    return config;
  },
};

const withMDX = createMDX();

export default withMDX(nextConfig);
