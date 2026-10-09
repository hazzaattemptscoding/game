import * as THREE from 'three';
import { SURF, SURF_NAMES } from './track.js';

const DB_NAME = 'lakeside-report-store';
const STORE_NAME = 'reports';
const SURFACE_NAME = SURF_NAMES;
const DB_LIMIT = 200000;   // a database document may be 256 KiB; stay well under it

// A report as it goes into the artifact database: the same fields, with the long input and telemetry lists cut to their
// last stretch, and the screenshots dropped if the document would still be too big.
export function compactReport(report) {
  const tail = (list, n) => Array.isArray(list) && list.length > n ? list.slice(-n) : list;
  let doc = { ...report, inputTimeline: tail(report.inputTimeline, 300), telemetry: tail(report.telemetry, 300) };
  if (JSON.stringify(doc).length > DB_LIMIT) doc = { ...doc, screenshots: { omitted: true } };
  if (JSON.stringify(doc).length > DB_LIMIT) doc = { ...doc, inputTimeline: tail(doc.inputTimeline, 60), telemetry: tail(doc.telemetry, 60) };
  return doc;
}

export class ReportTool {
  constructor({ canvas, renderer, camera, scene, world, terrain, car, track, input, settings, history, onClose }) {
    Object.assign(this, { canvas, renderer, camera, scene, world, terrain, car, track, input, settings, history, onClose });
    this.layer = document.getElementById('report-layer');
    this.rect = document.getElementById('report-rect');
    this.status = document.getElementById('report-status');
    this.selectionText = document.getElementById('report-selection');
    this.coordinate = document.getElementById('report-coordinate');
    this.category = document.getElementById('report-category');
    this.note = document.getElementById('report-note');
    this.raycaster = new THREE.Raycaster();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.pointer = new THREE.Vector2();
    this.center = { x: car.x, z: car.z };
    this.zoom = 1;
    this.follow = false;
    this.tool = 'pick';
    this.opened = false;
    this.selections = [];
    this.highlights = [];
    this.pointers = new Map();
    this.bind();
    this.refreshCount();
  }

  bind() {
    this.layer.querySelectorAll('[data-report-tool]').forEach(button => button.addEventListener('click', () => {
      this.tool = button.dataset.reportTool;
      this.layer.querySelectorAll('[data-report-tool]').forEach(b => b.classList.toggle('selected', b === button));
    }));
    document.getElementById('report-center').addEventListener('click', () => this.centerOnCar());
    document.getElementById('report-follow').addEventListener('click', event => {
      this.follow = !this.follow;
      event.currentTarget.classList.toggle('selected', this.follow);
    });
    document.getElementById('report-resume').addEventListener('click', () => this.close());
    document.getElementById('report-clear').addEventListener('click', () => { this.selections = []; this.clearHighlights(); this.renderSelections(); });
    document.getElementById('report-save').addEventListener('click', () => this.save());
    this.canvas.addEventListener('pointerdown', event => this.pointerDown(event));
    this.canvas.addEventListener('pointermove', event => this.pointerMove(event));
    this.canvas.addEventListener('pointerup', event => this.pointerUp(event));
    this.canvas.addEventListener('pointercancel', event => this.pointerUp(event));
    this.canvas.addEventListener('wheel', event => {
      if (!this.opened) return;
      event.preventDefault();
      this.zoom = THREE.MathUtils.clamp(this.zoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15), 0.25, 5);
    }, { passive: false });
  }

  open(screenshot, cameraPose) {
    this.screenshot3d = screenshot;
    this.camera3d = cameraPose;
    this.centerOnCar();
    this.zoom = 1;
    this.selections = [];
    this.clearHighlights();
    this.renderSelections();
    this.opened = true;
    this.layer.hidden = false;
    document.body.classList.add('report-mode');
  }

  close() {
    this.opened = false;
    this.follow = false;
    this.layer.hidden = true;
    this.rect.hidden = true;
    document.body.classList.remove('report-mode');
    this.onClose();
  }

  centerOnCar() { this.center = { x: this.car.x, z: this.car.z }; }

  update() {
    if (!this.opened) return;
    if (this.follow) this.centerOnCar();
    const height = 420 / this.zoom;
    this.camera.position.set(this.center.x, this.car.y + height, this.center.z);
    this.camera.up.set(0, 0, -1);
    this.camera.lookAt(this.center.x, this.car.y, this.center.z);
  }

  setPointer(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  groundPoint(event) {
    this.setPointer(event);
    const hit = this.raycaster.intersectObject(this.terrain, false)[0];
    if (hit) return hit.point;
    const point = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.plane, point) ? point : null;
  }

  pointerDown(event) {
    if (!this.opened || event.target.closest('#report-layer')) return;
    this.canvas.setPointerCapture(event.pointerId);
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom: this.zoom };
      this.drag = null;
      return;
    }
    this.drag = { x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, moved: false };
    if (this.tool === 'box') this.showRect(event.clientX, event.clientY, event.clientX, event.clientY);
  }

  pointerMove(event) {
    if (!this.opened) return;
    if (this.pointers.has(event.pointerId)) this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size >= 2 && this.pinch) {
      const [a, b] = [...this.pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      this.zoom = THREE.MathUtils.clamp(this.pinch.zoom * distance / Math.max(1, this.pinch.distance), 0.25, 5);
      return;
    }
    if (this.drag && this.pointers.has(event.pointerId)) {
      const dx = event.clientX - this.drag.lastX, dy = event.clientY - this.drag.lastY;
      if (Math.hypot(event.clientX - this.drag.x, event.clientY - this.drag.y) > 4) this.drag.moved = true;
      if (this.tool === 'box') this.showRect(this.drag.x, this.drag.y, event.clientX, event.clientY);
      else if (this.drag.moved) {
        const metresPerPixel = (2 * (420 / this.zoom) * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) / innerHeight;
        this.center.x -= dx * metresPerPixel;
        this.center.z += dy * metresPerPixel;
      }
      this.drag.lastX = event.clientX; this.drag.lastY = event.clientY;
      return;
    }
    this.updateCoordinate(event);
  }

  pointerUp(event) {
    if (!this.opened || !this.pointers.has(event.pointerId)) return;
    const drag = this.drag;
    this.pointers.delete(event.pointerId);
    this.pinch = null;
    if (this.pointers.size) return;
    this.drag = null;
    if (!drag) return;
    if (this.tool === 'box') {
      this.selectBox(drag.x, drag.y, event.clientX, event.clientY);
      this.rect.hidden = true;
    } else if (!drag.moved) this.pick(event);
  }

  showRect(x1, y1, x2, y2) {
    this.rect.hidden = false;
    this.rect.style.left = Math.min(x1, x2) + 'px';
    this.rect.style.top = Math.min(y1, y2) + 'px';
    this.rect.style.width = Math.abs(x2 - x1) + 'px';
    this.rect.style.height = Math.abs(y2 - y1) + 'px';
  }

  updateCoordinate(event) {
    const point = this.groundPoint(event);
    if (!point) return;
    const loc = this.track.locate(point.x, point.z, this.car.loc.i, {});
    const param = this.track.u[loc.i] + loc.t * (this.track.u[(loc.i + 1) % this.track.N] - this.track.u[loc.i]);
    const corner = this.cornerAt(param);
    this.coordinate.textContent = `s ${loc.s.toFixed(0)} m · d ${loc.d.toFixed(1)} m · point ${Math.round(param) % this.track.layout.points.length}${corner ? ` · ${corner}` : ''}`;
  }

  cornerAt(param) {
    const n = this.track.layout.points.length;
    for (const [start, end, name] of this.track.layout.corners) {
      const p = ((param % n) + n) % n, a = ((start % n) + n) % n, b = ((end % n) + n) % n;
      if (a <= b ? p >= a && p <= b : p >= a || p <= b) return name;
    }
    return '';
  }

  objectCategory(object) {
    for (let item = object; item && item !== this.world; item = item.parent) if (item.userData.debug) return item.userData.debug;
    return 'feature';
  }

  highlight(object) {
    if (object === this.terrain) return;
    const helper = new THREE.BoxHelper(object, 0xffd21f);
    helper.userData.reportHighlight = true;
    this.scene.add(helper);
    this.highlights.push(helper);
  }

  clearHighlights() {
    for (const helper of this.highlights) {
      this.scene.remove(helper);
      helper.geometry.dispose();
      helper.material.dispose();
    }
    this.highlights = [];
  }

  describe(object, point) {
    const category = this.objectCategory(object), bounds = new THREE.Box3().setFromObject(object), size = bounds.getSize(new THREE.Vector3());
    const loc = this.track.locate(point.x, point.z, this.car.loc.i, {});
    return {
      id: object.uuid, type: category, corner: this.cornerAt(this.track.u[loc.i]),
      position: { x: point.x, y: point.y, z: point.z }, dimensions: { x: size.x, y: size.y, z: size.z },
      s: loc.s, d: loc.d, surface: SURFACE_NAME[this.track.surfaceAt(loc.i, loc.d)] || 'unknown',
      parameters: { wheelSurfaces: this.car.wheelSurf.map(value => SURFACE_NAME[value] || 'unknown') },
    };
  }

  pick(event) {
    const point = this.groundPoint(event);
    if (!point) return;
    this.setPointer(event);
    const hits = this.raycaster.intersectObjects(this.world.children, true);
    const feature = hits.find(hit => hit.object !== this.terrain && this.objectCategory(hit.object) !== 'feature');
    if (feature) {
      this.selections.push(this.describe(feature.object, feature.point));
      this.highlight(feature.object);
    }
    else this.selections.push({ type: 'terrain', id: 'terrain', position: { x: point.x, y: point.y, z: point.z }, dimensions: null });
    this.renderSelections();
  }

  selectBox(x1, y1, x2, y2) {
    const left = Math.min(x1, x2), right = Math.max(x1, x2), top = Math.min(y1, y2), bottom = Math.max(y1, y2);
    const bounds = new THREE.Box3(), size = new THREE.Vector3(), center = new THREE.Vector3();
    this.world.traverse(object => {
      if (this.selections.length >= 200) return;
      if (!object.isMesh || object === this.terrain || this.objectCategory(object) === 'feature') return;
      bounds.setFromObject(object); bounds.getCenter(center).project(this.camera);
      const sx = (center.x + 1) * innerWidth / 2, sy = (1 - center.y) * innerHeight / 2;
      if (sx < left || sx > right || sy < top || sy > bottom || center.z < -1 || center.z > 1) return;
      bounds.getSize(size);
      this.selections.push({ id: object.uuid, type: this.objectCategory(object), corner: '', position: { x: bounds.min.x, y: bounds.min.y, z: bounds.min.z }, dimensions: { x: size.x, y: size.y, z: size.z } });
      this.highlight(object);
    });
    this.renderSelections();
  }

  renderSelections() {
    this.selectionText.textContent = this.selections.length ? this.selections.map((item, i) => `${i + 1}. ${item.type} · ${item.id}${item.corner ? ` · ${item.corner}` : ''}`).join('\n') : 'No features selected';
  }

  async save() {
    const saveButton = document.getElementById('report-save');
    saveButton.disabled = true;
    try {
      this.renderer.render(this.scene, this.camera);
      const screenshotMap = this.canvas.toDataURL('image/png');
      const report = {
        id: new Date().toISOString(), build: typeof __BUILD_COMMIT__ === 'undefined' ? 'unknown' : __BUILD_COMMIT__,
        createdAt: new Date().toISOString(), category: this.category.value, note: this.note.value,
        device: this.input.device, quality: { pixelRatio: devicePixelRatio, viewport: { width: innerWidth, height: innerHeight }, settings: this.settings },
        car: { x: this.car.x, y: this.car.y, z: this.car.z, s: this.car.loc.s, d: this.car.loc.d, speed: this.car.speed, fwdSpeed: this.car.fwdSpeed, heading: this.car.heading, steer: this.car.steer, throttle: this.car.throttle, brake: this.car.brake, gear: this.car.gear, surfaces: this.car.wheelSurf.map(value => SURFACE_NAME[value] || 'unknown') },
        inputTimeline: this.history.inputs.slice(), telemetry: this.history.telemetry.slice(),
        camera: { threeDimensional: this.camera3d, map: { position: this.camera.position.toArray(), quaternion: this.camera.quaternion.toArray(), zoom: this.zoom } },
        selections: this.selections, screenshots: { driving: this.screenshot3d, map: screenshotMap },
      };
      const filename = `lakeside-report-${report.createdAt.replace(/[:.]/g, '-')}.json`;
      const json = JSON.stringify(report, null, 2), file = new File([json], filename, { type: 'application/json' });
      const share = navigator.share && navigator.canShare?.({ files: [file] }) ? navigator.share({ files: [file], title: 'Lakeside track report' }) : null;
      const localId = await this.store(report);
      let delivered = false;
      // In the live artifact a report goes into the artifact's own database, where the owner (and Claude) can read it
      // without a file. If that is not possible the viewer's downloads capability offers the file, with a confirmation.
      // Anywhere else a plain download link works.
      let sent = false, handed = false, failure = '';
      try {
        const db = await window.claude?.use?.('db');
        if (db) { await db.collection('reports').doc(report.id).set(compactReport(report)); sent = true; delivered = true; }
      } catch (error) { failure = error?.code || error?.message || 'unknown error'; }
      if (!sent) {
        try {
          const downloads = await window.claude?.use?.('downloads');
          if (downloads) { await downloads.save({ filename, data: new Blob([json], { type: 'application/json' }) }); handed = true; delivered = true; }
        } catch (error) { failure = error?.code === 'declined' ? 'download declined' : failure || error?.code || error?.message || 'unknown error'; }
      }
      if (!sent && !handed && !window.claude) {
        const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
      }
      if (import.meta.env.DEV) {
        const response = await fetch('/__lakeside-report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json });
        delivered = response.ok;
      }
      if (share) {
        try { await share; delivered = true; }
        catch (error) { if (error.name !== 'AbortError') throw error; }
      }
      if (delivered) await this.remove(localId);
      this.status.textContent = sent ? 'Report sent' : handed ? 'Report downloaded' : delivered ? 'Report sent' : `Saved in this browser only${failure ? ` (${failure})` : ''}`;
      await this.refreshCount();
    } catch (error) {
      this.status.textContent = `Could not save report: ${error.message}`;
    } finally { saveButton.disabled = false; }
  }

  async store(report) {
    const db = await this.database();
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).add(report);
      request.onsuccess = () => resolve(report.id);
      request.onerror = () => reject(request.error);
    });
  }

  async remove(id) {
    const db = await this.database();
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  database() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async refreshCount() {
    try {
      const db = await this.database();
      const count = await new Promise((resolve, reject) => {
        const request = db.transaction(STORE_NAME).objectStore(STORE_NAME).count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      document.getElementById('report-pending').textContent = `${count} unsent`;
    } catch { document.getElementById('report-pending').textContent = 'browser storage unavailable'; }
  }
}