# Klipper-ROS 2 Bridge

This repository currently has two distinct web surfaces:

- `docs/` is a static GitHub Pages launcher for your Fluidd/Mainsail and ALPS
  Logger URLs. Printer addresses are saved in that browser's local storage.
- `bridge_dashboard/` is an optional local FastAPI service for Moonraker status,
  G-code upload/staging, ROS 2 status, and AxisForge planning checks.

The GitHub Pages launcher is the simple web entry point. It does not control
hardware or connect to a private Moonraker/ROS 2 service.

To publish the launcher, merge the changes to the default branch and select
**Settings > Pages > Deploy from a branch**, then choose the default branch and
`/docs`. The resulting URL will be
`https://crispybuttermilkchickensalad.github.io/Klipper-ROS2-Bridge/`.

On the launcher page, enter the Fluidd/Mainsail URL once. It is stored only in
your browser. The ALPS Logger link is preconfigured.

The dashboard does **not** stream AxisForge's `/stepper/speed` or `/stepper/move`
messages to Moonraker. High-rate G-code requests are not a deterministic extrusion
interface. Synchronized deposition still requires the separate, queued Klipper
extrusion adapter described below.

## Recommended host layout

Keep Klipper and Moonraker on the FLY-MINI-Pad, and run ROS 2, AxisForge, and this
bridge on a separate Ubuntu 22.04 64-bit Linux computer. Set `MOONRAKER_URL` on
that computer to the MiniPad's network address.

Mellow's [FLY-MINI-Pad specifications](https://mellow.klipper.cn/docs/ProductDoc/SBC/fly-mini-pad/)
list an Allwinner H3 quad-core Cortex-A7 and 512 MB RAM, with FlyOS-Fast and the
Klipper stack preinstalled. ROS 2 Humble targets Ubuntu Jammy 64-bit; its arm32
support is Tier 3/source-build only ([ROS platform matrix](https://www.ros.org/reps/rep-2000.html)).
With the MiniPad's memory, custom printer-focused OS, and AxisForge's NumPy,
SciPy, and Robotics Toolbox dependencies, running AxisForge there is not a
practical or supported setup. A conventional x86-64 Ubuntu 22.04 host with at
least 8 GB RAM is a practical starting point for ROS 2 and the robot driver; that
RAM figure is a recommendation, not an AxisForge minimum.

## Run on the Linux host

The service should run in the same ROS 2 environment as AxisForge. Install
`rosbridge_server` in that ROS distribution and start its websocket server:

```bash
source /opt/ros/humble/setup.bash
source /path/to/AxisForge/.venv/bin/activate
source /path/to/AxisForge/install/setup.bash
ros2 launch rosbridge_server rosbridge_websocket_launch.xml
```

In another terminal, with the same environment sourced:

```bash
cd /path/to/Klipper-ROS2-Bridge
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

export AXISFORGE_GCODE_ROOT=/path/to/AxisForge/src/print_control/gcode
# Optional custom calibration YAML:
export AXISFORGE_CONFIG=/path/to/AxisForge/src/axisforge_bringup/config/ur_master.yaml
uvicorn bridge_dashboard.app:app --host 127.0.0.1 --port 8080
```

Open `http://127.0.0.1:8080`. Configure `MOONRAKER_URL` and `ROSBRIDGE_URL` if
their defaults (`http://127.0.0.1:7125` and `ws://127.0.0.1:9090`) are not right.
Set `MOONRAKER_API_KEY` if Moonraker requires an API key.
Set `FLUIDD_URL` and/or `MAINSAIL_URL` to add links to the printer UI(s), or
set `PRINTER_UI_URL` for one generic printer-UI tab. If Moonraker uses its
default port (`7125`), the dashboard assumes the UI is at the same host's root;
override that guess for custom ports or reverse proxies. The dashboard includes
a link to the ALPS logger by default; override it with
`ALPS_LOGGER_URL` if needed. Printer UI and ALPS links open as top-level browser
tabs so Fluidd/Mainsail framing policies and the ALPS Web Serial permission flow
continue to work.

The app starts AxisForge with its documented `axisforge_bringup/ur_master.launch.py`
entry point and passes the selected G-code file, optional config, and dry-run flag.
The ROS 2 environment must already be sourced for the `ros2` command to work.
`AXISFORGE_LAUNCH_PACKAGE`, `AXISFORGE_LAUNCH_FILE`, and `ROS2_COMMAND` can
override the launch target and executable.

## Safety and current integration boundary

- **Extrusion ownership today:** AxisForge computes the extrusion profile and
  publishes `/stepper/speed` and `/stepper/move`; its current execution expects a
  ROS subscriber such as its Portenta firmware. This dashboard does not send
  extrusion motion to Klipper.
- The dashboard can upload a `.gcode` file to Moonraker and stage the same file
  in `AXISFORGE_GCODE_ROOT`. Upload is not preflight and does not start either
  system. AxisForge's planning check is dry-run only.
- The supplied Claude proposal instead makes Klipper the timing master and has
  AxisForge consume Klipper-planned motion. That is a larger redesign: AxisForge's
  G-code interpreter, independent retiming, and current extrusion planner would
  need to be replaced or adapted so the robot and Klipper share one motion
  timeline.
- The service binds to loopback by default. Do not expose it to a network without
  adding authentication, TLS, and appropriate access controls.
- Live starts are unconditionally disabled. The dashboard does not yet have a
  synchronized preflight/start protocol, so do not enable robot-plus-printer
  execution through this service. This is not a substitute for the UR pendant,
  physical E-stop, workspace checks, or an operator present at the machine.
- "Stop robot job" sends AxisForge's existing `/kb/shutdown` Boolean topic and
  waits for its process to exit. The emergency-stop control requests Klipper
  shutdown and AxisForge cancellation independently; either system can still
  require its hardware stop.
- The next integration step is a bounded, preflighted extrusion-profile
  interface that schedules motion on Klipper's queue and provides a
  start/completion handshake to the ROS 2 job controller. Do not use streamed
  HTTP G-code as a replacement.

## Experimental Klippy motion exporter

`klipper_extras/robot_motion_bridge.py` is a prototype read-only Klippy extra
that exports retained queued and historical toolhead and extruder trap-queue
segments through Klipper's bulk sensor helper. It reports Klipper print-time
timestamps and explicitly reports `control_ready: false`; it does not start,
pause, or command motion. Delivery and history retention are not guaranteed.

To try it, copy the file to Klipper's `klippy/extras/` directory, add
`[robot_motion_bridge]` to `printer.cfg`, and restart Klipper. The exact
installation path varies by host. This prototype has not been validated against
your custom Klipper build or a live printer. Verify compatibility and stream
timing/retention with a non-moving test before connecting a ROS 2 follower.

## Tests

```bash
python -m unittest discover -s tests
```
