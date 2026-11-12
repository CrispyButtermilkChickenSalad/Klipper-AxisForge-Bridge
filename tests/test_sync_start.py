import unittest

from bridge_dashboard.axisforge import AxisForgeError
from bridge_dashboard.sync_start import SyncController, SyncError


class FakePreflight:
    def __init__(self):
        self.state = "preflight_passed"
        self.sha = "abc"

    def get(self, job):
        return {"state": self.state, "sha256": self.sha}


class FakeRos:
    def status(self):
        return {"connected": True, "joint_state_fresh": True}


class FakeAxisForge:
    def __init__(self):
        self.running = False
        self.code = None
        self.stops = 0
        self.fail_start = False

    def status(self):
        return {"running": self.running, "planning_check_running": False, "return_code": self.code}

    async def start(self, job, dry_run=False):
        if self.fail_start:
            raise AxisForgeError("boom")
        assert dry_run is False
        self.running = True

    async def request_stop(self, ros):
        self.stops += 1
        self.running = False


class FakeMoonraker:
    def __init__(self):
        self.snapshot = {"state": "ready", "print_state": "standby"}
        self.started = []
        self.cancels = 0

    async def printer_snapshot(self):
        return dict(self.snapshot)

    async def start_print(self, name):
        self.started.append(name)
        self.snapshot["print_state"] = "printing"

    async def cancel_print(self):
        self.cancels += 1


class SyncTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.pre, self.af, self.mr = FakePreflight(), FakeAxisForge(), FakeMoonraker()
        self.sync = SyncController(self.mr, FakeRos(), self.af, self.pre,
                                   klipper_delay_s=0.05, poll_s=0.01)

    async def test_start_requires_arming(self):
        with self.assertRaises(SyncError):
            await self.sync.start("a.gcode")

    async def test_arm_requires_passed_preflight(self):
        self.pre.state = "robot_ok"
        with self.assertRaises(SyncError):
            await self.sync.arm("a.gcode")

    async def test_robot_starts_before_klipper(self):
        await self.sync.arm("a.gcode")
        await self.sync.start("a.gcode")
        self.assertTrue(self.af.running)
        self.assertEqual(self.mr.started, [])
        await self.wait_for(lambda: self.mr.started)
        self.assertEqual(self.mr.started, ["a.gcode"])
        self.af.running, self.af.code, self.mr.snapshot["print_state"] = False, 0, "complete"
        await self.wait_for(lambda: self.sync.state == "complete")

    async def test_robot_dying_before_klipper_stops_both(self):
        await self.sync.arm("a.gcode")
        await self.sync.start("a.gcode")
        self.af.running, self.af.code = False, 1
        await self.wait_for(lambda: self.sync.state == "aborted")
        self.assertEqual(self.mr.started, [])
        self.assertEqual(self.mr.cancels, 1)

    async def test_klipper_fault_stops_robot(self):
        await self.sync.arm("a.gcode")
        await self.sync.start("a.gcode")
        await self.wait_for(lambda: self.mr.started)
        self.mr.snapshot["state"] = "shutdown"
        await self.wait_for(lambda: self.sync.state == "aborted")
        self.assertGreaterEqual(self.af.stops, 1)

    async def test_file_change_after_arm_rejected(self):
        await self.sync.arm("a.gcode")
        self.pre.sha = "changed"
        with self.assertRaises(SyncError):
            await self.sync.start("a.gcode")
        self.assertFalse(self.af.running)

    async def test_arm_expires(self):
        now = [0.0]
        sync = SyncController(self.mr, FakeRos(), self.af, self.pre, clock=lambda: now[0])
        await sync.arm("a.gcode")
        now[0] = 61
        with self.assertRaises(SyncError):
            await sync.start("a.gcode")

    async def wait_for(self, condition):
        import asyncio
        for _ in range(300):
            if condition():
                return
            await asyncio.sleep(0.01)
        self.fail("condition not reached")


if __name__ == "__main__":
    unittest.main()
