import { index, clock, sampledMinutes } from "./data.js";
export const COLORS = ["#b6c6ee", "#8bd5cb", "#c3a6d8", "#c5b48f"];
export const LABELS = ["15\u0394 put", "25\u0394 put", "25\u0394 call", "15\u0394 call", "25\u0394 RR", "15\u0394 RR", "Put wing", "Call wing"];
export const LONG = ["15 delta put IV", "25 delta put IV", "25 delta call IV", "15 delta call IV", "25 delta risk reversal", "15 delta risk reversal", "Put wing", "Call wing"];
export const fmt = (v, n = 2) => Number.isFinite(v) ? v.toFixed(n) : "\u2014";
export const signed = (v, n = 2) => Number.isFinite(v) ? `${v >= 0 ? "+" : ""}${v.toFixed(n)}` : "\u2014";
export function context(canvas) {
  const { width, height } = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(width)), h = Math.max(1, Math.round(height));
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.font = '10px "IBM Plex Mono", monospace';
  ctx.lineWidth = 1;
  return { ctx, w, h };
}
function axes(ctx, w, h, lo, hi, labels, reference = []) {
  const p = { l: 44, r: 16, t: 15, b: 28 };
  const X = (x) => p.l + x * (w - p.l - p.r), Y = (y) => h - p.b - (y - lo) / (hi - lo) * (h - p.t - p.b);
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  const ticks = reference.length ? reference : Array.from({ length: 5 }, (_, i) => lo + (hi - lo) * i / 4);
  for (const v of ticks) {
    if (v < lo || v > hi) continue;
    const y = Y(v);
    ctx.strokeStyle = reference.length ? "#65443d" : "#253342";
    ctx.setLineDash(reference.length ? [3, 5] : []);
    ctx.beginPath();
    ctx.moveTo(p.l, y);
    ctx.lineTo(w - p.r, y);
    ctx.stroke();
    ctx.fillStyle = reference.length ? "#c69486" : "#8497a6";
    ctx.fillText(reference.length ? signed(v, 0) : fmt(v, 1), p.l - 8, y);
  }
  ctx.setLineDash([]);
  ctx.textBaseline = "top";
  for (const [x, text] of labels) {
    ctx.textAlign = x === 0 ? "left" : x === 1 ? "right" : "center";
    ctx.fillStyle = "#8194a3";
    ctx.fillText(text, X(x), h - p.b + 12);
  }
  return { X, Y, p };
}
function path(ctx, points, color2, width = 1.5, dash = []) {
  ctx.strokeStyle = color2;
  ctx.lineWidth = width;
  ctx.setLineDash(dash);
  ctx.beginPath();
  let open = false;
  for (const [x, y] of points) {
    if (!Number.isFinite(y)) {
      open = false;
      continue;
    }
    if (!open) {
      ctx.moveTo(x, y);
      open = true;
    } else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineWidth = 1;
}
export function chart(canvas, data, state, stats, kind, crossings) {
  const { ctx, w, h } = context(canvas), { s, e, m, sampling, target, zGroup } = state;
  const len = data.manifest.lengths[s], minutes = sampledMinutes(len, sampling, m);
  const js = kind === "iv" ? [0, 1, 2, 3] : kind === "skew" ? [4, 5, 6, 7] : zGroup === "iv" ? [0, 1, 2, 3] : [4, 5, 6, 7];
  const get = (t, j) => kind === "z" ? stats.z[(e * 391 + Math.floor(t)) * 8 + j] : data.values[index(s, e, Math.floor(t), j)] * 100;
  const all = minutes.flatMap((t) => js.map((j) => get(t, j))).filter(Number.isFinite);
  let lo = all.length ? Math.min(...all) : 0, hi = all.length ? Math.max(...all) : 1;
  if (kind === "z") {
    lo = Math.min(-3.8, lo - 0.5);
    hi = Math.max(3.8, hi + 0.5);
  } else {
    const pad = Math.max((hi - lo) * 0.12, 0.15);
    lo -= pad;
    hi += pad;
  }
  const end = len - 1, ticks = [0, Math.round(end / 3), Math.round(2 * end / 3), end].map((x) => [x / end, clock(x)]);
  const { X, Y, p } = axes(ctx, w, h, lo, hi, ticks, kind === "z" ? [-3, -2, 0, 2, 3] : []);
  if (s === 30 && end >= 270) {
    ctx.strokeStyle = "#764936";
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(X(270 / end), p.t);
    ctx.lineTo(X(270 / end), h - p.b);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(p.l, p.t, w - p.l - p.r, h - p.t - p.b);
  ctx.clip();
  for (let i = 0; i < js.length; i++) {
    const j = js[i];
    path(ctx, minutes.map((t) => [X(t / end), Y(get(t, j))]), COLORS[i], j === target ? 2 : 1.4);
    if (kind === "z") for (const c of crossings.filter((c2) => c2.j === j && c2.m <= m)) {
      const x = X(c.m / end), y = Y(c.z);
      ctx.fillStyle = "#ff785d";
      ctx.beginPath();
      ctx.moveTo(x, y - 4);
      ctx.lineTo(x + 3, y + 3);
      ctx.lineTo(x - 3, y + 3);
      ctx.closePath();
      ctx.fill();
    }
    const last = minutes.at(-1), value = last !== void 0 ? get(last, j) : NaN;
    if (Number.isFinite(value)) {
      ctx.fillStyle = COLORS[i];
      ctx.beginPath();
      ctx.arc(X(last / end), Y(value), 2.7, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.strokeStyle = "#a5bcc275";
  ctx.beginPath();
  ctx.moveTo(X(m / end), p.t);
  ctx.lineTo(X(m / end), h - p.b);
  ctx.stroke();
  ctx.restore();
  if (!all.length) {
    ctx.fillStyle = "#9db0bc";
    ctx.textAlign = "center";
    ctx.fillText(kind === "z" ? "At least 8 valid prior sessions required" : "No valid quotes at this sampling time", w / 2, h / 2);
  }
}
export function smileChart(canvas, data, state, stats) {
  const { ctx, w, h } = context(canvas), { s, e, m, target } = state, t = Math.floor(m), width = 17;
  const v = Array.from({ length: 17 }, (_, j) => data.curves[index(s, e, t, j, width)] * 100);
  const mean = Array.from({ length: 17 }, (_, j) => stats.mean[(e * 391 + t) * 17 + j] * 100);
  const std = Array.from({ length: 17 }, (_, j) => stats.std[(e * 391 + t) * 17 + j] * 100);
  const all = [...v, ...mean.map((x, i) => x + std[i]), ...mean.map((x, i) => x - std[i])].filter(Number.isFinite);
  let lo = all.length ? Math.min(...all) - 1 : 14, hi = all.length ? Math.max(...all) + 1 : 30;
  const { X, Y } = axes(ctx, w, h, lo, hi, [[1 / 16, "P15"], [3 / 16, "P25"], [0.5, "ATM"], [13 / 16, "C25"], [15 / 16, "C15"]]);
  for (let j = 0; j < 16; j++) if ([mean[j], mean[j + 1], std[j], std[j + 1]].every(Number.isFinite)) {
    ctx.fillStyle = "#8595ab20";
    ctx.beginPath();
    ctx.moveTo(X(j / 16), Y(mean[j] + std[j]));
    ctx.lineTo(X((j + 1) / 16), Y(mean[j + 1] + std[j + 1]));
    ctx.lineTo(X((j + 1) / 16), Y(mean[j + 1] - std[j + 1]));
    ctx.lineTo(X(j / 16), Y(mean[j] - std[j]));
    ctx.closePath();
    ctx.fill();
  }
  path(ctx, mean.map((v2, j) => [X(j / 16), Y(v2)]), "#a4b1c5", 1, [4, 4]);
  path(ctx, v.map((v2, j) => [X(j / 16), Y(v2)]), "#8bd5cb", 2);
  [1, 3, 13, 15].forEach((j, i) => {
    if (!Number.isFinite(v[j])) return;
    ctx.fillStyle = COLORS[i];
    ctx.strokeStyle = "#0c1722";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(X(j / 16), Y(v[j]), i === target ? 5.5 : 4, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
  });
  if (!v.some(Number.isFinite)) {
    ctx.fillStyle = "#9db0bc";
    ctx.textAlign = "center";
    ctx.fillText("Smile unavailable \xB7 expiry or quote quality", w / 2, h / 2);
  }
}
export function color(value, mode = "iv") {
  if (!Number.isFinite(value)) return [44, 57, 69];
  let a, b, t;
  if (mode === "z") {
    t = Math.min(1, Math.abs(value) / 3);
    a = [168, 184, 191];
    b = value < 0 ? [61, 130, 183] : [255, 120, 93];
  } else {
    t = Math.max(0, Math.min(1, (value - 0.15) / 0.18));
    if (t < 0.55) {
      a = [37, 73, 111];
      b = [126, 204, 193];
      t /= 0.55;
    } else {
      a = [126, 204, 193];
      b = [225, 218, 171];
      t = (t - 0.55) / 0.45;
    }
  }
  return a.map((x, i) => Math.round(x + (b[i] - x) * t));
}
export function heatmap(canvas, data, state, stats) {
  const { ctx, w, h } = context(canvas), { s, e, m, colorMode, view } = state;
  const len = data.manifest.lengths[s], p = { l: 50, r: 22, t: 26, b: 40 };
  const count = view === "term" ? 4 : len;
  const cw = (w - p.l - p.r) / count, ch = (h - p.t - p.b) / 17;
  for (let x = 0; x < count; x++) for (let j = 0; j < 17; j++) {
    const expiry = view === "term" ? x : e, t = view === "term" ? Math.floor(m) : x;
    const a = (expiry * 391 + t) * 17 + j;
    const value = colorMode === "z" ? stats.z[a] : data.curves[index(s, expiry, t, j, 17)];
    ctx.fillStyle = `rgba(${color(value, colorMode).join(",")},${view === "term" || x <= m ? 0.9 : 0.14})`;
    ctx.fillRect(p.l + x * cw, p.t + (16 - j) * ch, cw + 0.5, ch + 0.5);
  }
  ctx.fillStyle = "#9bb0c0";
  ctx.textBaseline = "middle";
  ctx.textAlign = "right";
  [[1, "P15"], [3, "P25"], [8, "ATM"], [13, "C25"], [15, "C15"]].forEach(([j, label]) => ctx.fillText(label, p.l - 8, p.t + (16 - j + 0.5) * ch));
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  (view === "term" ? [0, 1, 2, 3] : [0, 90, 180, 270, len - 1].filter((x) => x < len)).forEach((x) => ctx.fillText(view === "term" ? `${data.manifest.tenors[x]}DTE` : clock(x), p.l + (x + 0.5) * cw, h - p.b + 8));
  if (view === "time") {
    const x = p.l + m * cw;
    ctx.strokeStyle = "#e5f4f0";
    ctx.beginPath();
    ctx.moveTo(x, p.t - 8);
    ctx.lineTo(x, h - p.b);
    ctx.stroke();
    [1, 3, 13, 15].forEach((j, i) => {
      ctx.fillStyle = COLORS[i];
      ctx.strokeStyle = "#0b1724";
      ctx.beginPath();
      ctx.arc(x, p.t + (16 - j + 0.5) * ch, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
  }
}
