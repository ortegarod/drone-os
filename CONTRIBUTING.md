# Contributing to DroneOS

Thanks for your interest in contributing to DroneOS. This document covers how to get started.

## Getting Started

1. **Fork the repo** and clone your fork
2. **Set up the development environment** — see the [Quick Start Guide](https://aerisrobotics.com/docs/getting-started/quick-start)
3. **Create a branch** for your work: `git checkout -b feature/your-feature`
4. **Make your changes**, test them, and commit
5. **Open a pull request** against `main`

## Development Setup

DroneOS requires:
- **Ubuntu 22.04+** (native or WSL2)
- **ROS 2 Humble** (for the SDK)
- **PX4 Autopilot** (SITL for simulation)
- **Docker** (for containerized deployment)
- **Python 3.10+** (for drone_control.py and dispatch services)
- **Node.js 18+** (for the web interface)

See [Prerequisites](https://aerisrobotics.com/docs/getting-started/prerequisites) for detailed setup instructions.

## Project Structure

```
drone-os/
├── src/drone_core/        # C++ SDK (ROS 2 node)
├── drone_control.py       # Python API for remote drone control
├── dispatch/              # AI dispatch service + bridge
├── web_interface/         # React/TypeScript ground station
│   ├── frontend/          # React app
│   └── backend/           # Python backend (OpenClaw proxy)
├── docker/                # Docker Compose files (dev + prod)
├── skills/                # OpenClaw agent skills
├── config/                # Configuration files
├── gazebo/                # Gazebo world files
├── models/                # Drone models
└── scripts/               # Utility scripts
```

## What to Work On

### Good First Issues
- Documentation improvements
- Test coverage for `drone_control.py`
- Docker Compose optimizations
- Frontend UI improvements

### Bigger Projects
- Object detection integration with simulated camera feeds
- Multi-drone collision avoidance
- Additional flight stack adapters (ArduPilot)
- Plugin architecture design

Check the [Roadmap](https://aerisrobotics.com/roadmap) for the full project direction.

## Code Style

- **C++**: Follow ROS 2 style guidelines
- **Python**: PEP 8, type hints encouraged
- **TypeScript/React**: Functional components, hooks

## Testing

```bash
# Run the simulation
cd PX4-Autopilot
HEADLESS=1 make px4_sitl gz_x500

# Test drone control
python3 drone_control.py --drone drone1 --fleet-status

# Run the web interface
cd web_interface/frontend
npm run dev
```

## Pull Request Guidelines

1. **One feature per PR** — keep changes focused
2. **Test in simulation** before submitting
3. **Update docs** if you change APIs or behavior
4. **Write a clear description** of what changed and why

## Communication

- **Issues**: Use GitHub Issues for bugs and feature requests
- **Discussions**: Use GitHub Discussions for questions and ideas
- **Contact**: [contact@aerisrobotics.com](mailto:contact@aerisrobotics.com)

## License

By contributing, you agree that your contributions will be licensed under the same license as the project.
