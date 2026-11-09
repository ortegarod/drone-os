import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

export function baseOptions(): BaseLayoutProps {
  return {
    githubUrl: 'https://github.com/ortegarod/drone-os',
    nav: {
      title: (
        <span className="inline-flex items-center gap-2 font-semibold">
          <img
            src="/droneos-logo.svg"
            alt=""
            width="28"
            height="28"
            className="h-7 w-7 rounded-md"
          />
          <span>DroneOS</span>
        </span>
      ),
    },
  };
}
