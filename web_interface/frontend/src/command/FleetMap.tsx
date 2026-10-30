// The fleet on a map: every drone, its home, and whatever the selected drone's job draws
// (routes, photo spots, circles...). Clicks and edits are handed to the parent; the map has
// no command logic of its own.
import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { FleetDrone } from '../api/fleet';
import { homeOf, LatLon, toLatLon, toLocal } from './geo';
import { statusOf, Tone } from './status';
import type { Shape } from './apps/registry';

export type ShapeEvent = { kind: 'click' } | { kind: 'edit'; points: Array<[number, number]> };

interface Props {
  drones: Record<string, FleetDrone>;
  names: string[];
  selected: string;
  onSelect: (name: string) => void;
  onMapClick: (p: LatLon) => void;
  clickHint: string | null;            // shown while a click mode is armed
  target: LatLon | null;               // last go-to target
  // geofence: PX4's circle around the selected drone's home, or the property polygon (+ no-fly areas)
  fence: { center: LatLon; radius: number } | { polygon: Array<[number, number]>; exclusions: Array<Array<[number, number]>> } | null;
  orbit: { center: LatLon; radius: number } | null;   // active or planned orbit
  overlays?: Shape[];                                        // drawn by jobs (plugins), in the selected drone's frame
  onShape?: (shape: Shape, ev: ShapeEvent) => void;          // a shape was clicked or edited
  // Somewhere other than the selected drone's home (e.g. drawing a geofence at another site):
  // overlays are in meters from this point, and the map goes there and stops following the drone.
  origin?: LatLon | null;
}

const TONE_COLOR: Record<Tone, string> = { ok: '#3fb950', busy: '#58a6ff', warn: '#d29922', bad: '#f85149', off: '#6e7681' };

const STREETS = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 21, maxNativeZoom: 19, attribution: '© OpenStreetMap',
});
const SATELLITE = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 21, maxNativeZoom: 19, attribution: 'Imagery © Esri',
});

function droneIcon(name: string, heading: number, tone: Tone, selected: boolean) {
  const c = TONE_COLOR[tone];
  return L.divIcon({
    className: 'fm-drone',
    iconSize: [0, 0],
    html: `<div class="fm-drone-wrap${selected ? ' sel' : ''}">
      <div class="fm-drone-arrow" style="transform:rotate(${heading}deg);border-bottom-color:${c}"></div>
      <div class="fm-drone-label" style="border-color:${c}">${name}</div></div>`,
  });
}

const homeIcon = (name: string) => L.divIcon({
  className: 'fm-home', iconSize: [0, 0],
  html: `<div class="fm-home-dot" title="${name} home">H</div>`,
});

const pointIcon = (n: number, kind: 'draft' | 'active', editable: boolean) => L.divIcon({
  className: 'fm-point', iconSize: [22, 22], iconAnchor: [11, 11],
  html: `<div class="fm-point-dot ${kind}${editable ? ' editable' : ''}">${n}</div>`,
});

const photoIcon = (n: number) => L.divIcon({
  className: 'fm-photo-icon', iconSize: [20, 20], iconAnchor: [10, 10],
  html: `<div class="fm-photo">📷${n}</div>`,
});

const FleetMap: React.FC<Props> = ({ drones, names, selected, onSelect, onMapClick, clickHint, target, fence, orbit, overlays, onShape, origin }) => {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);       // redrawn on every telemetry update
  const routeLayer = useRef<L.LayerGroup | null>(null);  // redrawn only when the route/photos change (so drags and hovers survive)
  const [follow, setFollow] = React.useState(true);
  const followRef = useRef(true);
  followRef.current = follow;
  const centered = useRef(false);
  const clickRef = useRef(onMapClick);
  clickRef.current = onMapClick;
  const [satellite, setSatellite] = React.useState(true);

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: true, attributionControl: true }).setView([37.4122, -121.9989], 19);
    SATELLITE.addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) => clickRef.current({ lat: e.latlng.lat, lon: e.latlng.lng }));
    layer.current = L.layerGroup().addTo(m);
    routeLayer.current = L.layerGroup().addTo(m);
    // Dragging the map means "let me look around": stop following the drone.
    m.on('dragstart', () => setFollow(false));
    map.current = m;
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    return () => { ro.disconnect(); m.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (satellite) { m.removeLayer(STREETS); SATELLITE.addTo(m); } else { m.removeLayer(SATELLITE); STREETS.addTo(m); }
  }, [satellite]);

  // Redraw everything on each telemetry update (a handful of markers; cheap).
  useEffect(() => {
    const m = map.current, g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    const bounds: L.LatLngExpression[] = [];
    names.forEach(n => {
      const d = drones[n];
      const home = homeOf(d);
      if (!d || !home || d.gps.lat == null || d.gps.lon == null) return;
      const st = statusOf(d);
      L.marker([home.lat, home.lon], { icon: homeIcon(n), interactive: false }).addTo(g);
      const mk = L.marker([d.gps.lat, d.gps.lon], { icon: droneIcon(n, d.position.heading || 0, st.tone, n === selected), zIndexOffset: n === selected ? 1000 : 0 });
      mk.on('click', () => onSelect(n));
      mk.addTo(g);
      // PX4's own target (position_setpoint_triplet): a dashed line from the drone to where PX4 is taking it.
      const t = d.target;
      if (d.armed && t && t.lat != null && t.lon != null) {
        const sel = n === selected;
        L.polyline([[d.gps.lat, d.gps.lon], [t.lat, t.lon]], { color: TONE_COLOR[st.tone], weight: sel ? 2.5 : 1.5, opacity: sel ? 0.9 : 0.5, dashArray: '4 6', interactive: false }).addTo(g);
        L.marker([t.lat, t.lon], { icon: L.divIcon({ className: 'fm-target-icon', iconSize: [0, 0], html: `<div class="fm-target" style="border-color:${TONE_COLOR[st.tone]}" title="${n}: PX4 target (${t.type.toLowerCase()})"></div>` }), interactive: false }).addTo(g);
      }
      bounds.push([d.gps.lat, d.gps.lon]);
    });
    if (fence && 'radius' in fence) L.circle([fence.center.lat, fence.center.lon], { radius: fence.radius, color: '#f85149', weight: 1.5, dashArray: '8 6', fill: false, interactive: false }).addTo(g);
    if (fence && 'polygon' in fence) {
      L.polygon(fence.polygon, { color: '#f85149', weight: 1.5, dashArray: '8 6', fill: false, interactive: false }).addTo(g);
      fence.exclusions.forEach(x => L.polygon(x, { color: '#d29922', weight: 1.5, fillOpacity: 0.15, interactive: false }).addTo(g));
    }
    if (orbit) {
      L.circle([orbit.center.lat, orbit.center.lon], { radius: orbit.radius, color: '#a371f7', weight: 2.5, fillOpacity: 0.06, interactive: false }).addTo(g);
      L.circleMarker([orbit.center.lat, orbit.center.lon], { radius: 4, color: '#a371f7', weight: 2, interactive: false }).addTo(g);
    }
    if (target) L.circleMarker([target.lat, target.lon], { radius: 7, color: '#f85149', weight: 2, interactive: false }).addTo(g);
    if (!centered.current && bounds.length) {
      m.fitBounds(L.latLngBounds(bounds).pad(1.5), { maxZoom: 19 });
      centered.current = true;
    }
    // Follow the selected drone (until the operator drags the map).
    const sd = drones[selected];
    if (followRef.current && sd?.gps.lat != null && sd.gps.lon != null) {
      const c = m.getCenter();
      if (Math.abs(c.lat - sd.gps.lat) > 1e-7 || Math.abs(c.lng - sd.gps.lon) > 1e-7) m.panTo([sd.gps.lat, sd.gps.lon], { animate: true, duration: 0.25 });
    }
  }, [drones, names, selected, target, fence, orbit, onSelect]);

  // Selecting a drone starts following it again.
  useEffect(() => { setFollow(true); }, [selected]);
  const originKey = origin ? `${origin.lat.toFixed(6)},${origin.lon.toFixed(6)}` : '';
  useEffect(() => {
    if (!origin || !map.current) return;
    setFollow(false); followRef.current = false;
    map.current.setView([origin.lat, origin.lon], 18);
  }, [originKey]);

  // Job shapes (routes, photo spots, circles, markers): their own layer, redrawn only when they
  // change, so drags and hovers survive telemetry updates.
  const selHome = origin || homeOf(drones[selected]);
  const homeKey = selHome ? `${selHome.lat.toFixed(6)},${selHome.lon.toFixed(6)}` : '';
  const routeKey = JSON.stringify([overlays, homeKey]);
  const shapeCb = useRef(onShape); shapeCb.current = onShape;
  useEffect(() => {
    const g = routeLayer.current;
    if (!g) return;
    g.clearLayers();
    if (!selHome) return;
    const at = (sh: { north?: number; east?: number; lat?: number; lon?: number }): [number, number] => {
      if (sh.lat != null && sh.lon != null) return [sh.lat, sh.lon];
      const p = toLatLon(selHome, sh.north || 0, sh.east || 0);
      return [p.lat, p.lon];
    };
    (overlays || []).forEach(sh => {
      const col = sh.color || '#a371f7';
      if (sh.type === 'circle') {
        const c = at(sh);
        L.circle(c, { radius: sh.radius, color: col, weight: 2.5, fillOpacity: 0.06, interactive: false }).addTo(g);
        L.circleMarker(c, { radius: 4, color: col, weight: 2, interactive: !!sh.label }).bindTooltip(sh.label || '', { direction: 'top' }).addTo(g);
      } else if (sh.type === 'line' && sh.points.length > 1) {
        const ll = sh.points.map(([n, e]) => at({ north: n, east: e }));
        L.polyline(sh.closed ? [...ll, ll[0]] : ll, { color: col, weight: 3, dashArray: sh.dashed ? '6 6' : undefined, interactive: false }).addTo(g);
      } else if (sh.type === 'marker') {
        const mk = L.circleMarker(at(sh), { radius: 6, color: col, weight: 2, fillOpacity: 0.6, interactive: !!(sh.label || sh.clickable) });
        if (sh.label) mk.bindTooltip(sh.label, { direction: 'top' });
        if (sh.clickable) mk.on('click', () => shapeCb.current?.(sh, { kind: 'click' }));
        mk.addTo(g);
      } else if (sh.type === 'photo') {
        const mk = L.marker(at(sh), { icon: photoIcon(sh.n), zIndexOffset: 400 });
        mk.bindTooltip(sh.label || `Photo ${sh.n} (click to open)`, { direction: 'top', offset: [0, -10] });
        mk.on('click', () => shapeCb.current?.(sh, { kind: 'click' }));
        mk.addTo(g);
      } else if (sh.type === 'route' && sh.points.length) {
        // A numbered route. Editable ones can be dragged (and right-click removes a point).
        const kind = sh.kind || (sh.editable ? 'draft' : 'active');
        const color = sh.color || (kind === 'draft' ? '#d29922' : '#58a6ff');
        const ll = sh.points.map(([n, e]) => at({ north: n, east: e }));
        const closed = sh.closed !== false;
        const line = ll.length > 1 ? L.polyline(closed ? [...ll, ll[0]] : ll, { color, weight: 3, dashArray: kind === 'draft' ? '6 6' : undefined, interactive: false }).addTo(g) : null;
        const editable = !!sh.editable;
        ll.forEach((p, i) => {
          const mk = L.marker(p, { icon: pointIcon(i + 1, kind, editable), draggable: editable, zIndexOffset: 500 });
          const n = sh.points[i];
          mk.bindTooltip(`Point ${i + 1}: N ${n[0].toFixed(0)} E ${n[1].toFixed(0)} m${editable ? '<br>drag to move · right-click to remove' : ''}`, { direction: 'top', offset: [0, -10] });
          if (editable) {
            mk.on('drag', () => {
              if (!line) return;
              const cur = line.getLatLngs() as L.LatLng[];
              cur[i] = mk.getLatLng();
              if (i === 0 && closed) cur[cur.length - 1] = mk.getLatLng();
              line.setLatLngs(cur);
            });
            mk.on('dragend', () => {
              const q = toLocal(selHome, { lat: mk.getLatLng().lat, lon: mk.getLatLng().lng });
              const next = sh.points.map(x => [x[0], x[1]] as [number, number]);
              next[i] = [Math.round(q.north * 10) / 10, Math.round(q.east * 10) / 10];
              shapeCb.current?.(sh, { kind: 'edit', points: next });
            });
            mk.on('contextmenu', (e: L.LeafletMouseEvent) => {
              L.DomEvent.preventDefault(e.originalEvent);
              shapeCb.current?.(sh, { kind: 'edit', points: sh.points.filter((_, j) => j !== i) });
            });
          }
          mk.addTo(g);
        });
        // Editable: a small "+" halfway along each side; drag it (or click it) to add a corner there.
        if (editable && ll.length > 1) {
          const sides = closed ? ll.length : ll.length - 1;
          for (let i = 0; i < sides; i++) {
            const a = ll[i], b = ll[(i + 1) % ll.length];
            const mid = L.latLng((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
            const plus = L.marker(mid, {
              draggable: true, zIndexOffset: 450,
              icon: L.divIcon({ className: 'fm-plus', html: '+', iconSize: [18, 18], iconAnchor: [9, 9] }),
            });
            plus.bindTooltip('Drag (or click) to add a corner here', { direction: 'top', offset: [0, -8] });
            const insert = (at: L.LatLng) => {
              const q = toLocal(selHome, { lat: at.lat, lon: at.lng });
              const next = sh.points.map(x => [x[0], x[1]] as [number, number]);
              next.splice(i + 1, 0, [Math.round(q.north * 10) / 10, Math.round(q.east * 10) / 10]);
              shapeCb.current?.(sh, { kind: 'edit', points: next });
            };
            plus.on('dragend', () => insert(plus.getLatLng()));
            plus.on('click', () => insert(mid));
            plus.addTo(g);
          }
        }
      }
    });
  }, [routeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`fm-root${clickHint ? ' fm-armed' : ''}`}>
      <div ref={el} className="fm-map" />
      <div className="fm-tools">
        <button onClick={() => setSatellite(s => !s)}>{satellite ? 'Streets' : 'Satellite'}</button>
        <button className={follow ? 'on' : ''} onClick={() => setFollow(f => !f)} disabled={!selected}
                title="Keep the selected drone in the middle of the map. Dragging the map stops it.">
          {follow ? `Following ${selected}` : `Follow ${selected || 'drone'}`}
        </button>
      </div>
      {clickHint && <div className="fm-hint">{clickHint}</div>}
    </div>
  );
};

export default FleetMap;
