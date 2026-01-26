import * as THREE from 'three';

export function createDroneModel(): THREE.Group {
  const drone = new THREE.Group();

  // Central body - flat dark cylinder
  const bodyGeom = new THREE.CylinderGeometry(0.15, 0.15, 0.06, 16);
  const bodyMat = new THREE.MeshPhongMaterial({ color: 0x333333 });
  const body = new THREE.Mesh(bodyGeom, bodyMat);
  body.rotation.x = Math.PI / 2;
  drone.add(body);

  // 4 arms at 45, 135, 225, 315 degrees
  const armLength = 0.35;
  const armAngles = [Math.PI / 4, 3 * Math.PI / 4, 5 * Math.PI / 4, 7 * Math.PI / 4];
  const armGeom = new THREE.CylinderGeometry(0.02, 0.02, armLength, 8);
  const armMat = new THREE.MeshPhongMaterial({ color: 0x555555 });

  armAngles.forEach(angle => {
    const arm = new THREE.Mesh(armGeom, armMat);
    arm.position.set(
      Math.cos(angle) * armLength / 2,
      0,
      Math.sin(angle) * armLength / 2
    );
    arm.rotation.z = Math.PI / 2;
    arm.rotation.y = angle;
    drone.add(arm);

    // Rotor at arm tip
    const rotorGeom = new THREE.TorusGeometry(0.08, 0.01, 8, 24);
    const rotorMat = new THREE.MeshPhongMaterial({
      color: 0x00ff88, transparent: true, opacity: 0.6
    });
    const rotor = new THREE.Mesh(rotorGeom, rotorMat);
    rotor.position.set(
      Math.cos(angle) * armLength,
      0.03,
      Math.sin(angle) * armLength
    );
    rotor.rotation.x = -Math.PI / 2;
    rotor.name = 'rotor';
    drone.add(rotor);

    // Motor housing at arm tip
    const motorGeom = new THREE.CylinderGeometry(0.025, 0.025, 0.04, 8);
    const motorMat = new THREE.MeshPhongMaterial({ color: 0x222222 });
    const motor = new THREE.Mesh(motorGeom, motorMat);
    motor.position.set(
      Math.cos(angle) * armLength,
      0.01,
      Math.sin(angle) * armLength
    );
    drone.add(motor);
  });

  // Forward indicator - red cone pointing +X
  const indicatorGeom = new THREE.ConeGeometry(0.03, 0.1, 8);
  const indicatorMat = new THREE.MeshPhongMaterial({ color: 0xff4444 });
  const indicator = new THREE.Mesh(indicatorGeom, indicatorMat);
  indicator.position.set(0.2, 0, 0);
  indicator.rotation.z = -Math.PI / 2;
  drone.add(indicator);

  // Landing skids - two thin bars underneath
  const skidGeom = new THREE.CylinderGeometry(0.008, 0.008, 0.3, 6);
  const skidMat = new THREE.MeshPhongMaterial({ color: 0x666666 });
  [-0.08, 0.08].forEach(zOffset => {
    const skid = new THREE.Mesh(skidGeom, skidMat);
    skid.position.set(0, -0.06, zOffset);
    skid.rotation.z = Math.PI / 2;
    drone.add(skid);
  });

  return drone;
}
