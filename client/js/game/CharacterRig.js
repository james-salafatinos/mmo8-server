// Procedural player character rig: a segmented capsule hierarchy (no skinning, no baked
// keyframe clips - see agent-knowledge/01-client.md and client/prototype-character.html for
// the exploration that led here). Geometries and materials are module-level singletons
// shared by every rig instance, since every player has identical proportions/palette - only
// the Object3D hierarchy (and its live rotations) differ per player.
import * as THREE from 'three';

const D = {
    waist: { r: 0.17, len: 0.08 },
    chest: { r: 0.23, len: 0.16 },
    neck: { r: 0.065, len: 0.05 },
    upperArm: { r: 0.075, len: 0.20 },
    forearm: { r: 0.065, len: 0.20 },
    thigh: { r: 0.115, len: 0.28 },
    shin: { r: 0.09, len: 0.26 },
};
function total(dim) { return dim.len + dim.r * 2; }
const waistT = total(D.waist), chestT = total(D.chest), neckT = total(D.neck);
const thighT = total(D.thigh), shinT = total(D.shin);
const footH = 0.08;
const legTotal = thighT + shinT + footH; // ground -> hip

// The old cube player mesh was 1x1x1 centered on the server's y coordinate (always 0.5,
// i.e. resting on the ground). Everything else (label/health-bar offsets, position lerp,
// raycast targets) assumes that convention, so the visual rig is nested inside a wrapper
// offset down by this amount - the wrapper's own position/rotation stays a drop-in
// replacement for the old cube mesh.
export const GROUND_OFFSET = 0.5;

export const REST_ARM_Z = 0.2; // right arm; left arm mirrors to -REST_ARM_Z
export const REST_ELBOW = -0.3;
export const REST_KNEE = 0.12;

const torsoMat = new THREE.MeshStandardMaterial({ color: 0x5c6f7d, roughness: 0.7 });
const limbMat = new THREE.MeshStandardMaterial({ color: 0x4c5c68, roughness: 0.7 });
const headMat = new THREE.MeshStandardMaterial({ color: 0xdcb894, roughness: 0.8 });

const geo = {
    waist: new THREE.CapsuleGeometry(D.waist.r, D.waist.len, 4, 8),
    chest: new THREE.CapsuleGeometry(D.chest.r, D.chest.len, 4, 8),
    neck: new THREE.CapsuleGeometry(D.neck.r, D.neck.len, 4, 8),
    cranium: new THREE.SphereGeometry(0.185, 16, 12),
    jaw: new THREE.SphereGeometry(0.12, 14, 10),
    upperArm: new THREE.CapsuleGeometry(D.upperArm.r, D.upperArm.len, 4, 8),
    forearm: new THREE.CapsuleGeometry(D.forearm.r, D.forearm.len, 4, 8),
    hand: new THREE.SphereGeometry(0.075, 12, 10),
    thigh: new THREE.CapsuleGeometry(D.thigh.r, D.thigh.len, 4, 8),
    shin: new THREE.CapsuleGeometry(D.shin.r, D.shin.len, 4, 8),
    foot: new THREE.BoxGeometry(0.14, footH, 0.28),
};

function mesh(geometry, material) {
    const m = new THREE.Mesh(geometry, material);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
}

// A two-segment limb (shoulder/elbow or hip/knee). restBend tucks the lower segment
// forward (elbows) or into a relaxed stance (knees) rather than hanging ramrod straight.
function buildLimb(parent, upperGeo, lowerGeo, upperDim, lowerDim, mat, originX, originY, restBend) {
    const upperT = total(upperDim), lowerT = total(lowerDim);

    const upperPivot = new THREE.Object3D();
    upperPivot.position.set(originX, originY, 0);
    parent.add(upperPivot);
    const upperMesh = mesh(upperGeo, mat);
    upperMesh.position.y = -upperT / 2 + upperDim.r * 0.3;
    upperPivot.add(upperMesh);

    const midPivot = new THREE.Object3D();
    midPivot.position.y = -upperT + upperDim.r * 0.4;
    midPivot.rotation.x = restBend;
    upperPivot.add(midPivot);
    const lowerMesh = mesh(lowerGeo, mat);
    lowerMesh.position.y = -lowerT / 2 + lowerDim.r * 0.3;
    midPivot.add(lowerMesh);

    const endPoint = new THREE.Object3D();
    endPoint.position.y = -lowerT + lowerDim.r * 0.3;
    midPivot.add(endPoint);

    return { upperPivot, midPivot, endPoint, upperMesh, upperT, lowerT };
}

// Builds one player's rig. Returns the root (drop-in replacement for the old cube mesh,
// same position/rotation convention) plus the pivots PoseAnimator needs to drive per frame.
export function createCharacterRig() {
    const root = new THREE.Group();
    const visual = new THREE.Group();
    visual.position.y = -GROUND_OFFSET;
    root.add(visual);

    const hips = new THREE.Object3D();
    hips.position.y = legTotal;
    visual.add(hips);

    // Independent bend/twist joint at the waist - no ambient motion of its own (unlike
    // chestPivot's idle sway below), purely there for action tracks to drive (a bow, a twist).
    const waistPivot = new THREE.Object3D();
    hips.add(waistPivot);
    const waistMesh = mesh(geo.waist, torsoMat);
    waistMesh.position.y = waistT / 2;
    waistPivot.add(waistMesh);

    const chestPivot = new THREE.Object3D();
    chestPivot.position.y = waistT * 0.72;
    waistPivot.add(chestPivot);
    const chestMesh = mesh(geo.chest, torsoMat);
    chestMesh.position.y = chestT / 2;
    chestPivot.add(chestMesh);

    const neckPivot = new THREE.Object3D();
    neckPivot.position.y = chestT * 0.78;
    chestPivot.add(neckPivot);
    const neckMesh = mesh(geo.neck, headMat);
    neckMesh.position.y = neckT / 2;
    neckPivot.add(neckMesh);

    const headPivot = new THREE.Object3D();
    headPivot.position.y = neckT * 0.75;
    neckPivot.add(headPivot);
    const cranium = mesh(geo.cranium, headMat);
    cranium.position.y = 0.16;
    cranium.scale.set(1, 1.1, 0.95);
    headPivot.add(cranium);
    const jaw = mesh(geo.jaw, headMat);
    jaw.position.set(0, 0.06, 0.06);
    jaw.scale.set(1, 0.75, 0.9);
    headPivot.add(jaw);

    const shoulderX = D.chest.r + D.upperArm.r * 0.25;
    const shoulderY = chestT * 0.82;
    const armL = buildLimb(chestPivot, geo.upperArm, geo.forearm, D.upperArm, D.forearm, limbMat,
        -shoulderX, shoulderY, REST_ELBOW);
    armL.upperPivot.rotation.z = -REST_ARM_Z;
    const armR = buildLimb(chestPivot, geo.upperArm, geo.forearm, D.upperArm, D.forearm, limbMat,
        shoulderX, shoulderY, REST_ELBOW);
    armR.upperPivot.rotation.z = REST_ARM_Z;
    for (const arm of [armL, armR]) {
        const hand = mesh(geo.hand, headMat);
        hand.scale.set(1, 0.85, 0.7);
        arm.endPoint.add(hand);
    }

    const legL = buildLimb(hips, geo.thigh, geo.shin, D.thigh, D.shin, limbMat, -D.waist.r * 1.05, 0, REST_KNEE);
    const legR = buildLimb(hips, geo.thigh, geo.shin, D.thigh, D.shin, limbMat, D.waist.r * 1.05, 0, REST_KNEE);
    for (const leg of [legL, legR]) {
        const foot = mesh(geo.foot, limbMat);
        foot.position.set(0, -footH / 2, 0.07);
        leg.endPoint.add(foot);
    }

    return { root, legTotal, hips, waistPivot, chestPivot, headPivot, armL, armR, legL, legR };
}
