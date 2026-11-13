# Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Klipper not on dashboard | `MOONRAKER_URL` not set in the process that starts uvicorn/the container; recreate the bridge container after editing `.env`. Check Moonraker `trusted_clients`. API key is not needed for trusted clients. |
| Reachability says Klippy connected but no sync | Run `curl http://<host>:7125/printer/axisforge_sync/capabilities`; expect `control_ready: true`. Restart the Klipper service (not G-code RESTART) after upgrading modules. |
| Preflight rejects clock uncertainty | Use wired Ethernet or a slower clock profile; hotspot hops add jitter. |
| Start blocked | Check UR interlocks: External Control, NORMAL safety, 100% speed, Remote Control, fresh joint feedback. |
| Robot lock held | Another process owns the robot (`.axisforge-robot-control.lock`); stop it first. |
| Worker/Bridge version mismatch | Update both while idle and re-run preflight. |
| `ModuleNotFoundError: fcntl/termios` | The Bridge/ROS code is Linux-only; use the Linux host or Docker. |
