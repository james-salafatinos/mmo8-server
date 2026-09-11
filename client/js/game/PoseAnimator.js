// Drives a CharacterRig's joint rotations every frame: an always-on idle/walk layer plus an
// optional action layer (attack/cast) that temporarily overrides the right arm (and the left,
// for two-handed poses). Every pose is computed live from math each frame - no baked keyframe
// clips - so adding a new action means adding an entry to ACTIONS, not authoring an animation
// asset. See client/prototype-character.html for the prototype this was ported from, and
// agent-knowledge/01-client.md for how it's wired into PlayerManager.
import { REST_ARM_Z, REST_ELBOW, REST_KNEE } from './CharacterRig.js';

function lerp(a, b, t) { return a + (b - a) * t; }
function smooth(t) { t = Math.min(Math.max(t, 0), 1); return t * t * (3 - 2 * t); }

const ACTIONS = {
    attack: {
        duration: 0.45, twoHanded: false,
        apply(p, ctx) {
            const swing = Math.sin(Math.min(p, 1) * Math.PI);
            return {
                rx: ctx.armSwingR * (1 - swing) - swing * 1.7,
                rz: REST_ARM_Z * (1 - swing) - swing * 0.35,
                elbow: REST_ELBOW * (1 - swing),
            };
        },
    },
    cast: {
        duration: 1.0, twoHanded: true,
        apply(p, ctx) {
            if (p < 0.25) {
                const k = smooth(p / 0.25);
                return { rx: lerp(ctx.armSwingR, -1.1, k), rz: lerp(REST_ARM_Z, 0.05, k), elbow: lerp(REST_ELBOW, -0.05, k) };
            } else if (p < 0.8) {
                const local = (p - 0.25) / 0.55;
                return { rx: -1.1 + Math.sin(local * Math.PI * 8) * 0.02, rz: 0.05, elbow: -0.05 };
            }
            const k = smooth((p - 0.8) / 0.2);
            return { rx: lerp(-1.1, ctx.armSwingR, k), rz: lerp(0.05, REST_ARM_Z, k), elbow: lerp(-0.05, REST_ELBOW, k) };
        },
    },
    // Add 'mine'/'chop'/etc here (see client/prototype-character.html) once real gameplay
    // events exist to trigger them.
};

export class PoseAnimator {
    constructor(rig) {
        this.rig = rig;
        this.t = 0;
        this.speed = 0; // smoothed 0..1, blends idle <-> walk
        this.action = null; // { type, start }
    }

    triggerAction(type) {
        if (!ACTIONS[type]) return;
        if (this.action && this.t - this.action.start < ACTIONS[this.action.type].duration) return;
        this.action = { type, start: this.t };
    }

    update(dt, moving) {
        this.t += dt;
        this.speed += ((moving ? 1 : 0) - this.speed) * Math.min(1, dt * 6);

        const { hips, chestPivot, armL, armR, legL, legR, legTotal } = this.rig;
        const t = this.t, speed = this.speed;

        const idleBob = Math.sin(t * 2.2) * 0.015;
        const idleSway = Math.sin(t * 1.1) * 0.02;
        const walkFreq = 7.5;
        const walkAmp = 0.5 * speed;
        const walkSwing = Math.sin(t * walkFreq);

        hips.position.y = legTotal + idleBob + Math.abs(walkSwing) * 0.03 * speed;
        hips.rotation.z = idleSway * (1 - speed * 0.5);
        chestPivot.rotation.z = -idleSway * 0.6 * (1 - speed * 0.5);

        legL.upperPivot.rotation.x = walkSwing * walkAmp;
        legR.upperPivot.rotation.x = -walkSwing * walkAmp;
        legL.midPivot.rotation.x = REST_KNEE + Math.max(0, walkSwing) * 0.9 * speed;
        legR.midPivot.rotation.x = REST_KNEE + Math.max(0, -walkSwing) * 0.9 * speed;

        const armSwingL = -walkSwing * walkAmp * 0.8;
        const armSwingR = walkSwing * walkAmp * 0.8;
        armL.upperPivot.rotation.x = armSwingL;
        armL.midPivot.rotation.x = REST_ELBOW - Math.max(0, -walkSwing) * 0.5 * speed;

        if (this.action) {
            const def = ACTIONS[this.action.type];
            const p = (t - this.action.start) / def.duration;
            if (p >= 1) {
                this.action = null;
                armR.upperPivot.rotation.x = armSwingR;
                armR.upperPivot.rotation.z = REST_ARM_Z;
                armR.midPivot.rotation.x = REST_ELBOW - Math.max(0, walkSwing) * 0.5 * speed;
            } else {
                const pose = def.apply(p, { armSwingR, armSwingL, walkSwing });
                armR.upperPivot.rotation.x = pose.rx;
                armR.upperPivot.rotation.z = pose.rz;
                armR.midPivot.rotation.x = pose.elbow;
                if (def.twoHanded) {
                    armL.upperPivot.rotation.x = pose.rx * 0.85;
                    armL.upperPivot.rotation.z = lerp(-REST_ARM_Z, -0.06, smooth(pose.rz / REST_ARM_Z));
                    armL.midPivot.rotation.x = pose.elbow * 0.7;
                }
            }
        } else {
            armR.upperPivot.rotation.x = armSwingR;
            armR.upperPivot.rotation.z = REST_ARM_Z;
            armR.midPivot.rotation.x = REST_ELBOW - Math.max(0, walkSwing) * 0.5 * speed;
        }
    }
}
