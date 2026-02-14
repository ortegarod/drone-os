# AI Emergency Drone Dispatch — LaunchFund Hackathon

**Event:** LaunchFund AI Meets Robotics  
**Dates:** February 10-14, 2026  
**URL:** https://lablab.ai/ai-hackathons/launch-fund-ai-meets-robotics

---

## Hackathon Requirements

**Must Have:**
- ✅ Backend on Vultr (sponsor requirement)
- ✅ Public web browser access
- ✅ Autonomous robotics in simulation
- [ ] Video demonstration
- [ ] Post on X tagging @lablabai + @Surgexyz_
- ✅ GitHub repo, slides, demo URL

**Judging Criteria:**
- Technology Application
- Presentation
- Business Value
- Originality

---

## Remaining

**Critical (Must Submit by Feb 14 EOD):**
- [ ] Record demo video (3-5 min)
- [ ] Create slides (10-15 slides)
- [ ] Clean GitHub repo
- [ ] Submit to platform
- [ ] Post on X

**Optional (If Time):**
- [ ] Auto-resolve flow
- [ ] Incident markers on map
- [ ] Frontend polish

---

## Demo

**Live URL:** http://207.148.9.142:3000

See `README.md` for what the system does and `docs/DISPATCH_ARCHITECTURE.md` for how it works.

---

## Development Timeline

### Day 1 (Feb 10)
- VPS migration (srv01 → Vultr), OpenClaw setup, Docker services deployed

### Day 2 (Feb 11)
- Dual-drone flight from cloud, camera proxy, frontend integration

### Day 3 (Feb 12)
- Dispatch service, AI bridge, autonomous dispatch pipeline
- **First successful autonomous dispatch** 🎉

### Day 4 (Feb 13)
- End-to-end testing, fixed drone2 camera, documentation overhaul

---

## Submission Materials

### Video Script Template

**Introduction (15 sec):**
"Hi, I'm [name]. This is AI Emergency Drone Dispatch — autonomous 911 response where AI flies drones to emergencies without a human pilot."

**Problem (45 sec):**
"Drone First Responder programs are growing 300%+ year-over-year. Chula Vista PD has flown 20,000+ DFR missions since 2018. But there's a bottleneck: every flight requires a certified remote pilot at $60-80/hour. With 18,000+ US agencies needing DFR, this doesn't scale."

**Solution (30 sec):**
"Our AI dispatcher eliminates the pilot bottleneck. It evaluates incident priority, selects available drones, and flies them autonomously. One AI agent can coordinate unlimited drones."

**Demo (2-3 min):**
"Let me show you. [Open frontend] This is the live dispatch center. Here's the incident queue with simulated 911 calls. I'll click RESUME... [wait for incident] There — new medical emergency. Watch the AI decide... [activity feed shows decision] Drone1 launches automatically... [camera feed shows flight] Status updates to DISPATCHED. The drone is now on scene with live video. And if an operator needs to override, they can type natural language commands right here."

**Tech (30 sec):**
"Built on Vultr VPS for the cloud command center, PX4 autopilot for flight control, OpenClaw for AI agent framework, and Tailscale VPN for secure connectivity. The AI uses a Python SDK to send flight commands through ROS2."

**Business (30 sec):**
"Market opportunity: $1.5B+ by 2030. Our edge: AI scales infinitely, pilots don't. Target: mid-size agencies needing DFR without building large pilot teams."

**Wrap (10 sec):**
"Try it live at [URL]. Code on GitHub. Thanks to @lablabai, @Surgexyz_, and Vultr. Questions?"

### Slides Outline (15 slides)

1. **Title** — Project name, tagline, your name, date
2. **The Problem** — DFR bottleneck, pilot costs, scale issues
3. **Our Solution** — AI dispatcher, autonomous execution
4. **How It Works** — Diagram: 911 → AI → drone
5. **Architecture** — VPS + simulation, cloud stack
6. **Technology Stack** — OpenClaw, PX4, Gazebo, Vultr, ROS2
7. **Demo Screenshot** — Frontend dashboard annotated
8. **Key Features** — Autonomous, multi-drone, camera feeds, override
9. **Market Opportunity** — TAM, growth, precedents
10. **Competitive Advantage** — AI vs pilots, scalability
11. **Business Model** — SaaS per agency, pricing tiers
12. **Roadmap** — MVP → hardware → pilot → commercial
13. **Team** — Background, experience, motivation
14. **Demo & Links** — Live URL, GitHub, video
15. **Thank You** — Sponsors, Q&A

### Submission Text (500 words)

**Title:** "AI Emergency Drone Dispatch — Autonomous 911 Response Without Human Pilots"

**Description:**

Drone First Responder (DFR) programs are growing 300%+ year-over-year, with 9 agencies in Ohio alone approved for DFR operations in February 2026. However, every single flight requires a certified remote pilot, creating a bottleneck that limits scale. With 18,000+ US law enforcement agencies and pilot costs at $60-80/hour, the current model is unsustainable.

**Our Solution:** AI Emergency Drone Dispatch replaces the human remote pilot with an autonomous AI agent. When a 911 call comes in, our system receives incident details, the AI agent evaluates priority and location, autonomously flies a drone to the scene, streams live camera feed to operators, and returns the drone to base after the incident. The AI makes real decisions — not scripted paths. It evaluates priority (medical emergency vs. noise complaint), assigns drones based on location and availability, and monitors flight progress. A human operator can override at any time via natural language commands, but the default is full autonomy.

**Technology:** Built on OpenClaw agent framework (WebSocket-based, framework-agnostic), PX4 autopilot + Gazebo simulation (industry standards), Vultr VPS for command center, and Tailscale VPN for secure connectivity. The frontend is React + TypeScript with real-time dashboard.

**Architecture:** The system runs on a Vultr VPS (command center) connected via Tailscale to a simulation server running dual PX4 drones in Gazebo. The dispatch service generates simulated 911 incidents. A bridge service polls for new incidents and sends them to the AI agent via WebSocket. The AI uses a Python SDK to send flight commands through ROS2/rosbridge back to the simulation. The frontend displays incident queue, live camera feeds, map, and AI activity log in real-time.

**What Makes This Different:** Most DFR demos are teleoperated or follow pre-planned routes. Our AI genuinely decides which drone to send, when to launch, and how to respond based on incident priority. It's autonomous decision-making AND autonomous execution. The framework-agnostic WebSocket interface means any AI agent can control drones through this system.

**Business Potential:** With a $1.5B+ TAM by 2030 and proven precedents like Chula Vista PD (20,000+ DFR flights since 2018), the market is real and growing. Our AI dispatcher eliminates the pilot bottleneck, enabling one agency to operate 10+ drones simultaneously with minimal human oversight.

**Live Demo:** http://207.148.9.142:3000

Built for LaunchFund AI Meets Robotics hackathon. Thanks to @lablabai, @Surgexyz_, and Vultr.

### X Post Template

```
🚁 Just built an autonomous AI drone dispatcher for 911 emergencies

When a call comes in:
• AI evaluates incident
• Selects available drone
• Flies to scene autonomously
• Streams live video to first responders

No human pilot needed.

Live demo: http://207.148.9.142:3000
Video: [link]
Code: [link]

Built for @lablabai @Surgexyz_ hackathon 🚀

#AIRobotics #AutonomousDrones #EmergencyResponse
```

---

## Key Milestones

- **Feb 10:** VPS migration complete, OpenClaw running on Vultr
- **Feb 12:** First successful autonomous dispatch 🎉
- **Feb 13:** Fixed drone2 camera, both cameras operational, documentation complete

---

## Statistics

- **Development:** 4 days, ~40 hours
- **Camera feeds:** 20-30 Hz (both drones)
- **Dispatch latency:** 5-15 seconds (incident → drone launch)
- **Languages:** Python, TypeScript, C++
- **Stack:** OpenClaw, ROS2, React, Docker, Tailscale, Vultr

---

## Post-Hackathon Roadmap

**Short-term (Feb-Mar):** Collision avoidance, incident prioritization, ETA calculation
**Medium-term (Mar-Apr):** Real hardware (Holybro X500), 4G/LTE, computer vision
**Long-term (Q2-Q3 2026):** Agency pilot program, SaaS platform, FAA compliance

---

**Last Updated:** 2026-02-13 22:23 UTC
