# Klipper-ROS 2 Bridge

This project aims to synchronize G-code jobs between an AxisForge-controlled
robot and a Klipper toolhead. The local dashboard currently stages the same
file for both, shows read-only Klipper telemetry, and opens Fluidd, Mainsail
and ALPS Logger. Its experimental Klipper exporter is read-only.

**Synchronized robot/print execution is not implemented.** Uploading a file
does not start a print, and the dashboard is not a safety system. Use physical
emergency stops and stay with the machine.

**Preflight.** For each staged job the dashboard can run a Klipper preflight
(Klippy ready, printer idle, extruder able to extrude, the Klipper copy
byte-identical to the AxisForge copy, G-code metadata present) and a robot
preflight (rosbridge connected, fresh joint states, AxisForge idle, supported
rotation axes, and a full AxisForge `dry_run` planning check). Results are tied
to the file hash and discarded if the file changes. **Run both preflights** runs
the Klipper check, then the robot dry-run. A job appears under **Ready to run**
(`GET /api/jobs/ready`) only when both passed for the same filename and the
Klipper copy is byte-identical; arming and synchronized start use that list. The robot performs all
motion: `X Y Z` are linear mm and `A/B/C` are absolute degrees about X/Y/Z;
Klipper handles extrusion only. AxisForge must be the `rotary-axes-abc` fork
branch (A/B/C as rotations about X/Y/Z); older AxisForge treated `A` as pitch.

**Synchronized start.** `POST /api/sync/arm` re-verifies both sides and arms the
job for 60 s; `POST /api/sync/start` re-verifies (file hash unchanged), starts
AxisForge live, waits `SYNC_KLIPPER_DELAY_S` (default 10 s, must exceed AxisForge's
approach move) while confirming the robot is still running, then starts the
Klipper print via Moonraker. If either side faults or exits early, both are
stopped (`/api/sync/abort` does this on demand). Robot and Klipper run the same
file independently; Klipper ignores `A/B/C`. Real-time following of Klipper by the
robot (`robot_motion_bridge` + `orientation_index`) is not wired in yet.

**Commissioning checklist (do with the arm in a safe state, hand on the e-stop).**
1. Confirm who extrudes: AxisForge also drives extrusion by default
   (`extrusion_scale_factor` in `ur_master.yaml`). If Klipper extrudes, set it to 0
   or the job will double-extrude.
2. Run a dry run, then both preflights, on a short A/B/C test file with the nozzle
   clear of the bed (high `z_offset`) and Klipper heaters off.
3. Run a synchronized start with the extruder cold-locked/no filament; watch that
   the robot approaches before Klipper begins and that Abort stops both.
4. Tune `SYNC_KLIPPER_DELAY_S`, then print.

The bridge does not coordinate live parameter changes. Its toolhead telemetry
cannot change heater targets, fans, macros, speed or extrusion factor. Fluidd
and Mainsail can still control Klipper directly: reserve non-emergency changes
there for when no print is running. Their controls are not blocked by this
warning; use emergency stops whenever needed.

The [GitHub Pages launcher](https://crispybuttermilkchickensalad.github.io/Klipper-AxisForge-Bridge/)
is a static links page, not a ROS 2 or machine-control server.

## Linux dashboard

On the ROS 2/AxisForge host, install `rosbridge_server` for your ROS
distribution. Source the ROS and AxisForge environments, then start:

```bash
ros2 launch rosbridge_server rosbridge_websocket_launch.xml
```

In another terminal on that host:

```bash
git clone https://github.com/CrispyButtermilkChickenSalad/Klipper-ROS2-Bridge.git
cd Klipper-ROS2-Bridge
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
source /opt/ros/humble/setup.bash
source /path/to/AxisForge/install/setup.bash
export MOONRAKER_URL='http://<klipper-host>:7125'
export AXISFORGE_GCODE_ROOT=/path/to/AxisForge/src/print_control/gcode
uvicorn bridge_dashboard.app:app --host 127.0.0.1 --port 8080
```

Replace the example paths and host with your own; use the ROS distribution
matching your AxisForge installation. Open `http://127.0.0.1:8080`. The
AxisForge runtime dependencies must also be available in the environment
running its launch command.

## Klipper exporter

With the printer idle and heater targets off, copy
`klipper_extras/robot_motion_bridge.py` to your Klipper installation's
`klippy/extras/` directory. Add the following to `printer.cfg` **before** the
`SAVE_CONFIG` block, then restart Klipper:

```ini
[robot_motion_bridge]
```

Check that Klipper returns to `ready`. The exporter was installed and its
subscription header checked on the configured host, but motion streaming and
robot following have not been validated.

See the [wiki](https://github.com/CrispyButtermilkChickenSalad/Klipper-ROS2-Bridge/wiki)
for configuration, installation details, host setup, rollback, safety limits
and troubleshooting.
