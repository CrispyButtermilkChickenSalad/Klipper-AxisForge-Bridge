# Setup

## 1. Network

Both hosts must reach each other (same LAN or hotspot). Wired Ethernet is
preferred; hotspot/Wi-Fi limits clock-timing profiles (see
[clock profiles](../synchronized-jobs.md)). Add the dashboard host's IP/subnet to
Moonraker `[authorization] trusted_clients`. An API key is **not** required when
the client is trusted; otherwise set `MOONRAKER_API_KEY`.

## 2. Klipper host

Requires `kinematics: none` and Klipper's `motion_queuing`/extra-axis API
(checked against Klipper `0cee841e`).

```bash
python3 scripts/install_sync.py --klipper-dir ~/klipper --config ~/printer_data/config/printer.cfg
sudo systemctl restart klipper   # idle, heaters at zero
curl http://<klipper-host>:7125/printer/axisforge_sync/capabilities
```

Expect `protocol: axisforge.sync.v1` and `control_ready: true`. Optionally set
`continuous_motion: True` in `[axisforge_sync]`. Klipper needs no A/B/C axis
configuration; it ignores them.

## 3. Dashboard / ROS host (Ubuntu + ROS 2 Humble)

Clone AxisForge and copy/clone this repo to `AxisForge/Klipper-AxisForge-Bridge`.
Create AxisForge `.env` (never commit it):

```ini
MOONRAKER_URL=http://<klipper-host>:7125
AXISFORGE_SYNC_ENABLE=1
ROBOT_IP=<ur-controller-ip>
```

### Docker (recommended)

```bash
docker compose up -d --build dev
docker compose exec dev axisforge-build
docker compose --profile klipper up -d
```

After changing `.env`, recreate the dashboard:
`docker compose --profile klipper up -d --no-deps --force-recreate bridge`.

### Native

Run the worker and rosbridge in separate terminals, then the dashboard:

```bash
ros2 run print_control axisforge_sync_worker --config src/axisforge_bringup/config/ur_master.yaml --enable-motion
ros2 launch rosbridge_server rosbridge_websocket_launch.xml address:=127.0.0.1
pip install -r requirements.txt
MOONRAKER_URL=... uvicorn bridge_dashboard.app:app --host 127.0.0.1 --port 8080
```

The environment variable must be set in the same shell/service that launches
uvicorn.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `MOONRAKER_URL` | `http://127.0.0.1:7125` | Klipper host |
| `MOONRAKER_API_KEY` | unset | Only if not a trusted client |
| `ROSBRIDGE_URL` | `ws://127.0.0.1:9090` | rosbridge |
| `AXISFORGE_SYNC_URL` | `http://127.0.0.1:8081` | Worker API (keep on loopback) |
| `AXISFORGE_GCODE_ROOT`, `AXISFORGE_CONFIG` | unset | G-code folder, `ur_master.yaml` |
| `AXISFORGE_LAUNCH_PACKAGE` / `_FILE` | `axisforge_bringup` / `ur_master.launch.py` | Launch target |
| `ROBOT_IP` | `192.168.0.100` | UR controller |
| `AXISFORGE_ROBOT_CONNECTION_URL`, `AXISFORGE_ROBOT_DRIVER_SCRIPT`, `UR_CALIBRATION_FILE` | unset | Robot connection supervision |
| `SYNC_KLIPPER_DELAY_S` | `10` | Start delay (simple sync controller) |
| `HEATER_CHECK_TIMEOUT_S` | `300` | Preflight heater timeout |
| `FLUIDD_URL`, `MAINSAIL_URL`, `PRINTER_UI_URL`, `ALPS_LOGGER_URL` | unset | Embedded UI links |

## 4. UR robot

Start the UR driver, run External Control on the pendant, select **Remote
Control**, set speed to 100%. Open **http://127.0.0.1:8080**.
