// Three.js scene shared by the 2D fallback (orbitable 3D ward map) and WebXR immersive-ar.
import * as THREE from 'three';

export const STATUS_COLORS = {
  Filed: '#ef4444',
  Acknowledged: '#f97316',
  Assigned: '#eab308',
  'In progress': '#3b82f6',
  Completed: '#22c55e',
  Verified: '#16a34a',
  Reopened: '#d946ef',
  Pending: '#9ca3af',
};
const DONE = new Set(['Completed', 'Verified']);
const ISSUE_ICON = { pothole: '🕳️', garbage: '🗑️', streetlight: '💡', waterlogging: '🌊' };
const WARD_COLORS = ['#26324a', '#2b3a55', '#233247', '#2e3b52', '#28354d', '#24314a', '#2a3850', '#27344c'];
const MAP_W = 4; // map width in scene units (2D view). In AR the map is scaled to ~0.6 m.

// ---------- canvas helpers ----------
function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function fitText(g, text, maxW) {
  let t = text;
  while (g.measureText(t).width > maxW && t.length > 3) t = t.slice(0, -2);
  return t === text ? t : t.slice(0, -1) + '…';
}

// Billboard label. Anchored at its bottom centre.
function labelSprite({ title, sub, line3, color = '#fff', worldWidth = 0.5 }) {
  const W = 560, H = line3 ? 196 : 140;
  const tex = canvasTexture(W, H, (g) => {
    g.fillStyle = 'rgba(11,15,23,0.92)';
    g.beginPath(); g.roundRect(4, 4, W - 8, H - 8, 26); g.fill();
    g.lineWidth = 4; g.strokeStyle = color; g.stroke();
    g.fillStyle = color;
    g.beginPath(); g.roundRect(4, 4, 18, H - 8, [26, 0, 0, 26]); g.fill();
    g.textBaseline = 'top';
    g.fillStyle = '#fff'; g.font = 'bold 46px system-ui, sans-serif';
    g.fillText(fitText(g, title, W - 60), 40, 18);
    g.fillStyle = color; g.font = 'bold 36px system-ui, sans-serif';
    g.fillText(fitText(g, sub, W - 60), 40, 76);
    if (line3) { g.fillStyle = '#c3cbe0'; g.font = '30px system-ui, sans-serif'; g.fillText(fitText(g, line3, W - 60), 40, 132); }
  });
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const s = new THREE.Sprite(mat);
  s.center.set(0.5, 0);
  s.scale.set(worldWidth, (worldWidth * H) / W, 1);
  s.renderOrder = 10;
  return s;
}

function textSprite(text, { color = '#fff', bg = null, size = 64, worldHeight = 0.12 } = {}) {
  const g0 = document.createElement('canvas').getContext('2d');
  g0.font = `bold ${size}px system-ui, sans-serif`;
  const W = Math.ceil(g0.measureText(text).width) + 48, H = size + 36;
  const tex = canvasTexture(W, H, (g) => {
    if (bg) { g.fillStyle = bg; g.beginPath(); g.roundRect(0, 0, W, H, H / 2); g.fill(); }
    g.font = `bold ${size}px system-ui, sans-serif`;
    g.textBaseline = 'middle'; g.textAlign = 'center';
    g.lineWidth = 8; g.strokeStyle = 'rgba(0,0,0,0.6)';
    if (!bg) g.strokeText(text, W / 2, H / 2 + 2);
    g.fillStyle = color; g.fillText(text, W / 2, H / 2 + 2);
  });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set((worldHeight * W) / H, worldHeight, 1);
  s.renderOrder = 11;
  return s;
}

function disposeTree(obj) {
  obj.traverse((o) => {
    o.geometry?.dispose?.();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    mats.forEach((m) => { m.map?.dispose?.(); m.dispose?.(); });
  });
}

// Pin: downward cone + ball head + ground ring. ~0.3 units tall at scale 1, tip at y=0.
function makePin(color, done) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.1, emissive: color, emissiveIntensity: 0.25 });
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.2, 24), mat);
  cone.rotation.x = Math.PI; cone.position.y = 0.1;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.075, 24, 16), mat);
  head.position.y = 0.23;
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.07, 0.11, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
  ring.position.y = 0.003;
  const bob = new THREE.Group();
  bob.add(cone, head);
  g.add(bob, ring);
  if (done) {
    const check = textSprite('✓', { color: '#fff', bg: '#16a34a', size: 80, worldHeight: 0.1 });
    check.position.y = 0.38;
    bob.add(check);
  }
  // Big invisible hit target so small pins are easy to tap.
  const hit = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  hit.position.y = 0.2;
  g.add(hit);
  g.userData.bob = bob;
  g.userData.ring = ring;
  return g;
}

export class SceneManager {
  constructor(canvas, handlers = {}) {
    this.canvas = canvas;
    this.h = handlers; // { onPinTap(id), onPlaced(kind, payload), onSessionEnd(), onHint(text|null) }
    this.state = null;
    this.mode = 'citizen';
    this.tickers = [];
    this.placed = new Map(); // ticketId|tempId -> Vector3 (AR world positions placed this session)
    this.placing = null;
    this.floorY = -1.4;
    this.floorKnown = false;
    this.focusId = null;

    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }));
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.setClearColor(0x000000, 0);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.xr.enabled = true;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
    this.camDist = 5.6;
    this.camera.position.set(0, 3.6, 4.3);
    this.camera.lookAt(0, 0, 0.2);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x334466, 2.2));
    const dir = new THREE.DirectionalLight(0xffffff, 1.6);
    dir.position.set(2, 5, 3);
    this.scene.add(dir);

    this.mapRoot = new THREE.Group(); // positioned/scaled (AR placement), rotated by drag in 2D
    this.map = new THREE.Group();
    this.mapPins = new THREE.Group();
    this.leaders = new THREE.Group();
    this.map.add(this.mapPins, this.leaders);
    this.mapRoot.add(this.map);
    this.scene.add(this.mapRoot);

    this.world = new THREE.Group(); // AR world pins
    this.world.visible = false;
    this.scene.add(this.world);

    const ret = new THREE.Group();
    ret.add(new THREE.Mesh(new THREE.RingGeometry(0.08, 0.1, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffcc33 })));
    ret.add(new THREE.Mesh(new THREE.CircleGeometry(0.015, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff })));
    ret.matrixAutoUpdate = false;
    ret.visible = false;
    this.reticle = ret;
    this.scene.add(ret);

    this.raycaster = new THREE.Raycaster();
    this.clock = new THREE.Clock();
    this.bindPointer();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    this.resize();
    r.setAnimationLoop((t, frame) => this.loop(t, frame));
  }

  // ---------- data ----------
  setData(state) {
    const firstBuild = !this.state || this.state.wards !== state.wards;
    this.state = state;
    if (firstBuild) this.buildMapBase();
    this.buildMapPins();
    this.buildLeaders();
    this.buildWorldPins();
  }

  setMode(mode) {
    this.mode = mode;
    this.leaders.visible = true;
    this.updateVisibility();
    if (!this.inAR) this.placeCamera();
  }

  setUserLocation(loc) { this.userLoc = loc; }

  focus(id) {
    this.focusId = id;
  }

  // ---------- map ----------
  computeProjection() {
    const ws = this.state.wards;
    const minLat = Math.min(...ws.map((w) => w.bbox.minLat)), maxLat = Math.max(...ws.map((w) => w.bbox.maxLat));
    const minLng = Math.min(...ws.map((w) => w.bbox.minLng)), maxLng = Math.max(...ws.map((w) => w.bbox.maxLng));
    const latC = (minLat + maxLat) / 2, lngC = (minLng + maxLng) / 2;
    const cos = Math.cos((latC * Math.PI) / 180);
    const k = MAP_W / ((maxLng - minLng) * cos);
    this.proj = (lat, lng) => new THREE.Vector3((lng - lngC) * cos * k, 0, -(lat - latC) * k);
    this.mapDepth = (maxLat - minLat) * k;
  }

  buildMapBase() {
    if (this.base) { this.map.remove(this.base); disposeTree(this.base); }
    this.computeProjection();
    const base = (this.base = new THREE.Group());
    const pad = 0.35;
    const plate = new THREE.Mesh(new THREE.BoxGeometry(MAP_W + pad * 2, 0.06, this.mapDepth + pad * 2), new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.9 }));
    plate.position.y = -0.03;
    base.add(plate);
    // Sabarmati river (rough, for orientation)
    const a = this.proj(22.975, 72.583), b = this.proj(23.093, 72.583);
    const river = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.012, Math.abs(b.z - a.z)), new THREE.MeshStandardMaterial({ color: 0x2563eb, emissive: 0x1d4ed8, emissiveIntensity: 0.4 }));
    river.position.set(a.x, 0.006, (a.z + b.z) / 2);
    base.add(river);
    const rl = textSprite('Sabarmati', { color: '#93c5fd', size: 40, worldHeight: 0.09 });
    rl.position.set(a.x + 0.02, 0.08, a.z - 0.1);
    base.add(rl);

    this.state.wards.forEach((w, i) => {
      const p1 = this.proj(w.bbox.minLat, w.bbox.minLng), p2 = this.proj(w.bbox.maxLat, w.bbox.maxLng);
      const wd = Math.abs(p2.x - p1.x), dp = Math.abs(p2.z - p1.z);
      const tile = new THREE.Mesh(new THREE.BoxGeometry(wd, 0.05, dp), new THREE.MeshStandardMaterial({ color: WARD_COLORS[i % WARD_COLORS.length], roughness: 0.7 }));
      tile.position.set((p1.x + p2.x) / 2, 0.025, (p1.z + p2.z) / 2);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(tile.geometry), new THREE.LineBasicMaterial({ color: 0x5b6b8c }));
      tile.add(edges);
      base.add(tile);
      const lbl = textSprite(`${w.name} · W${w.number}`, { color: '#dbe4f5', size: 40, worldHeight: 0.13 });
      lbl.position.set(tile.position.x, 0.07, tile.position.z + dp / 2 - 0.06);
      lbl.center.set(0.5, 0);
      base.add(lbl);
    });
    this.map.add(base);
  }

  mapPos(c) {
    const w = this.state.wards.find((x) => x.id === c.ward);
    const inside = w && c.lat >= w.bbox.minLat && c.lat <= w.bbox.maxLat && c.lng >= w.bbox.minLng && c.lng <= w.bbox.maxLng;
    if (inside || !w) return this.proj(c.lat, c.lng);
    let h = 0;
    for (const ch of c.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const p = this.proj(w.center.lat, w.center.lng);
    p.x += ((h % 100) / 100 - 0.5) * 0.25;
    p.z += (((h >> 8) % 100) / 100 - 0.5) * 0.25;
    return p;
  }

  userTitle(name) {
    return this.state.users.find((u) => u.name === name)?.title || 'Citizen';
  }

  buildMapPins() {
    this.mapPins.children.slice().forEach((o) => { this.mapPins.remove(o); disposeTree(o); });
    for (const c of this.state.complaints) {
      const color = STATUS_COLORS[c.status] || '#999';
      const pin = makePin(color, DONE.has(c.status));
      pin.scale.setScalar(0.9);
      pin.position.copy(this.mapPos(c)).setY(0.05);
      pin.userData.ticketId = c.id;
      const lbl = labelSprite({ title: `${ISSUE_ICON[c.issueType] || ''} ${c.id.replace('AMC-', '')}`, sub: c.status + (c.status === 'Verified' ? ' ✓' : ''), color, worldWidth: 0.85 });
      lbl.position.y = 0.42;
      pin.userData.bob.add(lbl);
      pin.userData.phase = Math.random() * 6;
      this.mapPins.add(pin);
    }
  }

  buildLeaders() {
    this.leaders.children.slice().forEach((o) => { this.leaders.remove(o); disposeTree(o); });
    const top = [...this.state.users].sort((a, b) => b.points - a.points).slice(0, 3);
    const medal = ['🥇', '🥈', '🥉'], colors = [0xffcc33, 0xc0c7d4, 0xcd7f32], heights = [0.9, 0.62, 0.45];
    const xs = [0, -1.15, 1.15];
    const z = -this.mapDepth / 2 - 0.15;
    top.forEach((u, i) => {
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.5, heights[i], 0.3), new THREE.MeshStandardMaterial({ color: colors[i], metalness: 0.5, roughness: 0.3 }));
      col.position.set(xs[i], heights[i] / 2, z);
      this.leaders.add(col);
      const lbl = labelSprite({ title: `${medal[i]} ${u.name}`, sub: `${u.points} pts`, line3: u.title, color: '#' + colors[i].toString(16).padStart(6, '0'), worldWidth: 1.05 });
      lbl.position.set(xs[i], heights[i] + 0.12, z);
      lbl.userData.floatBase = heights[i] + 0.12;
      lbl.userData.phase = i;
      this.leaders.add(lbl);
    });
    this.leaders.visible = true;
  }

  // AR world pins: pins placed this session at their real spot, others in a fan in front of the user.
  buildWorldPins() {
    this.world.children.slice().forEach((o) => { this.world.remove(o); disposeTree(o); });
    const cs = this.state.complaints;
    const byId = new Map(cs.map((c) => [c.id, c]));
    for (const [id, pos] of this.placed) {
      const c = byId.get(id);
      this.world.add(this.worldPin(c, id, pos.clone(), null));
    }
    const loc = this.userLoc;
    const dist = (c) => (loc ? haversine(loc.lat, loc.lng, c.lat, c.lng) : null);
    const others = cs.filter((c) => !this.placed.has(c.id))
      .map((c) => ({ c, d: dist(c) }))
      .sort((a, b) => (a.d ?? 0) - (b.d ?? 0) || b.c.createdAt.localeCompare(a.c.createdAt))
      .slice(0, 7);
    others.forEach(({ c, d }, i) => {
      const n = others.length;
      const ang = n === 1 ? 0 : -1.0 + (2.0 * i) / (n - 1); // ±57° fan
      const r = 3 + (i % 3) * 1.2;
      const pos = new THREE.Vector3(Math.sin(ang) * r, this.floorY, -Math.cos(ang) * r);
      this.world.add(this.worldPin(c, c.id, pos, d));
    });
  }

  worldPin(c, id, pos, distM) {
    const status = c?.status || 'Pending';
    const color = STATUS_COLORS[status];
    const pin = makePin(color, DONE.has(status));
    pin.scale.setScalar(1.6);
    pin.position.copy(pos);
    pin.userData.ticketId = c ? c.id : null;
    pin.userData.phase = Math.random() * 6;
    const title = c ? `${ISSUE_ICON[c.issueType] || ''} ${c.id}` : 'Filing complaint…';
    const sub = c ? `● ${status}${status === 'Verified' ? ' ✓' : ''}${distM != null ? ` · ${fmtDist(distM)} away` : ''}` : 'Agent is working';
    const line3 = c ? `Reported by ${c.user.split(' ')[0]} · ${this.userTitle(c.user)}` : null;
    const lbl = labelSprite({ title, sub, line3, color, worldWidth: 0.42 });
    lbl.position.y = 0.42;
    pin.userData.bob.add(lbl);
    return pin;
  }

  // ---------- AR ----------
  static async arSupported() {
    try { return !!(navigator.xr && (await navigator.xr.isSessionSupported('immersive-ar'))); } catch { return false; }
  }

  async startAR(overlayEl) {
    const session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay', 'local-floor'],
      domOverlay: { root: overlayEl },
    });
    this.renderer.xr.setReferenceSpaceType('local');
    await this.renderer.xr.setSession(session);
    this.session = session;
    this.refSpace = this.renderer.xr.getReferenceSpace();
    const viewer = await session.requestReferenceSpace('viewer');
    this.hitSource = await session.requestHitTestSource({ space: viewer });
    this.placed.clear(); // new session = new origin
    this.floorKnown = false;
    this.mapPlacedInAR = false;
    this.savedMap = { pos: this.mapRoot.position.clone(), rot: this.mapRoot.rotation.y, scale: this.mapRoot.scale.x, mapRot: this.map.rotation.y };
    this.mapRoot.rotation.set(0, 0, 0);
    this.map.rotation.y = 0;
    this.buildWorldPins();
    this.updateVisibility();
    session.addEventListener('select', (e) => this.onSelect(e));
    session.addEventListener('end', () => {
      this.hitSource = null;
      this.session = null;
      this.reticle.visible = false;
      this.placing = null;
      const s = this.savedMap;
      this.mapRoot.position.copy(s.pos); this.mapRoot.rotation.y = s.rot; this.mapRoot.scale.setScalar(s.scale); this.map.rotation.y = s.mapRot;
      this.updateVisibility();
      this.resize();
      this.h.onSessionEnd?.();
    });
    return { domOverlay: !!session.domOverlayState };
  }

  endAR() { this.session?.end(); }

  get inAR() { return !!this.session; }

  updateVisibility() {
    if (this.inAR) {
      this.world.visible = !this.mapPlacedInAR;
      this.mapRoot.visible = !!this.mapPlacedInAR;
    } else {
      this.world.visible = false;
      this.mapRoot.visible = true;
    }
  }

  // kind: 'pin' (payload = { key }) or 'map'
  showPins() {
    this.mapPlacedInAR = false;
    this.updateVisibility();
  }

  beginPlacement(kind, payload = {}) {
    if (kind === 'pin' && this.mapPlacedInAR) this.showPins();
    this.placing = { kind, ...payload };
    this.h.onHint?.(kind === 'map' ? 'Point at a table and tap to place the ward map' : 'Point at the issue on the ground and tap to drop the pin');
  }

  cancelPlacement() { this.placing = null; this.h.onHint?.(null); }

  // A pin placed before the ticket existed gets its real ID later.
  rekeyPlaced(oldKey, newId) {
    const p = this.placed.get(oldKey);
    if (!p) return;
    this.placed.delete(oldKey);
    if (newId) this.placed.set(newId, p);
    if (this.state) this.buildWorldPins();
  }

  onSelect(e) {
    const pose = e.frame.getPose(e.inputSource.targetRaySpace, this.refSpace);
    if (this.placing && this.reticle.visible) {
      const pos = new THREE.Vector3().setFromMatrixPosition(this.reticle.matrix);
      const p = this.placing;
      this.placing = null;
      this.h.onHint?.(null);
      if (p.kind === 'map') {
        this.mapRoot.position.copy(pos);
        this.mapRoot.scale.setScalar(0.6 / MAP_W);
        // face the user
        const cam = this.renderer.xr.getCamera();
        const cp = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
        this.mapRoot.rotation.y = Math.atan2(cp.x - pos.x, cp.z - pos.z);
        this.mapPlacedInAR = true;
        this.updateVisibility();
      } else {
        this.placed.set(p.key, pos);
        this.buildWorldPins();
        this.spawnRipple(pos);
      }
      this.h.onPlaced?.(p.kind, p);
      return;
    }
    if (!pose) return;
    const m = new THREE.Matrix4().fromArray(pose.transform.matrix);
    const origin = new THREE.Vector3().setFromMatrixPosition(m);
    const dir = new THREE.Vector3(0, 0, -1).transformDirection(m);
    this.raycaster.set(origin, dir);
    const id = this.pickPin();
    if (id) this.h.onPinTap?.(id);
  }

  pickPin() {
    const targets = [];
    if (this.world.visible) targets.push(this.world);
    if (this.mapRoot.visible) targets.push(this.mapPins);
    const hits = this.raycaster.intersectObjects(targets, true);
    for (const h of hits) {
      let o = h.object;
      while (o && o.userData.ticketId === undefined) o = o.parent;
      if (o?.userData.ticketId) return o.userData.ticketId;
    }
    return null;
  }

  // ---------- 2D interaction ----------
  bindPointer() {
    const c = this.canvas;
    const pts = new Map();
    let start = null, lastPinch = null;
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      start = { x: e.clientX, y: e.clientY, moved: false };
    });
    c.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      const prev = pts.get(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (lastPinch) this.zoom(lastPinch / d);
        lastPinch = d;
        if (start) start.moved = true;
        return;
      }
      const dx = e.clientX - prev.x;
      this.map.rotation.y += dx * 0.008;
      if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) start.moved = true;
    });
    const up = (e) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) lastPinch = null;
      if (start && !start.moved && pts.size === 0 && e.type === 'pointerup') this.tap2D(e);
      if (pts.size === 0) start = null;
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', (e) => { e.preventDefault(); this.zoom(e.deltaY > 0 ? 1.1 : 0.9); }, { passive: false });
  }

  zoom(f) {
    this.userZoomed = true;
    this.camDist = Math.min(10, Math.max(2.5, this.camDist * f));
    this.placeCamera();
  }

  placeCamera() {
    // Officer view pulls back and tilts up so the floating top-3 podium fits.
    const off = true; // podium of top citizens is always shown above the map
    const k = (this.camDist / 5.6) * (off ? 1.18 : 1);
    this.camera.position.set(0, 3.6 * k, 4.3 * k);
    this.camera.lookAt(0, off ? 0.45 : 0, off ? -0.35 : 0.2);
  }

  tap2D(e) {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const id = this.pickPin();
    if (id) this.h.onPinTap?.(id);
  }

  resize() {
    if (this.renderer.xr.isPresenting) return;
    const p = this.canvas.parentElement;
    const w = p.clientWidth || 1, h = p.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Fit the map on narrow (portrait) screens.
    const base = w / h < 1 ? 4.5 / Math.max(0.6, w / h) : 4.8;
    if (!this.userZoomed) this.camDist = Math.min(10, base);
    this.camera.updateProjectionMatrix();
    this.placeCamera();
  }

  // ---------- effects ----------
  spawnRipple(pos) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.14, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffcc33, transparent: true, side: THREE.DoubleSide }));
    ring.position.copy(pos).add(new THREE.Vector3(0, 0.01, 0));
    this.scene.add(ring);
    let t = 0;
    this.tickers.push((dt) => {
      t += dt;
      ring.scale.setScalar(1 + t * 6);
      ring.material.opacity = Math.max(0, 1 - t / 0.9);
      if (t > 0.9) { this.scene.remove(ring); disposeTree(ring); return false; }
      return true;
    });
  }

  // 3D badge that pops out in front of the camera and spins.
  popBadge({ icon = '🏅', title = 'Badge', points = null, duration = 3.6 }) {
    const cam = this.renderer.xr.isPresenting ? this.renderer.xr.getCamera() : this.camera;
    cam.updateMatrixWorld();
    const dist = this.renderer.xr.isPresenting ? 0.8 : 3;
    const camPos = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
    const fwd = new THREE.Vector3(0, 0, -1).transformDirection(cam.matrixWorld);
    const group = new THREE.Group();
    group.position.copy(camPos).addScaledVector(fwd, dist);
    group.quaternion.setFromRotationMatrix(new THREE.Matrix4().extractRotation(cam.matrixWorld));
    const s = dist * 0.13;

    const coinGroup = new THREE.Group();
    const gold = new THREE.MeshStandardMaterial({ color: 0xffc83d, metalness: 0.85, roughness: 0.25, emissive: 0x6b4a00, emissiveIntensity: 0.35 });
    const coin = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.16, 64), gold);
    coin.rotation.x = Math.PI / 2;
    const face = canvasTexture(512, 512, (g) => {
      const grd = g.createRadialGradient(256, 200, 40, 256, 256, 256);
      grd.addColorStop(0, '#fff3b0'); grd.addColorStop(1, '#f2a900');
      g.fillStyle = grd; g.beginPath(); g.arc(256, 256, 250, 0, Math.PI * 2); g.fill();
      g.lineWidth = 14; g.strokeStyle = '#a86b00'; g.beginPath(); g.arc(256, 256, 226, 0, Math.PI * 2); g.stroke();
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '190px system-ui, "Noto Color Emoji", sans-serif'; g.fillText(icon, 256, 220);
      g.fillStyle = '#4a2c00'; g.font = 'bold 50px system-ui, sans-serif';
      g.fillText(fitText(g, title, 400), 256, 380);
    });
    const faceMat = new THREE.MeshBasicMaterial({ map: face, transparent: true });
    const front = new THREE.Mesh(new THREE.CircleGeometry(0.97, 64), faceMat);
    front.position.z = 0.081;
    const back = new THREE.Mesh(new THREE.CircleGeometry(0.97, 64), faceMat);
    back.position.z = -0.081; back.rotation.y = Math.PI;
    coinGroup.add(coin, front, back);
    group.add(coinGroup);

    if (points != null) {
      const pts = textSprite(`${points > 0 ? '+' : ''}${points} points`, { color: '#ffe066', size: 72, worldHeight: 0.42 });
      pts.position.y = 1.45;
      group.add(pts);
    }
    // confetti
    const confetti = [];
    const cols = [0xef4444, 0x22c55e, 0x3b82f6, 0xffcc33, 0xd946ef];
    for (let i = 0; i < 36; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.05), new THREE.MeshBasicMaterial({ color: cols[i % cols.length], side: THREE.DoubleSide }));
      const a = Math.random() * Math.PI * 2;
      m.userData.v = new THREE.Vector3(Math.cos(a) * (1 + Math.random() * 2), 1.5 + Math.random() * 2.5, (Math.random() - 0.5) * 1.5);
      m.userData.spin = (Math.random() - 0.5) * 12;
      confetti.push(m);
      group.add(m);
    }
    group.scale.setScalar(0.001);
    this.scene.add(group);
    let t = 0;
    this.tickers.push((dt) => {
      t += dt;
      const appear = Math.min(1, t / 0.45);
      const elastic = appear === 1 ? 1 : 1 - Math.cos(appear * Math.PI * 2.5) * Math.exp(-appear * 5);
      const fade = t > duration - 0.4 ? Math.max(0.001, (duration - t) / 0.4) : 1;
      group.scale.setScalar(s * elastic * fade);
      coinGroup.rotation.y += dt * (t < 1 ? 9 : 3);
      group.position.addScaledVector(new THREE.Vector3(0, 1, 0).applyQuaternion(group.quaternion), dt * dist * 0.03);
      for (const m of confetti) {
        m.userData.v.y -= dt * 4;
        m.position.addScaledVector(m.userData.v, dt);
        m.rotation.x += dt * m.userData.spin;
        m.rotation.z += dt * m.userData.spin * 0.5;
      }
      if (t >= duration) { this.scene.remove(group); disposeTree(group); return false; }
      return true;
    });
  }

  // ---------- frame loop ----------
  loop(time, frame) {
    if (this.paused && !this.session) return;
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = time / 1000;
    if (frame && this.hitSource) {
      const res = frame.getHitTestResults(this.hitSource);
      if (res.length) {
        const pose = res[0].getPose(this.refSpace);
        this.reticle.visible = !!this.placing;
        this.reticle.matrix.fromArray(pose.transform.matrix);
        if (!this.floorKnown && pose.transform.position.y < -0.5) {
          this.floorKnown = true;
          this.floorY = pose.transform.position.y;
          this.buildWorldPins();
        }
      } else {
        this.reticle.visible = false;
      }
    }
    const bobPins = (group, amp) => {
      for (const p of group.children) {
        if (!p.userData.bob) continue;
        p.userData.bob.position.y = Math.sin(t * 2 + p.userData.phase) * amp + amp;
        const focused = p.userData.ticketId && p.userData.ticketId === this.focusId;
        p.userData.ring.scale.setScalar(focused ? 1.3 + Math.sin(t * 6) * 0.3 : 1);
      }
    };
    if (this.world.visible) bobPins(this.world, 0.03);
    if (this.mapRoot.visible) bobPins(this.mapPins, 0.025);
    for (const o of this.leaders.children) if (o.userData.floatBase) o.position.y = o.userData.floatBase + Math.sin(t * 1.5 + o.userData.phase) * 0.04;
    this.tickers = this.tickers.filter((fn) => fn(dt, t));
    this.renderer.render(this.scene, this.camera);
  }
}

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000, r = (x) => (x * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
function fmtDist(m) {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}
