"""Launch and supervise AxisForge's existing ROS 2 G-code interpreter."""

import asyncio
import logging
import os
import shutil
import subprocess
import tempfile

logger = logging.getLogger(__name__)


class AxisForgeError(RuntimeError):
    """AxisForge launch or stop request could not be completed."""


class AxisForgeRunner:
    """Run one allow-listed G-code file through AxisForge's launch entry point."""

    def __init__(self, settings):
        self.settings = settings
        self._process = None
        self._job_name = None
        self._dry_run = None
        self._lock = asyncio.Lock()

    def list_jobs(self):
        root = self.settings.gcode_root
        if root is None:
            return {"configured": False, "jobs": [], "error": "AXISFORGE_GCODE_ROOT is not set"}
        if not root.is_dir():
            return {"configured": False, "jobs": [], "error": f"G-code directory not found: {root}"}
        jobs = sorted(
            path.name for path in root.iterdir()
            if path.suffix.lower() == ".gcode" and self._is_safe_file(path)
        )
        return {"configured": True, "jobs": jobs, "error": None}

    def _is_safe_file(self, path):
        try:
            resolved = path.resolve(strict=True)
            return resolved.parent == self.settings.gcode_root and resolved.is_file()
        except (OSError, RuntimeError):
            return False

    def _resolve_job(self, name):
        self._validate_job_name(name)
        root = self.settings.gcode_root
        if root is None:
            raise AxisForgeError("AXISFORGE_GCODE_ROOT is not configured")
        path = root / name
        if not self._is_safe_file(path):
            raise AxisForgeError("The selected G-code file is missing or outside the configured directory")
        return path.resolve(strict=True)

    def _validate_job_name(self, name):
        if not name or name in (".", "..") or "/" in name or "\\" in name:
            raise AxisForgeError("Choose a G-code file from the configured job list")
        if not name.lower().endswith(".gcode"):
            raise AxisForgeError("Only .gcode files are accepted")

    def stage_upload(self, name, source):
        self._validate_job_name(name)
        root = self.settings.gcode_root
        if root is None:
            raise AxisForgeError("AXISFORGE_GCODE_ROOT is not configured")
        if not root.is_dir():
            raise AxisForgeError("The configured AxisForge G-code directory does not exist")
        destination = root / name
        if os.path.lexists(destination):
            raise AxisForgeError("A G-code file with that name already exists")

        temporary_path = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="wb", prefix=".bridge-upload-", suffix=".tmp",
                dir=root, delete=False,
            ) as staged:
                temporary_path = staged.name
                shutil.copyfileobj(source, staged)
                staged.flush()
                os.fsync(staged.fileno())
            if os.path.getsize(temporary_path) == 0:
                raise AxisForgeError("The uploaded G-code file is empty")
            if os.path.lexists(destination):
                raise AxisForgeError("A G-code file with that name already exists")
            os.replace(temporary_path, destination)
        except AxisForgeError:
            raise
        except OSError as error:
            raise AxisForgeError(f"Could not stage G-code file: {error}") from error
        finally:
            if temporary_path and os.path.exists(temporary_path):
                os.unlink(temporary_path)
        return destination

    async def start(self, name, dry_run=False):
        async with self._lock:
            if self._process is not None and self._process.poll() is None:
                raise AxisForgeError("An AxisForge job is already running")
            path = self._resolve_job(name)
            command = [
                self.settings.ros2_command,
                "launch",
                self.settings.launch_package,
                self.settings.launch_file,
            ]
            if self.settings.axisforge_config is not None:
                command.append(f"config:={self.settings.axisforge_config}")
            command.extend((f"file:={path}", f"dry_run:={'true' if dry_run else 'false'}"))
            try:
                self._process = subprocess.Popen(
                    command,
                    stdin=subprocess.DEVNULL,
                    stdout=None,
                    stderr=None,
                    shell=False,
                )
            except OSError as error:
                raise AxisForgeError(f"Could not start AxisForge: {error}") from error
            self._job_name = name
            self._dry_run = dry_run
            logger.info("Started AxisForge job %s (dry_run=%s)", name, dry_run)
            return self.status()

    async def request_stop(self, rosbridge):
        async with self._lock:
            if self._process is None or self._process.poll() is not None:
                return {"running": False, "message": "No AxisForge job is running"}
            try:
                await rosbridge.request_axisforge_stop()
            except Exception as error:
                raise AxisForgeError(str(error)) from error
        for _ in range(50):
            if self._process.poll() is not None:
                return {"running": False, "message": "AxisForge stopped"}
            await asyncio.sleep(0.1)
        return {
            "running": True,
            "message": "Stop was requested; AxisForge has not exited yet",
        }

    def status(self):
        running = self._process is not None and self._process.poll() is None
        return {
            "running": running,
            "job": self._job_name,
            "dry_run": self._dry_run,
            "return_code": None if running or self._process is None else self._process.returncode,
        }
