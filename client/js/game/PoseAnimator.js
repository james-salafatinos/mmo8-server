// Drives a CharacterRig's joint rotations every frame: an always-on idle/walk layer plus an
// optional data-driven action layer (attack/cast/...) that temporarily overrides any subset of
// joints. Action definitions live in the DB (see server/database/schema.js's `animations` table)
// and are loaded once via setAnimationDefinitions() - see Game.js's init(). FALLBACK_DEFINITIONS
// below is only used until that load completes (or if it fails), so the game never has zero
// attack/cast animation.
//
// A definition is `{ duration, tracks }`, where each track is `{ path, keyframes }` - `path` is
// "<joint>.<axis>" addressing one rotation axis on one rig pivot (see TRACK_PATHS for the full,
// canonical list - also used by AnimationEditorUI so the two never drift apart), and
// `keyframes` is a sparse list of `{t, value}` covering only the interesting middle of the
// motion. sampleTrack() blends in from - and back out to - whatever the live walk/idle pose
// happens to be when the action starts, so authors never need to hand-specify the start/end
// pose themselves.
import { REST_ARM_Z, REST_ELBOW, REST_KNEE } from './CharacterRig.js';

function lerp(a, b, t) { return a + (b - a) * t; }
function smooth(t) { t = Math.min(Math.max(t, 0), 1); return t * t * (3 - 2 * t); }

// Every joint/axis an animation track can drive, grouped for editor display. Adding a new one
// here also means deciding its rest-pose formula in update() below - it's not just a form row.
export const TRACK_PATHS = [
    { path: 'armR.upper.x', label: 'Swing', group: 'Right arm' },
    { path: 'armR.upper.z', label: 'Out / in', group: 'Right arm' },
    { path: 'armR.mid.x', label: 'Elbow', group: 'Right arm' },
    { path: 'armL.upper.x', label: 'Swing', group: 'Left arm' },
    { path: 'armL.upper.z', label: 'Out / in', group: 'Left arm' },
    { path: 'armL.mid.x', label: 'Elbow', group: 'Left arm' },
    { path: 'legR.upper.x', label: 'Swing', group: 'Right leg' },
    { path: 'legR.mid.x', label: 'Knee', group: 'Right leg' },
    { path: 'legL.upper.x', label: 'Swing', group: 'Left leg' },
    { path: 'legL.mid.x', label: 'Knee', group: 'Left leg' },
    { path: 'waist.x', label: 'Bend forward / back', group: 'Waist' },
    { path: 'waist.z', label: 'Twist / tilt', group: 'Waist' },
    { path: 'head.x', label: 'Nod', group: 'Head' },
    { path: 'head.y', label: 'Turn', group: 'Head' },
];

// Rotation range a slider needs to cover - generous enough for an exaggerated pose (past a
// quarter-turn either way) on any of the above without being so wide that common, small values
// are hard to dial in.
export const TRACK_VALUE_RANGE = { min: -3.3, max: 3.3 };

function pivotFor(rig, joint) {
    switch (joint) {
        case 'armR.upper': return rig.armR.upperPivot;
        case 'armR.mid': return rig.armR.midPivot;
        case 'armL.upper': return rig.armL.upperPivot;
        case 'armL.mid': return rig.armL.midPivot;
        case 'legR.upper': return rig.legR.upperPivot;
        case 'legR.mid': return rig.legR.midPivot;
        case 'legL.upper': return rig.legL.upperPivot;
        case 'legL.mid': return rig.legL.midPivot;
        case 'waist': return rig.waistPivot;
        case 'head': return rig.headPivot;
        default: return null;
    }
}

// Writes `pose` (a { path: value } map, as produced by update() below or by an editor preview)
// directly onto the rig's pivots. Exported so AnimationEditorUI's scrub preview can apply a
// draft pose to its own rig without going through a running PoseAnimator instance.
export function applyPose(rig, pose) {
    for (const path in pose) {
        const i = path.lastIndexOf('.');
        const pivot = pivotFor(rig, path.slice(0, i));
        if (pivot) pivot.rotation[path.slice(i + 1)] = pose[path];
    }
}

const FALLBACK_DEFINITIONS = {
    attack: {
        duration: 0.45,
        tracks: [
            { path: 'armR.upper.x', keyframes: [{ t: 0.5, value: -1.7 }] },
            { path: 'armR.upper.z', keyframes: [{ t: 0.5, value: -0.35 }] },
            { path: 'armR.mid.x', keyframes: [{ t: 0.5, value: 0 }] },
        ],
    },
    cast: {
        duration: 1.0,
        tracks: [
            { path: 'armR.upper.x', keyframes: [{ t: 0.25, value: -1.1 }, { t: 0.8, value: -1.1 }] },
            { path: 'armR.upper.z', keyframes: [{ t: 0.25, value: 0.05 }, { t: 0.8, value: 0.05 }] },
            { path: 'armR.mid.x', keyframes: [{ t: 0.25, value: -0.05 }, { t: 0.8, value: -0.05 }] },
            { path: 'armL.upper.x', keyframes: [{ t: 0.25, value: -0.935 }, { t: 0.8, value: -0.935 }] },
            { path: 'armL.upper.z', keyframes: [{ t: 0.25, value: -0.06 }, { t: 0.8, value: -0.06 }] },
            { path: 'armL.mid.x', keyframes: [{ t: 0.25, value: -0.035 }, { t: 0.8, value: -0.035 }] },
        ],
    },
};

const sharedRegistry = { ...FALLBACK_DEFINITIONS };

// Called once at startup (see Game.js) with the server-loaded `animations` rows, and again by
// AnimationEditorUI after a successful save. Anything the server doesn't have a row for keeps
// its built-in fallback. This is the registry every real in-game PoseAnimator reads from -
// AnimationEditorUI's live preview uses its own private registry instead (see the constructor's
// `registry` param) precisely so in-progress edits never leak into other players' games before
// they're saved.
export function setAnimationDefinitions(list) {
    for (const def of list) {
        sharedRegistry[def.id] = { duration: def.duration, tracks: def.tracks };
    }
}

// Interpolates one track's authored keyframes, with an implicit anchor keyframe at t=0 and
// t=1 both equal to `restValue` (the live walk/idle value captured when the action started) -
// see the module doc comment above.
export function sampleTrack(keyframes, p, restValue) {
    const points = [{ t: 0, value: restValue }, ...keyframes, { t: 1, value: restValue }];
    for (let i = 0; i < points.length - 1; i++) {
        const a = points[i], b = points[i + 1];
        if (p <= b.t) {
            const local = b.t > a.t ? (p - a.t) / (b.t - a.t) : 1;
            return lerp(a.value, b.value, smooth(local));
        }
    }
    return points[points.length - 1].value;
}

// The ambient rest pose for every action-capable joint - what the rig would be doing right now
// if no action were active. Actions blend from/to this (captured once, at the moment the
// action starts) rather than each authoring their own start/end pose. Exported so
// AnimationEditorUI's scrub preview (which has no walk cycle of its own - the preview rig just
// stands still) can build an equivalent "standing still" rest pose for the same reason.
export function computeRestPose(walkSwing, walkAmp, speed) {
    return {
        'armR.upper.x': walkSwing * walkAmp * 0.8,
        'armR.upper.z': REST_ARM_Z,
        'armR.mid.x': REST_ELBOW - Math.max(0, walkSwing) * 0.5 * speed,
        'armL.upper.x': -walkSwing * walkAmp * 0.8,
        'armL.upper.z': -REST_ARM_Z,
        'armL.mid.x': REST_ELBOW - Math.max(0, -walkSwing) * 0.5 * speed,
        'legR.upper.x': -walkSwing * walkAmp,
        'legR.mid.x': REST_KNEE + Math.max(0, -walkSwing) * 0.9 * speed,
        'legL.upper.x': walkSwing * walkAmp,
        'legL.mid.x': REST_KNEE + Math.max(0, walkSwing) * 0.9 * speed,
        'waist.x': 0,
        'waist.z': 0,
        'head.x': 0,
        'head.y': 0,
    };
}

export class PoseAnimator {
    // `registry` defaults to the shared, server-backed definitions every real player uses.
    // Pass a private plain object instead (as AnimationEditorUI's preview does) to play
    // in-progress drafts without affecting anyone else's game.
    constructor(rig, registry = sharedRegistry) {
        this.rig = rig;
        this.registry = registry;
        this.t = 0;
        this.speed = 0; // smoothed 0..1, blends idle <-> walk
        this.action = null; // { type, start, restPose }
    }

    triggerAction(type) {
        if (!this.registry[type]) return;
        if (this.action && this.t - this.action.start < this.registry[this.action.type].duration) return;
        this.action = { type, start: this.t, restPose: null };
    }

    update(dt, moving) {
        this.t += dt;
        this.speed += ((moving ? 1 : 0) - this.speed) * Math.min(1, dt * 6);

        const { hips, legTotal } = this.rig;
        const t = this.t, speed = this.speed;

        const idleBob = Math.sin(t * 2.2) * 0.015;
        const idleSway = Math.sin(t * 1.1) * 0.02;
        const walkFreq = 7.5;
        const walkAmp = 0.5 * speed;
        const walkSwing = Math.sin(t * walkFreq);

        hips.position.y = legTotal + idleBob + Math.abs(walkSwing) * 0.03 * speed;
        hips.rotation.z = idleSway * (1 - speed * 0.5);
        this.rig.chestPivot.rotation.z = -idleSway * 0.6 * (1 - speed * 0.5);

        const restPose = computeRestPose(walkSwing, walkAmp, speed);

        let pose = restPose;
        if (this.action) {
            const def = this.registry[this.action.type];
            if (!this.action.restPose) this.action.restPose = restPose;
            const p = (t - this.action.start) / def.duration;
            if (p >= 1) {
                this.action = null;
            } else {
                pose = { ...restPose };
                for (const track of def.tracks) {
                    const start = this.action.restPose[track.path] ?? restPose[track.path];
                    pose[track.path] = sampleTrack(track.keyframes, p, start);
                }
            }
        }

        applyPose(this.rig, pose);
    }
}
