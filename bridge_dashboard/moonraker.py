"""Small Moonraker HTTP client for status and deliberate supervisory commands."""

import httpx


class MoonrakerError(RuntimeError):
    """Moonraker could not complete a requested operation."""


class MoonrakerClient:
    """Query printer state and send low-rate G-code or emergency-stop requests."""

    def __init__(self, base_url, api_key=None):
        headers = {"X-Api-Key": api_key} if api_key else {}
        self._client = httpx.AsyncClient(
            base_url=base_url,
            headers=headers,
            timeout=httpx.Timeout(5.0, connect=2.0),
        )

    async def close(self):
        await self._client.aclose()

    async def upload_gcode(self, filename, local_path):
        """Upload a staged G-code file to Moonraker's gcodes root."""
        try:
            with local_path.open("rb") as gcode_file:
                response = await self._client.post(
                    "/server/files/upload",
                    data={"root": "gcodes"},
                    files={"file": (filename, gcode_file, "application/octet-stream")},
                )
                response.raise_for_status()
        except (httpx.HTTPError, OSError) as error:
            raise MoonrakerError(f"Moonraker G-code upload failed: {error}") from error

    async def status(self):
        """Return normalized status; connection errors remain visible to the UI."""
        try:
            response = await self._client.get(
                "/printer/objects/query?webhooks&toolhead&extruder&heater_bed&fan"
            )
            response.raise_for_status()
            payload = response.json()
            objects = payload.get("result", {}).get("status", {})
            webhooks = objects.get("webhooks", {})
            toolhead = objects.get("toolhead", {})
            extruder = objects.get("extruder", {})
            bed = objects.get("heater_bed", {})
            return {
                "connected": True,
                "state": webhooks.get("state", "unknown"),
                "state_message": webhooks.get("state_message", ""),
                "position": toolhead.get("position"),
                "extruder": {
                    "temperature": extruder.get("temperature"),
                    "target": extruder.get("target"),
                },
                "bed": {
                    "temperature": bed.get("temperature"),
                    "target": bed.get("target"),
                },
                "fan": objects.get("fan", {}).get("speed"),
                "error": None,
            }
        except (httpx.HTTPError, ValueError, TypeError) as error:
            return {
                "connected": False,
                "state": "unavailable",
                "state_message": "",
                "position": None,
                "extruder": {"temperature": None, "target": None},
                "bed": {"temperature": None, "target": None},
                "fan": None,
                "error": str(error),
            }

    async def emergency_stop(self):
        try:
            response = await self._client.post("/printer/emergency_stop")
            response.raise_for_status()
        except httpx.HTTPError as error:
            raise MoonrakerError(f"Klipper emergency stop failed: {error}") from error
