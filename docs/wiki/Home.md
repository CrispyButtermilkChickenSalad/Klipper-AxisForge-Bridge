# Klipper–AxisForge Bridge wiki

The Bridge is a local dashboard that coordinates a **Klipper/Moonraker** host
(Fly MiniPad or similar; extrusion, heaters, master timeline) with an
**AxisForge** ROS 2 worker that drives a UR16e arm. Klipper owns the XYZ/ABC/E
timeline; the robot follows timestamped joint trajectories.

| Page | Contents |
| --- | --- |
| [Architecture](Architecture.md) | Components, data flow, ownership, clock model |
| [Setup](Setup.md) | Network, Klipper host, ROS host, Docker/native install, environment variables |
| [Workflow](Workflow.md) | Bed probe → upload → preflight → synchronized start, recovery |
| [Troubleshooting](Troubleshooting.md) | Common failures and fixes |
| [Testing](Testing.md) | Test suites and what needs Linux/ROS/hardware |

Deeper reference: [synchronized jobs](../synchronized-jobs.md) (protocol, clock
profiles, heartbeats, corner policies, pressure advance).

## Conventions

- X/Y/Z are linear mm. A/B/C are **absolute degrees about X/Y/Z** relative to
  the configured nozzle orientation. Klipper has no A/B/C hardware and carries
  them as metadata; the robot executes them.
- Keep Bridge and AxisForge versions matched; deploy both while idle.
- Independent speed override and mid-job resume are unsupported.
- Live tracking, pressure-advance calibration and print quality still require
  physical validation.
