const byId = (id) => document.getElementById(id);

function setBadge(id, text, good) {
  const badge = byId(id);
  badge.textContent = text;
  badge.className = `badge ${good === true ? "good" : good === false ? "bad" : ""}`;
}

function displayTemperature(value, target) {
  if (value == null) return "—";
  return `${Number(value).toFixed(1)} °C / ${Number(target || 0).toFixed(1)} °C`;
}

let latestSystemsReady = false;
let latestAxisForgeIdle = false;
let selectedPreflightState = null;
let syncSnapshot = { state: "idle", armed: false, job: null, control_ready: false };
let syncActionInFlight = false;

function showMessage(id, text, isError = false) {
  const element = byId(id);
  element.textContent = text && typeof text === "object" ? JSON.stringify(text) : (text || "");
  element.className = `inline-message${text ? (isError ? " error" : " success") : ""}`;
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.detail || `Request failed (${response.status})`);
  return body;
}

async function refreshStatus() {
  try {
    const status = await request("/api/status");
    const ros = status.ros;
    const klipper = status.klipper;
    const job = status.axisforge;
    const allReady = ros.connected && klipper.connected && klipper.state === "ready";
    latestSystemsReady = Boolean(allReady && ros.joint_state_fresh);
    latestAxisForgeIdle = !job.running && !job.planning_check_running;
    byId("overall-dot").className = `dot ${allReady ? "good" : "bad"}`;
    byId("overall-state").textContent = allReady ? "Systems connected" : "Check system status";

    setBadge("ros-badge", ros.connected ? "Connected" : "Offline", ros.connected);
    byId("joint-state").textContent = ros.joint_state_fresh
      ? `Fresh · ${ros.joint_state_age_s}s ago`
      : ros.connected ? "No fresh feedback" : "Unavailable";
    byId("joint-count").textContent = ros.joint_names?.length
      ? `${ros.joint_names.length} joints`
      : "—";

    setBadge(
      "klipper-badge",
      klipper.connected ? klipper.state : "Offline",
      klipper.connected && klipper.state === "ready",
    );
    byId("klipper-state").textContent = klipper.connected
      ? klipper.state_message || klipper.state
      : klipper.error || "Unavailable";
    byId("extruder-temp").textContent = displayTemperature(
      klipper.extruder?.temperature, klipper.extruder?.target,
    );
    byId("bed-temp").textContent = displayTemperature(
      klipper.bed?.temperature, klipper.bed?.target,
    );

    setBadge("job-badge", job.running ? "Running" : "Idle", job.running);
    byId("job-name").textContent = job.job || "No active job";
    byId("job-mode").textContent = job.dry_run == null
      ? (job.return_code == null ? "—" : `Exited (${job.return_code})`)
      : job.dry_run ? "Planning only" : "Live";
    byId("start-job").disabled = job.running || !ros.connected || !byId("job-select").value;
    byId("stop-job").disabled = !job.running;
    updateSyncControls();
  } catch (error) {
    byId("overall-dot").className = "dot bad";
    byId("overall-state").textContent = error.message;
    latestSystemsReady = false;
    latestAxisForgeIdle = false;
    updateSyncControls();
  }
}

async function loadJobs() {
  const select = byId("job-select");
  try {
    const result = await request("/api/jobs");
    select.replaceChildren();
    if (!result.jobs.length) {
      select.add(new Option("No staged G-code files", ""));
      showMessage("jobs-message", result.error || "No G-code jobs found", true);
      return;
    }
    select.add(new Option("Select a job…", ""));
    for (const job of result.jobs) select.add(new Option(job, job));
    showMessage("jobs-message", "");
  } catch (error) {
    select.replaceChildren(new Option("Could not load jobs", ""));
    showMessage("jobs-message", error.message, true);
  }
}

async function loadLinks() {
  try {
    const links = await request("/api/links");
    const fluidd = byId("fluidd-link");
    const mainsail = byId("mainsail-link");
    const placeholder = byId("printer-ui-placeholder");
    if (links.fluidd) {
      fluidd.href = links.fluidd;
      fluidd.hidden = false;
    }
    if (links.mainsail) {
      mainsail.href = links.mainsail;
      mainsail.hidden = false;
    }
    if (!links.fluidd && !links.mainsail && links.printer_ui) {
      placeholder.href = links.printer_ui;
      placeholder.target = "_blank";
      placeholder.rel = "noopener noreferrer";
      placeholder.classList.remove("unavailable");
      placeholder.removeAttribute("aria-disabled");
      placeholder.title = "Open the printer web UI on the Moonraker host";
    } else {
      placeholder.hidden = Boolean(links.fluidd || links.mainsail);
    }
    byId("alps-link").href = links.alps_logger;
  } catch (error) {
    showMessage("jobs-message", `Could not load tool links: ${error.message}`, true);
  }
}

const chartColors = ["#c9a7ff", "#58a6ff", "#4ade80", "#fbbf24", "#fb7185", "#22d3ee"];
let temperatureHistory = {};
let temperatureColors = new Map();
let telemetryInFlight = false;

function percentage(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(0)}%` : "Unavailable";
}

function temperature(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)} °C` : "Unavailable";
}

function renderTelemetryList(id, entries, emptyMessage = "None reported", colors = new Map()) {
  const list = byId(id);
  list.replaceChildren();
  if (!entries.length) {
    const row = document.createElement("div");
    const label = document.createElement("dt");
    label.textContent = emptyMessage;
    row.append(label);
    list.append(row);
    return;
  }
  for (const [name, value] of entries) {
    const row = document.createElement("div");
    const label = document.createElement("dt");
    const detail = document.createElement("dd");
    if (colors.has(name)) {
      const marker = document.createElement("span");
      marker.className = "sensor-color";
      marker.style.backgroundColor = colors.get(name);
      marker.setAttribute("aria-hidden", "true");
      label.append(marker);
    }
    label.append(document.createTextNode(name));
    detail.textContent = value;
    row.append(label, detail);
    list.append(row);
  }
}

function drawTemperatureHistory() {
  const canvas = byId("temperature-chart");
  const width = canvas.clientWidth;
  if (!width) return;
  const height = 200;
  const scale = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  const series = Object.entries(temperatureHistory)
    .filter(([, values]) => Array.isArray(values) && values.some(Number.isFinite));
  if (!series.length) return;

  const samples = series.flatMap(([, values]) => values.filter(Number.isFinite));
  const min = Math.min(0, Math.floor(Math.min(...samples) / 10) * 10);
  const max = Math.max(min + 10, Math.ceil(Math.max(...samples) / 10) * 10);
  const left = 44, right = width - 12, top = 12, bottom = height - 20;
  ctx.font = "11px sans-serif";
  ctx.fillStyle = "#8b949e";
  ctx.strokeStyle = "#30363d";
  for (let i = 0; i <= 4; i++) {
    const y = top + (bottom - top) * i / 4;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
    ctx.fillText(`${(max - (max - min) * i / 4).toFixed(0)}°`, 4, y + 4);
  }
  const longest = Math.max(...series.map(([, values]) => values.length), 2);
  series.forEach(([name, values]) => {
    ctx.strokeStyle = temperatureColors.get(name);
    ctx.lineWidth = 2;
    ctx.beginPath();
    let active = false;
    values.forEach((value, i) => {
      if (!Number.isFinite(value)) {
        active = false;
        return;
      }
      const x = left + (right - left) * (longest - values.length + i) / (longest - 1);
      const y = bottom - (bottom - top) * (value - min) / (max - min);
      if (active) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
      active = true;
    });
    ctx.stroke();
  });
}

function renderHistory(history, error, sensorNames) {
  const series = sensorNames
    .filter((name) => Array.isArray(history[name]) && history[name].some(Number.isFinite));
  temperatureHistory = Object.fromEntries(series.map((name) => [name, history[name]]));
  temperatureColors = new Map(series.map((name, index) => [name, chartColors[index % chartColors.length]]));
  byId("temperature-chart-message").textContent =
    error || (series.length ? "" : "No temperature history available.");
  byId("temperature-chart-message").className = `inline-message${error ? " error" : ""}`;
  drawTemperatureHistory();
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = String(Math.floor(total % 3600 / 60)).padStart(2, "0");
  return `${hours}:${minutes}:${String(total % 60).padStart(2, "0")}`;
}

function renderPrintStats(data, metadataError) {
  byId("print-status").textContent = [data.state || "Unavailable", data.filename]
    .filter(Boolean).join(" · ");
  byId("print-speed").textContent = Number.isFinite(data.velocity)
    ? `${data.velocity.toFixed(1)} mm/s` : "—";
  const flow = Number.isFinite(data.extruder_velocity) && Number.isFinite(data.filament_diameter)
    && data.filament_diameter > 0
    ? Math.max(0, data.extruder_velocity) * Math.PI * (data.filament_diameter / 2) ** 2 : null;
  byId("print-flow").textContent = flow == null ? "—" : `${flow.toFixed(1)} mm³/s`;
  byId("print-filament").textContent = Number.isFinite(data.filament_used)
    ? `${data.filament_used.toFixed(2)} mm` : "—";
  byId("print-layer").textContent = Number.isInteger(data.current_layer) && Number.isInteger(data.total_layer)
    ? `${data.current_layer} of ${data.total_layer}` : "—";
  const progress = data.progress;
  const remaining = ["printing", "paused"].includes(data.state)
    && Number.isFinite(progress) && progress >= 0.01 && progress < 1
    && Number.isFinite(data.print_duration) && data.print_duration > 0
    ? data.print_duration * (1 - progress) / progress : null;
  byId("print-estimate").textContent = formatDuration(remaining);
  byId("print-slicer").textContent = data.slicer_estimate > 0
    ? formatDuration(data.slicer_estimate) : "—";
  byId("print-total").textContent = formatDuration(data.total_duration);
  byId("print-eta").textContent = remaining != null && data.state === "printing"
    ? new Date(Date.now() + remaining * 1000).toLocaleTimeString() : "—";
  byId("print-info-message").textContent = metadataError
    ? `Slicer metadata unavailable: ${metadataError}` : "";
  byId("print-info-message").className = `inline-message${metadataError ? " error" : ""}`;
}

async function refreshTelemetry() {
  if (telemetryInFlight) return;
  telemetryInFlight = true;
  try {
    const data = await request("/api/klipper/telemetry");
    renderHistory(data.history, data.history_error, data.temperatures.map((item) => item.name));
    renderTelemetryList("telemetry-temperatures", data.temperatures.map((item) => [
      item.name,
      item.target == null
        ? temperature(item.temperature)
        : `${temperature(item.temperature)} / ${temperature(item.target)} target`,
    ]), "None reported", temperatureColors);
    renderTelemetryList("telemetry-fans", data.fans.map((item) => [item.name, percentage(item.speed)]));
    renderPrintStats(data.print, data.metadata_error);
    byId("telemetry-message").textContent = "";
    byId("telemetry-updated").textContent = `Updated ${new Date().toLocaleTimeString()} · refreshes every 5 seconds`;
  } catch (error) {
    renderTelemetryList("telemetry-temperatures", [], "Unavailable");
    renderTelemetryList("telemetry-fans", [], "Unavailable");
    renderPrintStats({}, null);
    byId("telemetry-updated").textContent = "";
    byId("telemetry-message").textContent = `Toolhead data unavailable: ${error.message}`;
    byId("telemetry-message").className = "inline-message error";
    renderHistory({}, "Temperature history unavailable.", []);
  } finally {
    telemetryInFlight = false;
  }
}

const toolFrames = new Map();
const toolTabs = [
  byId("dashboard-tab"),
  byId("printer-ui-placeholder"),
  byId("fluidd-link"),
  byId("mainsail-link"),
  byId("alps-link"),
];

function selectTab(tab) {
  for (const item of toolTabs) {
    item.classList.toggle("active", item === tab);
    if (item === tab) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  }
}

byId("dashboard-tab").addEventListener("click", (event) => {
  event.preventDefault();
  selectTab(event.currentTarget);
  byId("dashboard-view").hidden = false;
  byId("embedded-view").hidden = true;
  drawTemperatureHistory();
});

for (const tab of toolTabs.slice(1)) {
  tab.addEventListener("click", (event) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (tab.getAttribute("aria-disabled") === "true" || !tab.href || tab.hidden) return;

    selectTab(tab);
    byId("dashboard-view").hidden = true;
    byId("embedded-view").hidden = false;
    byId("embedded-title").textContent = tab.textContent.replace("↗", "").trim();
    byId("embedded-external").href = tab.href;
    byId("printer-warning").hidden = tab.id === "alps-link";
    for (const frame of toolFrames.values()) frame.hidden = true;

    const url = new URL(tab.href);
    if (location.protocol === "https:" && url.protocol === "http:") {
      byId("embedded-message").textContent =
        "An HTTPS page cannot embed an HTTP tool. Open it in a new tab or use HTTPS.";
      return;
    }

    byId("embedded-message").textContent =
      "If the tool cannot be displayed or a device permission fails, open it in a new tab.";
    let frame = toolFrames.get(tab.id);
    if (!frame) {
      frame = document.createElement("iframe");
      frame.className = "tool-frame";
      frame.title = byId("embedded-title").textContent;
      if (tab.id === "alps-link") frame.allow = "serial";
      frame.src = url.href;
      byId("embedded-frames").append(frame);
      toolFrames.set(tab.id, frame);
    }
    frame.hidden = false;
  });
}

byId("start-job").addEventListener("click", async () => {
  showMessage("job-message", "");
  const job = byId("job-select").value;
  if (!job) return showMessage("job-message", "Select a G-code file first.", true);
  try {
    const result = await request("/api/axisforge/start", {
      method: "POST",
      body: JSON.stringify({ job, dry_run: true }),
    });
    showMessage("job-message", `Started planning check for ${result.job}.`);
    refreshStatus();
  } catch (error) {
    showMessage("job-message", error.message, true);
  }
});

byId("job-select").addEventListener("change", () => {
  refreshStatus();
  loadPreflight();
});

const PREFLIGHT_TEXT = { staged: "Not run", klipper_ok: "Klipper passed", robot_ok: "Robot passed", preflight_passed: "Both passed", failed: "Failed" };

function renderPreflight(result) {
  selectedPreflightState = result.state;
  const list = byId("preflight-checks");
  list.replaceChildren();
  for (const kind of ["klipper", "robot"]) {
    const outcome = result[kind];
    byId(`step-${kind}`).textContent = outcome ? (outcome.passed ? "Passed" : "Failed") : "Not run";
    if (!outcome) continue;
    for (const check of outcome.checks) {
      const item = document.createElement("li");
      const mark = { pass: "✓", warn: "!", fail: "✗" }[check.status];
      item.className = `preflight-${check.status}`;
      item.textContent = `${mark} ${kind === "klipper" ? "Klipper" : "Robot"} — ${check.name}: ${check.detail}`;
      list.append(item);
    }
  }
  setBadge("preflight-badge", PREFLIGHT_TEXT[result.state], result.state === "preflight_passed" ? true : result.state === "failed" ? false : undefined);
  updateSyncControls();
}

const PREFLIGHT_BUTTONS = ["preflight-klipper", "preflight-robot", "preflight-both"];
let preflightInFlight = false;
let readyJobs = [];

function setPreflightButtons() {
  const job = byId("job-select").value;
  for (const id of PREFLIGHT_BUTTONS) byId(id).disabled = preflightInFlight || !job;
}

async function loadPreflight() {
  const job = byId("job-select").value;
  selectedPreflightState = null;
  setPreflightButtons();
  updateSyncControls();
  showMessage("preflight-message", "");
  if (!job) {
    byId("preflight-checks").replaceChildren();
    for (const kind of ["klipper", "robot"]) byId(`step-${kind}`).textContent = "Select a job";
    return setBadge("preflight-badge", "No job selected");
  }
  try {
    renderPreflight(await request(`/api/jobs/${encodeURIComponent(job)}/preflight`));
  } catch (error) {
    showMessage("preflight-message", error.message, true);
  }
}

async function loadReadyJobs() {
  const select = byId("ready-select");
  const previous = select.value;
  try {
    readyJobs = (await request("/api/jobs/ready")).jobs.map((item) => item.job);
  } catch (error) {
    readyJobs = [];
  }
  select.replaceChildren(new Option(readyJobs.length ? "Select a preflight-passed job…" : "No jobs passed both preflights", ""));
  for (const job of readyJobs) select.add(new Option(job, job));
  if (readyJobs.includes(previous)) select.value = previous;
  else if (syncSnapshot.armed && readyJobs.includes(syncSnapshot.job)) select.value = syncSnapshot.job;
  updateSyncControls();
}

async function runPreflights(kinds) {
  const job = byId("job-select").value;
  if (!job || preflightInFlight) return;
  preflightInFlight = true;
  setPreflightButtons();
  byId("job-select").disabled = true;
  const progress = byId("preflight-progress");
  const detail = byId("preflight-progress-detail");
  byId("preflight-progress-container").hidden = false;
  byId("preflight-progress-label").textContent = `Preflight for ${job}`;
  if (kinds.length > 1) {
    progress.max = kinds.length;
    progress.value = 0;
  } else {
    progress.max = 1;
    progress.removeAttribute("value");
  }
  let completed = 0;
  try {
    for (const kind of kinds) {
      const name = kind === "robot" ? "Robot dry-run" : "Klipper";
      detail.textContent = `${completed} of ${kinds.length} checks passed · ${name} in progress${kind === "robot" ? " (duration unknown)" : ""}`;
      showMessage("preflight-message", "");
      const result = await request(`/api/jobs/${encodeURIComponent(job)}/preflight/${kind}`, { method: "POST" });
      renderPreflight(result);
      if (!result[kind]?.passed) {
        if (kinds.length === 1) progress.value = 0;
        detail.textContent = `${completed} of ${kinds.length} checks passed · ${name} failed`;
        showMessage("preflight-message", `${name} preflight failed; see checks above.`, true);
        return;
      }
      completed += 1;
      progress.max = kinds.length;
      progress.value = completed;
    }
    detail.textContent = `${completed} of ${kinds.length} checks passed`;
    showMessage("preflight-message", selectedPreflightState === "preflight_passed"
      ? `${job} passed both preflights. Live synchronized start is unavailable.` : "");
  } catch (error) {
    if (kinds.length === 1) progress.value = 0;
    detail.textContent = `${completed} of ${kinds.length} checks passed · preflight error`;
    showMessage("preflight-message", error.message, true);
  } finally {
    preflightInFlight = false;
    byId("job-select").disabled = false;
    setPreflightButtons();
    await loadReadyJobs();
  }
}

byId("preflight-klipper").addEventListener("click", () => runPreflights(["klipper"]));
byId("preflight-robot").addEventListener("click", () => runPreflights(["robot"]));
byId("preflight-both").addEventListener("click", () => runPreflights(["klipper", "robot"]));
byId("ready-select").addEventListener("change", updateSyncControls);

function updateSyncControls() {
  const job = byId("ready-select").value;
  const active = ["starting_robot", "robot_moving", "starting_klipper", "running"].includes(syncSnapshot.state);
  const readyToArm = Boolean(syncSnapshot.control_ready && job && latestSystemsReady && latestAxisForgeIdle && !active);
  byId("sync-arm").disabled = syncActionInFlight || !readyToArm || syncSnapshot.armed;
  byId("sync-start").disabled = syncActionInFlight || !syncSnapshot.control_ready || !latestSystemsReady || !latestAxisForgeIdle
    || !syncSnapshot.armed || syncSnapshot.job !== job;
  byId("sync-disarm").disabled = syncActionInFlight || !syncSnapshot.armed;
  byId("sync-abort").disabled = syncActionInFlight || !active;
  const badge = byId("sync-availability-badge");
  const step = byId("step-sync");
  if (active) {
    badge.textContent = syncSnapshot.state.replaceAll("_", " ");
    step.textContent = syncSnapshot.message || "Synchronized job in progress";
  } else if (!syncSnapshot.control_ready) {
    badge.textContent = "Sync unavailable";
    step.textContent = "Klipper-timed following not implemented";
  } else if (syncSnapshot.armed) {
    badge.textContent = syncSnapshot.job === job ? "Armed" : "Another job is armed";
    step.textContent = syncSnapshot.job === job
      ? "Armed — start within 60 seconds" : `Disarm ${syncSnapshot.job} before selecting another job`;
  } else if (job) {
    badge.textContent = readyToArm ? "Ready to arm" : "Systems not ready";
    step.textContent = readyToArm ? `${job} ready` : "Waiting for connected, idle systems";
  } else {
    badge.textContent = readyJobs.length ? `${readyJobs.length} job(s) ready` : "Preflight required";
    step.textContent = readyJobs.length ? "Choose a ready job" : "Run both preflights";
  }
}

for (const action of ["arm", "start", "disarm", "abort"]) {
  byId(`sync-${action}`).addEventListener("click", async () => {
    const job = byId("ready-select").value;
    if (!job && action !== "abort") return showMessage("sync-message", "Select a ready job first.", true);
    if (action === "start" && !window.confirm(
      "This starts live AxisForge robot motion, then starts the Klipper print. Confirm the machine is clear, attended, and ready."
    )) return;
    syncActionInFlight = true;
    updateSyncControls();
    try {
      const body = await request(`/api/sync/${action}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job }),
      });
      syncSnapshot = body;
      showMessage("sync-message", `Sync: ${body.state} ${body.message}`, body.state === "aborted" || body.state === "failed");
    } catch (error) {
      showMessage("sync-message", error.message, true);
    } finally {
      syncActionInFlight = false;
      updateSyncControls();
      refreshSync();
    }
  });
}

async function refreshSync() {
  try {
    const body = await request("/api/sync/status");
    syncSnapshot = body;
    if (body.armed && readyJobs.includes(body.job)) byId("ready-select").value = body.job;
    if (!syncActionInFlight) {
      showMessage("sync-message", `Sync: ${body.state} ${body.message}`, body.state === "aborted" || body.state === "failed");
    }
    updateSyncControls();
  } catch (error) {
    if (!syncActionInFlight) showMessage("sync-message", `Could not refresh sync state: ${error.message}`, true);
  }
}
window.setInterval(refreshSync, 2000);

byId("upload-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = byId("gcode-upload").files[0];
  if (!file) return showMessage("upload-message", "Choose a .gcode file.", true);
  const button = byId("upload-job");
  button.disabled = true;
  showMessage("upload-message", "Uploading to Moonraker and staging for AxisForge…");
  const form = new FormData();
  form.append("file", file);
  try {
    const response = await fetch("/api/jobs/upload", { method: "POST", body: form });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.detail || `Upload failed (${response.status})`);
    byId("gcode-upload").value = "";
    showMessage("upload-message", `${body.job} uploaded. Run the Klipper and robot preflights before starting.`);
    await loadJobs();
  } catch (error) {
    showMessage("upload-message", error.message, true);
  } finally {
    button.disabled = false;
  }
});

byId("stop-job").addEventListener("click", async () => {
  if (!window.confirm("Request AxisForge to stop the robot job?")) return;
  showMessage("job-message", "");
  try {
    const result = await request("/api/axisforge/stop", { method: "POST" });
    showMessage("job-message", result.message, result.running);
    refreshStatus();
  } catch (error) {
    showMessage("job-message", error.message, true);
  }
});

byId("klipper-estop").addEventListener("click", async () => {
  if (!window.confirm("Request emergency stop of Klipper and AxisForge? Use physical E-stops if needed.")) return;
  showMessage("safety-message", "");
  try {
    await request("/api/klipper/emergency-stop", { method: "POST" });
    showMessage("safety-message", "Stop requests accepted by Klipper and AxisForge.");
    refreshStatus();
  } catch (error) {
    showMessage("safety-message", error.message, true);
  }
});

loadJobs().then(loadPreflight).then(loadReadyJobs);
window.setInterval(loadReadyJobs, 10000);
loadLinks();
refreshStatus();
refreshTelemetry();
window.setInterval(refreshStatus, 2000);
window.setInterval(refreshTelemetry, 5000);
window.addEventListener("resize", drawTemperatureHistory);
