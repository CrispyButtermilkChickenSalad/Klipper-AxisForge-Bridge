"""FastAPI application for the local AxisForge/Klipper dashboard."""

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from bridge_dashboard.axisforge import AxisForgeError, AxisForgeRunner
from bridge_dashboard.config import Settings
from bridge_dashboard.moonraker import MoonrakerClient, MoonrakerError
from bridge_dashboard.rosbridge import RosBridge

logger = logging.getLogger(__name__)
STATIC_DIR = Path(__file__).parent / "static"


class StartJobRequest(BaseModel):
    job: str
    dry_run: bool = False


def create_app(settings=None):
    settings = settings or Settings.from_env()

    @asynccontextmanager
    async def lifespan(app):
        app.state.moonraker = MoonrakerClient(
            settings.moonraker_url, settings.moonraker_api_key
        )
        app.state.rosbridge = RosBridge(settings.rosbridge_url)
        app.state.axisforge = AxisForgeRunner(settings)
        try:
            await app.state.rosbridge.start()
            yield
        finally:
            try:
                await app.state.axisforge.request_stop(app.state.rosbridge)
            except AxisForgeError:
                logger.exception("Could not request AxisForge stop during dashboard shutdown")
            await app.state.rosbridge.close()
            await app.state.moonraker.close()

    app = FastAPI(title="Klipper-ROS 2 Bridge", lifespan=lifespan)
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
    upload_lock = asyncio.Lock()

    @app.get("/")
    async def index():
        return FileResponse(STATIC_DIR / "index.html")

    @app.get("/api/status")
    async def status():
        return {
            "klipper": await app.state.moonraker.status(),
            "ros": app.state.rosbridge.status(),
            "axisforge": app.state.axisforge.status(),
        }

    @app.get("/api/jobs")
    async def jobs():
        return app.state.axisforge.list_jobs()

    @app.post("/api/jobs/upload")
    async def upload_job(file: UploadFile = File(...)):
        if not file.filename:
            raise HTTPException(status_code=400, detail="Choose a .gcode file")
        async with upload_lock:
            try:
                staged_path = app.state.axisforge.stage_upload(file.filename, file.file)
            except AxisForgeError as error:
                raise HTTPException(status_code=400, detail=str(error)) from error
            try:
                await app.state.moonraker.upload_gcode(file.filename, staged_path)
            except MoonrakerError as error:
                try:
                    staged_path.unlink()
                except OSError as cleanup_error:
                    logger.exception(
                        "Could not remove locally staged file after failed Moonraker upload"
                    )
                    raise HTTPException(
                        status_code=503,
                        detail=f"{error}; local staged file remains at {staged_path.name}",
                    ) from cleanup_error
                raise HTTPException(status_code=503, detail=str(error)) from error
            return {
                "job": file.filename,
                "uploaded": True,
                "ready": False,
                "message": (
                    "Uploaded to Klipper and staged for AxisForge; "
                    "synchronized preflight is not available yet"
                ),
            }

    @app.get("/api/links")
    async def links():
        return {
            "fluidd": settings.fluidd_url,
            "mainsail": settings.mainsail_url,
            "printer_ui": settings.printer_ui_url,
            "alps_logger": settings.alps_logger_url,
        }

    @app.post("/api/axisforge/start")
    async def start_axisforge(request: StartJobRequest):
        if not request.dry_run:
            raise HTTPException(
                status_code=409,
                detail=(
                    "Live execution is unavailable until synchronized Klipper/ROS 2 "
                    "job control is implemented"
                ),
            )
        ros_status = app.state.rosbridge.status()
        if not ros_status["connected"]:
            raise HTTPException(status_code=503, detail="ROS bridge is not connected")
        try:
            return await app.state.axisforge.start(request.job, request.dry_run)
        except AxisForgeError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error

    @app.post("/api/axisforge/stop")
    async def stop_axisforge():
        try:
            return await app.state.axisforge.request_stop(app.state.rosbridge)
        except AxisForgeError as error:
            raise HTTPException(status_code=503, detail=str(error)) from error

    @app.post("/api/klipper/emergency-stop")
    async def klipper_emergency_stop():
        results = await asyncio.gather(
            app.state.moonraker.emergency_stop(),
            app.state.axisforge.request_stop(app.state.rosbridge),
            return_exceptions=True,
        )
        klipper, robot = results
        failures = {}
        if isinstance(klipper, Exception):
            failures["klipper"] = str(klipper)
        if isinstance(robot, Exception):
            failures["robot"] = str(robot)
        if failures:
            raise HTTPException(
                status_code=503,
                detail={
                    "message": "One or more stop requests failed",
                    "results": {
                        "klipper": "accepted" if not isinstance(klipper, Exception) else failures["klipper"],
                        "robot": robot.get("message", "accepted") if not isinstance(robot, Exception) else failures["robot"],
                    },
                },
            )
        return {
            "klipper": "Emergency stop accepted",
            "robot": robot["message"],
        }

    return app


app = create_app()
