import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { createDroneModel } from './three/DroneModel';
import { DroneStatus } from '../types/drone';

interface DroneViewer3DProps {
  droneStatus: DroneStatus;
  isConnected: boolean;
}

interface SceneState {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  droneModel: THREE.Group;
  groundMarker: THREE.Mesh;
  grid: THREE.GridHelper;
  compassSprites: THREE.Sprite[];
  animationId: number;
  altitudeLine: THREE.Line | null;
  cameraDistance: number;
  cameraHeight: number;
  dronePos: THREE.Vector3;
  droneYaw: number;
  initialized: boolean;
}

const DroneViewer3D: React.FC<DroneViewer3DProps> = ({ droneStatus }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneState | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0a0a0a, 1);
    container.appendChild(renderer.domElement);

    // Scene
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0a0a0a, 0.008);

    // Camera
    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);

    // Lighting
    scene.add(new THREE.AmbientLight(0x606060, 3));
    const dirLight = new THREE.DirectionalLight(0xffffff, 2);
    dirLight.position.set(10, 30, 10);
    scene.add(dirLight);
    const fillLight = new THREE.DirectionalLight(0x4a90a4, 0.5);
    fillLight.position.set(-10, 5, -10);
    scene.add(fillLight);

    // Ground grid - follows the drone for infinite ground illusion
    const grid = new THREE.GridHelper(400, 400, 0x003322, 0x111111);
    scene.add(grid);

    // Compass labels on the ground - relative offsets from drone
    const compassDist = 20;
    const compassOffsets = [
      { text: 'N', dx: compassDist, dz: 0, color: 0xff4444 },
      { text: 'S', dx: -compassDist, dz: 0, color: 0x888888 },
      { text: 'E', dx: 0, dz: compassDist, color: 0x888888 },
      { text: 'W', dx: 0, dz: -compassDist, color: 0x888888 },
    ];
    const compassSprites: THREE.Sprite[] = [];
    compassOffsets.forEach(({ text, dx, dz, color }) => {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
      ctx.font = 'bold 48px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 32, 32);
      const texture = new THREE.CanvasTexture(canvas);
      const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: 0.6 });
      const sprite = new THREE.Sprite(mat);
      sprite.scale.set(2, 2, 1);
      sprite.position.set(dx, 0.5, dz);
      sprite.userData = { dx, dz }; // store offsets for repositioning
      scene.add(sprite);
      compassSprites.push(sprite);
    });

    // Drone model - scaled up 3x for visibility
    const droneModel = createDroneModel();
    droneModel.scale.set(3, 3, 3);
    scene.add(droneModel);

    // Ground shadow marker (circle under drone on the ground)
    const groundGeom = new THREE.RingGeometry(0.4, 0.6, 32);
    const groundMat = new THREE.MeshBasicMaterial({
      color: 0x00ff88, side: THREE.DoubleSide, transparent: true, opacity: 0.3
    });
    const groundMarker = new THREE.Mesh(groundGeom, groundMat);
    groundMarker.rotation.x = -Math.PI / 2;
    groundMarker.position.y = 0.02;
    scene.add(groundMarker);

    // Chase camera defaults
    let cameraDistance = 8;
    let cameraHeight = 4;
    const dronePos = new THREE.Vector3();
    let droneYaw = 0;

    // Smooth camera position
    const camPos = new THREE.Vector3();
    const camTarget = new THREE.Vector3();

    // Render loop with chase camera
    let animationId = 0;
    const animate = () => {
      animationId = requestAnimationFrame(animate);

      // Chase camera: position behind drone based on yaw
      // "Behind" = opposite direction of drone's forward
      const behindX = dronePos.x - Math.cos(-droneYaw) * cameraDistance;
      const behindZ = dronePos.z - Math.sin(-droneYaw) * cameraDistance;
      const targetCamPos = new THREE.Vector3(behindX, dronePos.y + cameraHeight, behindZ);

      // Smooth follow (lerp)
      camPos.lerp(targetCamPos, 0.05);
      camTarget.lerp(dronePos, 0.1);

      camera.position.copy(camPos);
      camera.lookAt(camTarget);

      // Spin rotors
      droneModel.traverse((child) => {
        if (child.name === 'rotor') {
          child.rotation.z += 0.3;
        }
      });

      renderer.render(scene, camera);
    };
    animationId = requestAnimationFrame(animate);

    const state: SceneState = {
      renderer, scene, camera,
      droneModel, groundMarker, grid, compassSprites,
      animationId, altitudeLine: null,
      cameraDistance, cameraHeight,
      dronePos, droneYaw: 0,
      initialized: false,
    };
    sceneRef.current = state;

    // Scroll to zoom
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cameraDistance = Math.max(3, Math.min(30, cameraDistance + e.deltaY * 0.02));
      if (sceneRef.current) sceneRef.current.cameraDistance = cameraDistance;
    };
    container.addEventListener('wheel', onWheel, { passive: false });

    // Responsive resize
    const resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width: w, height: h } = entry.contentRect;
        if (w > 0 && h > 0) {
          renderer.setSize(w, h);
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
        }
      }
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      container.removeEventListener('wheel', onWheel);
      cancelAnimationFrame(sceneRef.current?.animationId || 0);
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      sceneRef.current = null;
    };
  }, []);

  // Update drone position from droneStatus
  useEffect(() => {
    if (!sceneRef.current) return;
    const { droneModel, scene, groundMarker, grid, compassSprites } = sceneRef.current;

    // NED → Three.js
    const threeX = droneStatus.position.x;
    const threeY = -droneStatus.position.z;
    const threeZ = droneStatus.position.y;
    const yaw = droneStatus.position.yaw;

    droneModel.position.set(threeX, threeY, threeZ);
    droneModel.rotation.y = -yaw;

    // Update chase camera target (read by animate loop)
    sceneRef.current.dronePos.set(threeX, threeY, threeZ);
    sceneRef.current.droneYaw = yaw;

    // Snap camera on first update
    if (!sceneRef.current.initialized) {
      const d = sceneRef.current.cameraDistance;
      const h = sceneRef.current.cameraHeight;
      sceneRef.current.camera.position.set(
        threeX - Math.cos(-yaw) * d,
        threeY + h,
        threeZ - Math.sin(-yaw) * d
      );
      sceneRef.current.initialized = true;
    }

    // Snap grid to drone position (rounded to prevent visual sliding)
    const snapX = Math.round(threeX);
    const snapZ = Math.round(threeZ);
    grid.position.set(snapX, 0, snapZ);

    // Move compass labels relative to drone ground position
    compassSprites.forEach(sprite => {
      sprite.position.set(
        snapX + sprite.userData.dx,
        0.5,
        snapZ + sprite.userData.dz
      );
    });

    // Ground marker under drone
    groundMarker.position.set(threeX, 0.02, threeZ);

    // Altitude line
    if (sceneRef.current.altitudeLine) {
      scene.remove(sceneRef.current.altitudeLine);
      sceneRef.current.altitudeLine = null;
    }
    if (threeY > 0.2) {
      const geom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(threeX, 0, threeZ),
        new THREE.Vector3(threeX, threeY, threeZ),
      ]);
      const mat = new THREE.LineDashedMaterial({
        color: 0x4a90a4, dashSize: 0.5, gapSize: 0.25, transparent: true, opacity: 0.4
      });
      const line = new THREE.Line(geom, mat);
      line.computeLineDistances();
      scene.add(line);
      sceneRef.current.altitudeLine = line;
    }
  }, [droneStatus.position.x, droneStatus.position.y, droneStatus.position.z, droneStatus.position.yaw]);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', backgroundColor: '#0a0a0a' }}
    />
  );
};

export default DroneViewer3D;
