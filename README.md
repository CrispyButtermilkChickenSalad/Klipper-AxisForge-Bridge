# Klipper-ROS 2 Bridge

This project aims to synchronize G-code jobs between an AxisForge-controlled
robot and a Klipper toolhead. The local dashboard currently stages the same
file for both, shows read-only Klipper telemetry, and opens Fluidd, Mainsail
and ALPS Logger. Its experimental Klipper exporter is read-only.

**Synchronized robot/print execution is not implemented.** Uploading a file
does not start a print, and the dashboard is not a safety system. Use physical
emergency stops and stay with the machine.

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
