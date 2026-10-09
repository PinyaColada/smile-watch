import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { index, clock } from "./data.js";
import { color, COLORS, LABELS, fmt } from "./charts.js";
export function createSurface(container, data, onFailure) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.7));
  renderer.setClearColor(528153, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);
  renderer.domElement.setAttribute("aria-label", "Synthetic 3D volatility surface. Drag to orbit, scroll or pinch to zoom.");
  renderer.domElement.setAttribute("role", "img");
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 150);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.enablePan = false;
  controls.minDistance = 11;
  controls.maxDistance = 38;
  controls.maxPolarAngle = Math.PI * 0.46;
  controls.minPolarAngle = 0.2;
  controls.target.set(0, 2.05, 0);
  let group = new THREE.Group(), axes = new THREE.Group(), cursor = new THREE.Group();
  scene.add(group, axes, cursor);
  let mainMaterial = null, wireMaterial = null, shapeKey = "", lastState = null, lastStats = null, dirty = true, lastCamera = "";
  const Y = (iv) => (iv - 0.13) * 28;
  const X = (j) => (j / 16 - 0.5) * 9.4;
  const Z = (t, end) => 4.4 - t / end * 8.8;
  const scalarColor = new THREE.Color();
  function dispose(group2) {
    group2.traverse((o) => {
      o.geometry?.dispose();
      if (o.material) {
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          m.map?.dispose();
          m.dispose();
        }
      }
    });
    group2.clear();
  }
  function line(points, color2, opacity = 1) {
    const geometry = new THREE.BufferGeometry().setFromPoints(points.map((p) => new THREE.Vector3(...p)));
    return new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: color2, transparent: opacity < 1, opacity, depthWrite: false }));
  }
  function label(text, position, size = 0.3, tint = "#91a7b6") {
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 64;
    const ctx = c.getContext("2d");
    ctx.font = '40px "IBM Plex Mono",monospace';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = tint;
    ctx.fillText(text, 256, 32);
    const texture = new THREE.CanvasTexture(c);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false }));
    sprite.position.set(...position);
    sprite.scale.set(size * 8 * 1.6, size * 1.6, 1);
    return sprite;
  }
  function reset() {
    camera.position.set(3, 5, 17);
    controls.target.set(0, 1.8, 0);
    controls.update();
    const bounds = [[-5.8, -0.5, 5.1], [5.8, -0.5, 5.1], [-5.8, -0.5, -5.1], [5.8, -0.5, -5.1], [-5.8, 5.8, 4.4], [-4.7, 5.8, -4.4]];
    for (let i = 0; i < 24; i++) {
      camera.updateMatrixWorld();
      const projected = bounds.map((p) => new THREE.Vector3(...p).project(camera));
      if (projected.every((p) => Math.abs(p.x) < 0.9 && Math.abs(p.y) < 0.9)) break;
      camera.position.sub(controls.target).multiplyScalar(1.045).add(controls.target);
      controls.update();
    }
    dirty = true;
  }
  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (w && h) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      dirty = true;
    }
  }
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  function createAxes(state) {
    dispose(axes);
    const end = data.manifest.lengths[state.s] - 1;
    for (let j = 0; j <= 16; j += 2) axes.add(line([[X(j), 0, -4.4], [X(j), 0, 4.4]], "#294051", 0.5));
    for (let i = 0; i <= 6; i++) {
      const z = 4.4 - i / 6 * 8.8;
      axes.add(line([[-4.7, 0, z], [4.7, 0, z]], "#294051", 0.5));
    }
    axes.add(line([[-4.7, 0, 4.4], [4.7, 0, 4.4]], "#60838f", 0.8));
    axes.add(line([[-4.7, 0, 4.4], [-4.7, 5.6, 4.4]], "#60838f", 0.65));
    axes.add(line([[4.7, 0, 4.4], [4.7, 0, -4.4]], "#60838f", 0.65));
    for (const [j, text] of [[1, "P15"], [3, "P25"], [8, "ATM"], [13, "C25"], [15, "C15"]]) axes.add(label(text, [X(j), -0.28, 4.7], 0.29));
    for (const iv of [0.15, 0.2, 0.25, 0.3]) {
      const y = Y(iv);
      axes.add(label(`${Math.round(iv * 100)}%`, [-5.3, y, 4.4], 0.28));
      axes.add(line([[-4.8, y, 4.4], [-4.6, y, 4.4]], "#7594a3", 0.7));
    }
    axes.add(label("IV", [-5.1, 5.6, 4.4], 0.25));
    if (state.view === "time") {
      for (const t of [0, 90, 180, 270, end].filter((t2) => t2 <= end)) axes.add(label(clock(t), [5.3, 0, Z(t, end)], 0.28));
    } else {
      [0, 1, 2, 3].forEach((e) => axes.add(label(`${data.manifest.tenors[e]}DTE`, [5.35, 0, Z(e, 3)], 0.29)));
    }
  }
  function shader(opacity, wire = false) {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: !wire,
      side: THREE.DoubleSide,
      wireframe: wire,
      uniforms: { cutoff: { value: 0 }, baseOpacity: { value: opacity }, term: { value: 0 } },
      vertexShader: `attribute vec3 tint; attribute float moment; varying vec3 vTint; varying float vMoment;
        void main(){vTint=tint;vMoment=moment;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: `uniform float cutoff;uniform float baseOpacity;uniform float term;varying vec3 vTint;varying float vMoment;
        void main(){float a=(term>0.5||vMoment<=cutoff)?baseOpacity:baseOpacity*0.12;
          gl_FragColor=vec4(vTint,a);}`
    });
  }
  function makeGeometry(state, stats, ghost = false) {
    const end = data.manifest.lengths[state.s] - 1;
    const steps = state.view === "term" ? [0, 1, 2, 3] : Array.from({ length: end + 1 }, (_, m) => m).filter((m) => m % 2 === 0 || m >= 266 && m <= 295 || m === end);
    const positions = [], tints = [], moments = [], valid = [];
    for (const step of steps) for (let j = 0; j < 17; j++) {
      const e = state.view === "term" ? step : state.e;
      const t = state.view === "term" ? Math.floor(state.m) : step;
      const b = (e * 391 + t) * 17 + j;
      const iv = ghost ? stats.mean[b] : data.curves[index(state.s, e, t, j, 17)];
      let c = ghost ? [110, 150, 173] : color(state.colorMode === "z" ? stats.z[b] : iv, state.colorMode);
      const shade = ghost ? 1 : 0.85 + 0.15 * Math.sin(j / 16 * Math.PI);
      c = c.map((v) => v / 255 * shade);
      positions.push(X(j), Number.isFinite(iv) ? Y(iv) : 0, Z(step, state.view === "term" ? 3 : end));
      scalarColor.setRGB(...c);
      tints.push(scalarColor.r, scalarColor.g, scalarColor.b);
      moments.push(step);
      valid.push(Number.isFinite(iv));
    }
    const indices = [];
    for (let r = 0; r < steps.length - 1; r++) for (let j = 0; j < 16; j++) {
      const a = r * 17 + j, b = a + 1, c = a + 17, d = c + 1;
      if (valid[a] && valid[b] && valid[c]) indices.push(a, c, b);
      if (valid[b] && valid[c] && valid[d]) indices.push(b, c, d);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("tint", new THREE.Float32BufferAttribute(tints, 3));
    geometry.setAttribute("moment", new THREE.Float32BufferAttribute(moments, 1));
    geometry.setIndex(indices);
    return geometry;
  }
  function rebuild(state, stats) {
    dispose(group);
    createAxes(state);
    const geometry = makeGeometry(state, stats);
    mainMaterial = shader(0.86);
    wireMaterial = shader(0.045, true);
    const mesh = new THREE.Mesh(geometry, mainMaterial);
    mesh.renderOrder = 2;
    group.add(mesh);
    const wire = new THREE.Mesh(geometry.clone(), wireMaterial);
    wire.renderOrder = 3;
    group.add(wire);
    const ghost = makeGeometry(state, stats, true);
    const ghostMesh = new THREE.Mesh(ghost, new THREE.MeshBasicMaterial({ color: 9546949, transparent: true, opacity: 0.055, side: THREE.DoubleSide, depthWrite: false }));
    ghostMesh.renderOrder = 1;
    group.add(ghostMesh);
    const positions = ghost.getAttribute("position"), rows = positions.count / 17;
    const addGhostLine = (ids) => {
      let points = [];
      for (const id of ids) {
        const y = positions.getY(id);
        if (y > 0) {
          points.push([positions.getX(id), y, positions.getZ(id)]);
        } else if (points.length) {
          group.add(line(points, "#91acc5", 0.26));
          points = [];
        }
      }
      if (points.length) group.add(line(points, "#91acc5", 0.26));
    };
    for (let row = 0; row < rows; row += state.view === "term" ? 1 : 12) addGhostLine(Array.from({ length: 17 }, (_, j) => row * 17 + j));
    for (const j of [0, 4, 8, 12, 16]) addGhostLine(Array.from({ length: rows }, (_, r) => r * 17 + j));
  }
  function cursorAt(state, stats) {
    dispose(cursor);
    const end = data.manifest.lengths[state.s] - 1, t = Math.floor(state.m);
    const z = state.view === "term" ? Z(state.e, 3) : Z(state.m, end);
    const points = [];
    let segment = [];
    for (let j = 0; j < 17; j++) {
      const v = data.curves[index(state.s, state.e, t, j, 17)];
      if (Number.isFinite(v)) {
        segment.push([X(j), Y(v) + 0.025, z]);
      } else if (segment.length) {
        points.push(segment);
        segment = [];
      }
    }
    if (segment.length) points.push(segment);
    points.forEach((p) => cursor.add(line(p, "#e7f9ed", 0.95)));
    let historical = [];
    for (let j = 0; j < 17; j++) {
      const v = stats.mean[(state.e * 391 + t) * 17 + j];
      if (Number.isFinite(v)) historical.push([X(j), Y(v), z]);
      else if (historical.length) {
        cursor.add(line(historical, "#849eb7", 0.7));
        historical = [];
      }
    }
    if (historical.length) cursor.add(line(historical, "#849eb7", 0.7));
    [1, 3, 13, 15].forEach((j, i) => {
      const iv = data.curves[index(state.s, state.e, t, j, 17)], mean = stats.mean[(state.e * 391 + t) * 17 + j];
      if (!Number.isFinite(iv)) return;
      const sphere = new THREE.Mesh(new THREE.SphereGeometry(i === state.target ? 0.105 : 0.075, 14, 10), new THREE.MeshBasicMaterial({ color: COLORS[i], depthTest: false }));
      sphere.position.set(X(j), Y(iv) + 0.035, z);
      sphere.renderOrder = 10;
      cursor.add(sphere);
      if (Number.isFinite(mean)) cursor.add(line([[X(j), Y(mean), z], [X(j), Y(iv), z]], COLORS[i], 0.8));
      if (i === state.target) cursor.add(label(`${LABELS[i]}  ${fmt(iv * 100)}%`, [X(j), Y(iv) + 0.43, z], 0.32, "#ddf2e9"));
    });
    cursor.add(line([[-4.7, 0.015, z], [4.7, 0.015, z]], "#8bd5cb", 0.42));
  }
  function update(state, stats, full = false) {
    lastState = { ...state };
    lastStats = stats;
    const key = [state.s, state.e, state.window, state.view, state.colorMode, state.view === "term" ? Math.floor(state.m) : ""].join("/");
    if (key !== shapeKey || full) {
      rebuild(state, stats);
      shapeKey = key;
    }
    mainMaterial.uniforms.cutoff.value = state.m;
    wireMaterial.uniforms.cutoff.value = state.m;
    mainMaterial.uniforms.term.value = state.view === "term" ? 1 : 0;
    wireMaterial.uniforms.term.value = state.view === "term" ? 1 : 0;
    cursorAt(state, stats);
    dirty = true;
  }
  function frame() {
    controls.update();
    const cameraKey = camera.position.toArray().join(",") + camera.quaternion.toArray().join(",");
    if (cameraKey !== lastCamera) dirty = true;
    lastCamera = cameraKey;
    if (dirty) {
      renderer.render(scene, camera);
      dirty = false;
    }
  }
  renderer.domElement.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    observer.disconnect();
    controls.dispose();
    onFailure("WebGL context lost \xB7 2D fallback");
  });
  controls.addEventListener("change", () => {
    dirty = true;
  });
  resize();
  reset();
  return { update, frame, reset, dispose() {
    observer.disconnect();
    controls.dispose();
    dispose(group);
    dispose(cursor);
    dispose(axes);
    renderer.dispose();
    renderer.domElement.remove();
  }, get state() {
    return lastState;
  }, get stats() {
    return lastStats;
  } };
}
