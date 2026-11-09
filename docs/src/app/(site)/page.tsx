import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Container, Section } from '@/components/site/marketing';

const buildingBlocks = [
  {
    title: 'C++ & Python SDK',
    desc: 'High-level ROS 2 services in drone_core and a Python SDK + CLI for arming, takeoff, navigation, orbits, patrols, and state inspection.',
  },
  {
    title: 'Command Center & Fleet API',
    desc: 'Run the command center on any server. Operators and scripts share one API with pilot control holds, geofences, live telemetry, and flight logs.',
  },
  {
    title: 'Jobs as Plugins',
    desc: 'Extend what drones do with self-contained job plugins—Patrol, Dispatch, Inspect, Search, and Follow—installed live without restarting the stack.',
  },
  {
    title: 'AI Agent Ready',
    desc: 'An AI agent on the same box can fly drones and dispatch missions through the Fleet API, the droneos CLI, or the MCP server.',
  },
  {
    title: 'Simulation First',
    desc: 'Develop and verify missions end-to-end in PX4 SITL and Gazebo before flying real aircraft.',
  },
  {
    title: 'Real Hardware',
    desc: 'Move the exact same control model to a Pixhawk flight controller and companion computer over VPN or cellular backhaul.',
  },
];

export default function Home() {
  return (
    <main>
      <Section className="overflow-hidden border-b border-slate-200/80 bg-white pt-28 pb-18 sm:pb-20 lg:pt-32">
        <Container>
          <div className="grid items-center gap-12 lg:grid-cols-[1.02fr_0.98fr] lg:gap-16">
            <div className="max-w-2xl">
              <p className="mb-4 text-xs font-semibold uppercase tracking-[0.28em] text-sky-600 sm:text-sm">
                Open-Source Drone Stack
              </p>
              <h1 className="max-w-3xl text-4xl font-semibold tracking-[-0.04em] text-slate-950 sm:text-5xl md:text-6xl">
                A programmable drone SDK and command center on PX4 and ROS 2.
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-8 text-slate-600 md:text-xl">
                Run the command center on any server, and fly simulated or real PX4 drones from Python, the CLI, the web UI, or an AI agent through the API, CLI, or MCP.
              </p>
              <div className="mt-8 flex flex-wrap gap-4">
                <Button asChild size="lg" className="rounded-full px-6">
                  <Link href="/docs/getting-started/overview">Read the Docs</Link>
                </Button>
                <Button asChild variant="outline" size="lg" className="rounded-full px-6">
                  <a href="https://github.com/ortegarod/drone-os" target="_blank" rel="noopener noreferrer">View on GitHub</a>
                </Button>
              </div>
              <div className="mt-10 flex flex-wrap gap-6 text-sm text-slate-500">
                <div>
                  <span className="block text-2xl font-semibold tracking-tight text-slate-950">Simulate</span>
                  PX4 SITL + Gazebo
                </div>
                <div>
                  <span className="block text-2xl font-semibold tracking-tight text-slate-950">Deploy</span>
                  Pixhawk + companion compute
                </div>
                <div>
                  <span className="block text-2xl font-semibold tracking-tight text-slate-950">Operate</span>
                  API, CLI, MCP, Web UI
                </div>
              </div>
            </div>

            <div className="lg:pl-4">
              <div className="overflow-hidden rounded-[2rem] border border-slate-200 bg-slate-950 shadow-[0_32px_80px_rgba(15,23,42,0.18)] ring-1 ring-slate-950/5">
                <img src="/demo.gif" alt="DroneOS command center and autonomous dispatch demo" className="w-full" />
              </div>
            </div>
          </div>
        </Container>
      </Section>

      <Section surface="muted" className="border-b border-slate-200/70">
        <Container className="max-w-6xl">
          <div className="mb-14 text-center">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-sky-600">Architecture</p>
            <h2 className="mb-4 text-3xl font-semibold tracking-tight text-slate-950 md:text-4xl">
              PX4 flies the aircraft. DroneOS makes it programmable.
            </h2>
            <p className="mx-auto max-w-3xl text-base leading-8 text-slate-600 sm:text-lg">
              Keep flight-critical stabilization and failsafes in PX4 while exposing clean interfaces for telemetry, mission plugins, operator control, and autonomous dispatch.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {buildingBlocks.map((item) => (
              <Card key={item.title} className="h-full rounded-[1.75rem] border-slate-200 bg-white shadow-sm transition-colors hover:border-sky-500/30">
                <CardContent className="p-6">
                  <h3 className="mb-3 text-lg font-semibold tracking-tight text-slate-950">{item.title}</h3>
                  <p className="text-sm leading-7 text-slate-600">{item.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </Container>
      </Section>
    </main>
  );
}
