import { createSurface } from "./surface.js";
import { unpack, index, clock, statistics, crossings } from "./data.js";
import { chart, smileChart, heatmap, COLORS, LABELS, LONG, fmt, signed } from "./charts.js";
const $ = (id) => document.getElementById(id);
const data = unpack(JSON.parse($("replay-data").textContent));
const state = { s: 30, e: 2, m: 277, window: 20, sampling: 60, target: 1, speed: 20, playing: false, colorMode: "iv", view: "time", zGroup: "iv" };
let stats, curveStats, events = [], cacheKey = "", scene = null, lastFrame = 0, accumulator = 0;
const cache = /* @__PURE__ */ new Map();
function refreshStats() {
  const key = `${state.s}/${state.window}`;
  if (key !== cacheKey) {
    if (!cache.has(key)) cache.set(key, [statistics(data, state.s, state.window), statistics(data, state.s, state.window, "curves", 17)]);
    [stats, curveStats] = cache.get(key);
    cacheKey = key;
  }
  events = crossings(stats, state.e, data.manifest.lengths[state.s], state.sampling / 60);
}
function setActive(ids, active) {
  for (const id of ids) {
    $(id).classList.toggle("active", id === active);
    $(id).setAttribute("aria-pressed", String(id === active));
  }
}
function updateReading() {
  const { s, e, m, target, window: window2 } = state, t = Math.floor(m), i = index(s, e, t, target), b = (e * 391 + t) * 8 + target;
  const value = data.values[i], z = stats.z[b], mean = stats.mean[b], count = stats.count[b];
  $("clock").textContent = clock(m);
  $("scrub").value = m;
  $("scrub").setAttribute("aria-valuetext", `${clock(m)} New York, synthetic data`);
  $("focus-name").textContent = LONG[target].replace(" IV", "");
  $("focus-expiry").textContent = `${data.manifest.tenors[e]}DTE`;
  $("focus-z").innerHTML = `${signed(z)}<span>\u03C3</span>`;
  $("focus-z").classList.toggle("normal", !Number.isFinite(z) || Math.abs(z) < 2);
  $("focus-iv").textContent = Number.isFinite(value) ? `${fmt(value * 100)}%` : "Unavailable";
  $("focus-mean").textContent = Number.isFinite(mean) ? `${fmt(mean * 100)}%` : "Insufficient history";
  $("focus-strike").textContent = Number.isFinite(value) ? `$${fmt(data.strikes[index(s, e, t, target, 4)])}` : "\u2014";
  $("spot").textContent = `$${fmt(data.spots[s * 391 + t])}`;
  $("count").textContent = `${count} / ${window2}`;
  $("assessment").innerHTML = !Number.isFinite(z) ? "A valid quote and at least eight<br>prior observations are required." : z >= 2 ? "Above its usual level<br>for this time of day." : z <= -2 ? "Below its usual level<br>for this time of day." : "Within \xB12\u03C3 of its usual level<br>for this time of day.";
  const flag = Object.entries(data.manifest.flagCodes).find(([, v]) => v === data.flags[i])?.[0] || "unavailable";
  $("quality").textContent = flag === "ok" ? `PCHIP \xB7 valid bracket${state.sampling === 30 ? " \xB7 carried forward" : ""}` : `Unavailable \xB7 ${flag.replaceAll("_", " ")}`;
  $("point-tape").innerHTML = [0, 1, 2, 3].map((j) => {
    const v = data.values[index(s, e, t, j)], z2 = stats.z[(e * 391 + t) * 8 + j];
    return `<button class="point ${target === j ? "active" : ""}" data-target="${j}" style="--point:${COLORS[j]}" aria-label="Focus ${LONG[j]}, synthetic ${fmt(v * 100)} percent"><span class="point-name">${LABELS[j]}</span><span class="point-value">${fmt(v * 100)}<small>%</small></span><span class="point-z ${Math.abs(z2) >= 2 ? "hot" : ""}">${signed(z2)}\u03C3</span></button>`;
  }).join("");
  const shown = events.filter((c) => c.m <= m);
  $("alert-count").textContent = `${shown.length} crossings so far`;
  $("alerts").innerHTML = shown.length ? shown.slice(-8).reverse().map((c) => `<button data-minute="${c.m}" aria-label="Jump to ${clock(c.m)}, ${LONG[c.j]} threshold crossing"><strong>${clock(c.m)} \xB7 ${signed(c.z, 1)}\u03C3</strong> ${LONG[c.j]}<span>${LONG[c.j]} is ${fmt(Math.abs(c.z), 1)}\u03C3 ${c.z > 0 ? "above" : "below"} its usual level for ${clock(c.m)}.</span></button>`).join("") : `<div class="empty">${count < 8 ? "At least eight valid prior sessions are needed for threshold alerts." : "No \xB12\u03C3 or \xB13\u03C3 threshold crossings up to this time."}</div>`;
  $("event-callout").hidden = s !== 30;
  $("injection-note").textContent = s === 30 ? "14:00 skew event deliberately injected" : data.manifest.lengths[s] === 211 ? "Synthetic half-day \xB7 closes 13:00" : "Synthetic historical session";
  const end = data.manifest.lengths[s] - 1;
  const ticks = s === 30 ? [0, 90, 180, 270, end] : [0, Math.round(end / 4), Math.round(end / 2), Math.round(3 * end / 4), end];
  document.querySelector(".scrub-labels").innerHTML = ticks.map((v, i2) => `<span style="position:absolute;left:${v / end * 100}%;transform:translateX(${i2 === 0 ? 0 : i2 === 4 ? -100 : -50}%)" class="${s === 30 && v === 270 ? "event-time" : ""}">${clock(v)}${s === 30 && v === 270 ? " \xB7 injection" : ""}</span>`).join("");
  $("color-legend").innerHTML = state.colorMode === "iv" ? '<span>15%</span><span class="gradient iv"></span><span>33% IV</span>' : '<span class="z-scale"><span style="left:0%">\u22123</span><span style="left:16.7%">\u22122</span><span style="left:50%">0</span><span style="left:83.3%">+2</span><span style="left:100%">+3\u03C3</span></span>';
  $("scene-caption").textContent = `DELTA \xD7 ${state.view === "time" ? "TIME OF DAY" : "EXPIRY BUCKET"} \xD7 IMPLIED VOLATILITY`;
}
function render(full = false) {
  refreshStats();
  updateReading();
  chart($("iv-chart"), data, state, stats, "iv", events);
  chart($("skew-chart"), data, state, stats, "skew", events);
  chart($("z-chart"), data, state, stats, "z", events);
  smileChart($("smile-chart"), data, state, curveStats);
  if (scene) scene.update(state, curveStats, full);
  else heatmap($("heatmap"), data, state, curveStats);
}
function seek(m) {
  state.m = Math.max(0, Math.min(data.manifest.lengths[state.s] - 1, m));
  render();
}
function pause() {
  state.playing = false;
  $("play").innerHTML = "Play <span>\u25B6</span>";
  $("play").setAttribute("aria-label", "Play replay");
  $("play").setAttribute("aria-pressed", "false");
}
function toggle() {
  state.playing = !state.playing;
  accumulator = 0;
  if (state.playing && state.m >= data.manifest.lengths[state.s] - 1) state.m = 0;
  $("play").innerHTML = state.playing ? "Pause <span>\u2161</span>" : "Play <span>\u25B6</span>";
  $("play").setAttribute("aria-label", state.playing ? "Pause replay" : "Play replay");
  $("play").setAttribute("aria-pressed", String(state.playing));
  render();
}
$("session").innerHTML = data.manifest.sessions.map((s, i) => `<option value="${i}" ${i === 30 ? "selected" : ""}>${s}${i === 30 ? " \xB7 live replay" : data.manifest.lengths[i] === 211 ? " \xB7 half-day" : ""}</option>`).reverse().join("");
for (const [id, key] of [["session", "s"], ["expiry", "e"], ["history", "window"], ["sampling", "sampling"], ["target", "target"], ["speed", "speed"]]) $(id).addEventListener("change", () => {
  state[key] = Number($(id).value);
  pause();
  state.m = Math.min(state.m, data.manifest.lengths[state.s] - 1);
  state.m = Math.floor(state.m / (state.sampling / 60)) * (state.sampling / 60);
  $("scrub").max = data.manifest.lengths[state.s] - 1;
  $("scrub").step = state.sampling / 60;
  render(true);
});
$("scrub").addEventListener("input", () => {
  pause();
  seek(Number($("scrub").value));
});
$("play").addEventListener("click", toggle);
$("reset").addEventListener("click", () => {
  pause();
  seek(0);
});
$("jump-event").addEventListener("click", () => {
  pause();
  seek(Math.floor(277 / (state.sampling / 60)) * (state.sampling / 60));
});
$("point-tape").addEventListener("click", (event) => {
  const b = event.target.closest("[data-target]");
  if (b) {
    state.target = Number(b.dataset.target);
    $("target").value = state.target;
    render();
  }
});
$("alerts").addEventListener("click", (event) => {
  const b = event.target.closest("[data-minute]");
  if (b) {
    pause();
    seek(Number(b.dataset.minute));
  }
});
for (const mode of ["iv", "z"]) $(`color-${mode}`).addEventListener("click", () => {
  state.colorMode = mode;
  setActive(["color-iv", "color-z"], `color-${mode}`);
  render(true);
});
for (const mode of ["time", "term"]) $(`view-${mode}`).addEventListener("click", () => {
  state.view = mode;
  setActive(["view-time", "view-term"], `view-${mode}`);
  render(true);
});
for (const mode of ["iv", "skew"]) $(`z-${mode}`).addEventListener("click", () => {
  state.zGroup = mode;
  setActive(["z-iv", "z-skew"], `z-${mode}`);
  render();
});
for (const [id, js] of [["iv-legend", [0, 1, 2, 3]], ["skew-legend", [4, 5, 6, 7]]]) $(id).innerHTML = js.map((j, i) => `<span><i style="--key:${COLORS[i]}"></i>${LABELS[j]}</span>`).join("");
$("about").addEventListener("click", () => $("how").showModal());
$("close-about").addEventListener("click", () => $("how").close());
$("how").addEventListener("click", (e) => {
  if (e.target === $("how")) {
    const r = $("how").getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) $("how").close();
  }
});
for (const id of ["iv-chart", "skew-chart", "z-chart"]) $(id).addEventListener("pointerdown", (event) => {
  const r = $(id).getBoundingClientRect();
  pause();
  const raw = (event.clientX - r.left - 44) / (r.width - 60) * (data.manifest.lengths[state.s] - 1);
  seek(Math.round(raw / (state.sampling / 60)) * (state.sampling / 60));
});
document.addEventListener("keydown", (event) => {
  if (event.target.matches("input,select,textarea,button,a") || $("how").open) return;
  if (event.code === "Space") {
    event.preventDefault();
    toggle();
  }
  if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
    event.preventDefault();
    pause();
    seek(state.m + (event.key === "ArrowRight" ? 1 : -1) * state.sampling / 60);
  }
  if (event.key === "Home") {
    event.preventDefault();
    pause();
    seek(0);
  }
  if (event.key === "[" || event.key === "]") {
    const speeds = [5, 20, 60, 300], i = speeds.indexOf(state.speed);
    state.speed = speeds[Math.max(0, Math.min(3, i + (event.key === "]" ? 1 : -1)))];
    $("speed").value = state.speed;
  }
});
let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => render(true), 100);
});
function frame(now) {
  const dt = Math.min(250, now - lastFrame);
  lastFrame = now;
  if (state.playing) {
    accumulator += dt * state.speed / 6e4;
    const step = state.sampling / 60;
    if (accumulator >= step) {
      state.m += Math.floor(accumulator / step) * step;
      accumulator %= step;
      if (state.m >= data.manifest.lengths[state.s] - 1) {
        state.m = data.manifest.lengths[state.s] - 1;
        pause();
      }
      render();
    }
  }
  scene?.frame();
  requestAnimationFrame(frame);
}
render(true);
function fallback(reason) {
  if (scene) {
    const old = scene;
    scene = null;
    old.dispose();
  }
  $("three-container").style.display = "none";
  $("heatmap").style.display = "block";
  $("surface-mode").textContent = reason;
  $("reset-camera").hidden = true;
  render(true);
}
document.fonts.ready.then(() => {
  try {
    if (new URLSearchParams(location.search).has("fallback")) throw new Error("Requested 2D view");
    $("three-container").style.display = "block";
    scene = createSurface($("three-container"), data, fallback);
    $("heatmap").style.display = "none";
    $("surface-mode").textContent = "3D / DRAG TO ORBIT \xB7 SCROLL TO ZOOM";
    $("reset-camera").hidden = false;
    $("reset-camera").addEventListener("click", () => scene?.reset());
    render(true);
    document.documentElement.dataset.surface = "3d";
  } catch (error) {
    fallback("2D / WEBGL UNAVAILABLE");
    document.documentElement.dataset.surface = "2d";
  }
});
requestAnimationFrame(frame);
window.smileWatch = { state, data, seek, render, get stats() {
  return stats;
}, get curveStats() {
  return curveStats;
}, get events() {
  return events;
}, setScene(value) {
  scene = value;
  render(true);
}, ready: true };
document.documentElement.dataset.ready = "true";
