# DroneOS Development Roadmap

---

## Vision

**AI-Powered Emergency Drone Dispatch**

911 calls come in → AI dispatches drones autonomously → live video to first responders → no human pilot needed.

---

## Architecture

```
┌──────────────────────────────────────────┐
│           VPS (Cloud Command Center)     │
│                                          │
│  dispatch_service (Python)               │
│    • generates 911 incidents             │
│    • tracks fleet state                  │
│    • sends incidents to AI               │
│              │                           │
│              ▼                           │
│  Cloud Agent (OpenClaw — "Ada")         │
│    • fleet-level planning & dispatch     │
│    • operator interface (web + Telegram) │
│    • delegates to local agents           │
│              │                           │
│         rosbridge (:9090)                │
│          ▲          ▲                    │
│          │          │ VPN                │
│     Frontend      Simulation/Hardware    │
│     (:3000)       ┌──────────────────┐  │
│                   │ Local Agent      │  │
│                   │ (OpenClaw@drone-dev) │  │
│                   │ • direct ROS 2   │  │
│                   │ • PX4/Docker ops │  │
│                   │ • low-latency    │  │
│                   │   drone control  │  │
│                   └──────────────────┘  │
│                   drone_core (multi)     │
│                   cameras                │
└──────────────────────────────────────────┘
```

**Key Principles:**
- **Two-tier AI:** Cloud brain (fleet command) + local agent (drone-level ops)
- **Framework-agnostic:** AI agent communicates via WebSocket (any framework can integrate)
- **Cloud-native:** Command center runs in cloud, drones anywhere (simulation or real hardware)
- **Autonomous:** AI makes decisions AND executes commands (not teleoperation)
- **Scalable:** One cloud agent coordinates unlimited drones via local agents

---

## Development Phases

| Phase | Timeline | Goal | Status |
|-------|----------|------|--------|
| **1. Hackathon MVP** | Feb 10-14, 2026 | Cloud dispatch demo in simulation | ✅ Complete |
| **1.5 Local Agent** | Feb-Mar 2026 | OpenClaw agent on drone-dev, two-tier architecture | ⏳ Planned |
| **2. Multi-Drone** | Feb-Mar 2026 | Coverage optimization, collision avoidance | 🔄 In Progress |
| **3. Real Hardware** | Mar-Apr 2026 | Deploy to Holybro X500 over 4G | ⏳ Planned |
| **4. Advanced Autonomy** | Q2 2026 | Computer vision, adaptive planning | ⏳ Planned |
| **5. Pilot Program** | Q3 2026 | Partner with 1-2 agencies | ⏳ Planned |
| **6. Commercialization** | Q4 2026+ | SaaS platform, multi-tenant, FAA compliance | ⏳ Planned |

---

## Current Status

**What Works (as of Feb 13, 2026):**
- ✅ Autonomous dispatch pipeline (incident → AI decision → drone flight)
- ✅ Dual-drone coordination in simulation
- ✅ Live camera feeds (multiple drones)
- ✅ Real-time frontend dashboard
- ✅ Manual operator override (natural language)
- ✅ Cloud architecture (VPS + Tailscale VPN)

**What's Next:**
- Multi-drone collision avoidance
- Advanced incident prioritization
- Real hardware integration (Holybro X500)
- Computer vision for scene assessment
- Pilot program with law enforcement

---

## Business Model

### Target Market
- **Primary:** Mid-size law enforcement agencies (100k-500k population)
- **Secondary:** Fire departments, EMS, search & rescue
- **TAM:** $1.5B+ by 2030
- **Addressable:** 18,000+ US law enforcement agencies

### Revenue Model
**SaaS Subscription per Agency:**
- **Starter:** 1-3 drones, 1 operator seat → $500/month
- **Professional:** 4-10 drones, 3 operator seats → $2,000/month
- **Enterprise:** Unlimited drones, unlimited operators → Custom pricing

**Additional Revenue:**
- Custom integrations (CAD systems, 911 centers)
- Training & onboarding
- Hardware recommendations/partnerships
- Advanced analytics & reporting

### Competitive Advantage
- **AI scales infinitely, pilots don't:** One AI agent = unlimited drones
- **Framework-agnostic:** Works with any AI agent (not locked to one vendor)
- **Open-source robotics:** Built on PX4 + ROS2 (industry standards)
- **Cloud-native:** No expensive local infrastructure needed

### Market Precedents
- **Chula Vista PD:** 20,000+ DFR flights since 2018
- **Ohio:** 9 agencies approved for DFR (Feb 2026)
- **DFR growth:** 300%+ year-over-year

---

## Technical Roadmap

### Phase 1.5: Local Agent on drone-dev (Feb-Mar 2026)

**Goals:**
- Install OpenClaw agent directly on drone-dev (simulation server)
- Eliminate rosbridge relay bottleneck — agent has direct ROS 2 access
- Cloud agent (Ada/VPS) delegates drone-level ops to local agent
- Local agent handles: PX4 recovery, Docker restarts, sensor debugging, direct flight control

**Why:**
Right now Ada (cloud agent) SSHes into drone-dev and relays everything through rosbridge over Tailscale. It works, but it's a workaround. A local agent has direct access to ROS 2 topics, PX4, Docker, and the full simulation stack — lower latency, better reliability, real-time reaction.

**Architecture:**
- **Cloud agent (VPS):** Fleet-level decisions, operator interface, incident dispatch, multi-drone coordination
- **Local agent (drone-dev):** Drone-level execution, infrastructure ops, sensor monitoring, failsafe handling
- Communication: OpenClaw inter-agent sessions or direct API

**Tasks:**
- [ ] Install OpenClaw on drone-dev
- [ ] Configure local agent with drone-ops skill (ROS 2 commands, Docker management)
- [ ] Set up inter-agent communication (cloud ↔ local)
- [ ] Migrate drone_control.py calls from SSH relay to local agent execution
- [ ] Test: cloud agent dispatches, local agent executes flight
- [ ] Failover: local agent acts independently if cloud connection drops

---

### Phase 2: Multi-Drone Coordination (Q1 2026)

**Goals:**
- 5+ drones coordinated simultaneously
- Collision avoidance (dynamic deconfliction)
- Coverage optimization (assign closest available drone)
- Battery management (auto-return for charging)

**Tasks:**
- [ ] Implement spatial deconfliction algorithm
- [ ] Battery state tracking and prediction
- [ ] Fleet-wide mission planning
- [ ] Incident queue prioritization logic
- [ ] Multi-drone test scenarios

### Phase 3: Real Hardware (Q2 2026)

**Goals:**
- Deploy to Holybro X500 with Pixhawk
- 4G/LTE connectivity (no local WiFi)
- Outdoor flight testing
- Failsafe verification

**Tasks:**
- [ ] 4G modem integration (ROS2 bridge over cellular)
- [ ] GPS/RTK setup for precise positioning
- [ ] Failsafe testing (link loss, low battery, geofence)
- [ ] Flight test protocols (incremental risk)
- [ ] Camera gimbal integration

### Phase 4: Advanced Autonomy — Edge AI & Vision (Q2-Q3 2026)

**Goals:**
- On-drone computer vision via Google Coral Edge TPU
- Local agent processes camera feed in real-time, no cloud roundtrip
- Adaptive mission planning (dynamic replanning)
- Scene assessment and natural language incident reports

**Existing Work:** `src/object_detector/` — Edge TPU integration already built:
- `edge_tpu_detector.py` — reusable detection class (PyCoral)
- `camera_object_detector.py` — real-time Pi Camera + Coral pipeline
- Tested with Google Coral USB Accelerator on Raspberry Pi
- See `src/object_detector/README.md` and `SETUP_GUIDE.md`

**Tasks:**
- [ ] Integrate object detector with local drone agent (agent reacts to detections)
- [ ] Object detection models: person, vehicle, fire, smoke
- [ ] Scene summarization — local agent describes what it sees, reports to cloud agent
- [ ] Path replanning for obstacles/no-fly zones
- [ ] Voice interface for operators
- [ ] Anomaly detection (unexpected events)

### Phase 5: Pilot Program (Q3 2026)

**Goals:**
- Partner with 1-2 agencies for real-world testing
- Validate operational procedures
- Gather feedback for product-market fit
- Build case studies for sales

**Tasks:**
- [ ] Identify partner agencies (mid-size, progressive)
- [ ] FAA waiver/approval process
- [ ] Training program for operators
- [ ] Operational protocols (when to dispatch, escalation)
- [ ] Metrics collection (response time, outcomes)

### Phase 6: Commercialization (Q4 2026+)

**Goals:**
- Multi-tenant SaaS platform
- 10+ agency customers
- FAA compliance pathway
- Scalable infrastructure

**Tasks:**
- [ ] Multi-tenant architecture (data isolation, RBAC)
- [ ] Billing & subscription management
- [ ] Customer onboarding automation
- [ ] Compliance documentation (FAA Part 107, Part 135 pathway)
- [ ] Sales & marketing strategy

---

## Open Questions

### Technical
- **Battery swapping:** Manual or automated? (Affects operational tempo)
- **Night operations:** Thermal cameras? Lighting? (Regulatory implications)
- **Weather limits:** Wind, rain thresholds? (Need testing data)
- **Communication backup:** Satellite fallback for cell dead zones?

### Business
- **Insurance:** Who covers drone crashes? Agency or SaaS provider?
- **Liability:** If AI makes wrong decision, who's responsible?
- **Pricing:** Per-drone or per-incident? Hybrid model?
- **Hardware:** Sell drones or hardware-agnostic?

### Regulatory
- **FAA approval:** Part 107 waiver or Part 135 (drone airline)?
- **Beyond Visual Line of Sight (BVLOS):** Required for scale, hard to get
- **Privacy:** Video retention, FOIA requests, consent?
- **Local laws:** City/county ordinances vary widely

---

## Dependencies

**Critical Path:**
1. ✅ Working simulation (hackathon MVP)
2. Multi-drone coordination algorithms
3. Real hardware integration
4. FAA approval (BVLOS waiver)
5. Pilot program success
6. Product-market fit validation

**Risks:**
- **Regulatory:** FAA approval can take 6-12 months
- **Hardware:** Drone failures, maintenance costs
- **Market:** Agency budgets, competing priorities
- **Adoption:** Resistance to automation from pilots

---

## Success Metrics

### Technical Metrics
- **Dispatch latency:** < 30 seconds (incident → drone airborne)
- **Mission success rate:** > 95% (drone reaches scene, returns safely)
- **Uptime:** > 99.5% (system availability)
- **Fleet utilization:** > 60% (drones not idle)

### Business Metrics
- **Customer acquisition:** 10 agencies by EOY 2026
- **Retention:** > 90% annual retention
- **NPS:** > 50 (very good for B2G)
- **Revenue:** $500k ARR by Q4 2026

### Impact Metrics
- **Response time reduction:** -50% vs traditional dispatch
- **Pilot hours saved:** 1,000+ hours/year per agency
- **Cost savings:** $50k+/year per agency (pilot costs)
- **Incidents resolved:** 1,000+ incidents/year across fleet

---

## Resources

**Documentation:**
- `QUICKSTART.md` — Setup guide
- `docs/DISPATCH_ARCHITECTURE.md` — System architecture
- `docs/MULTI_DRONE_SETUP.md` — Multi-drone configuration
- `TESTING.md` — Test procedures
- `TROUBLESHOOTING.md` — Common issues

**Code:**
- `dispatch/` — Dispatch service + bridge
- `drone_control.py` — Python SDK for drone commands
- `web_interface/` — React frontend
- `src/drone_core/` — C++ ROS2 SDK

---

**Last Updated:** 2026-02-15  
**Maintainer:** Rodrigo Ortega
