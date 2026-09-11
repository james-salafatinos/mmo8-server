// AnimationEditorUI - admin panel for previewing and tuning procedural character animations
// (PoseAnimator action definitions, stored in the `animations` DB table). Renders its own tiny
// Three.js scene with a live CharacterRig + PoseAnimator so "Play" shows exactly what players
// will see in-game - same rig-building/animation code, not a separate preview approximation.
//
// Two preview modes: "scrub" (default) applies the in-progress form's tracks directly to the
// preview rig at whatever timeline position the scrub slider is at - no clock running, just a
// pure function of the current keyframe values, so nudging a slider gives instant feedback at
// an exact frame. "play" hands control to a real PoseAnimator for a few seconds to see the
// actual eased motion (dragging the scrub slider along with it), then hands back to scrub
// automatically when it finishes.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createCharacterRig } from '../game/CharacterRig.js';
import {
    PoseAnimator, setAnimationDefinitions, TRACK_PATHS, TRACK_VALUE_RANGE,
    sampleTrack, computeRestPose, applyPose
} from '../game/PoseAnimator.js';

// Groups arranged to roughly mirror the body: left limbs on the left, head/waist stacked in the
// middle (head above waist, like the body itself), right limbs on the right.
const LAYOUT_COLUMNS = [
    { groups: ['Left arm', 'Left leg'] },
    { groups: ['Head', 'Waist'] },
    { groups: ['Right arm', 'Right leg'] },
];

export class AnimationEditorUI {
    constructor(editorManager, networkManager) {
        this.editorManager = editorManager;
        this.networkManager = networkManager;
        this.animations = [];
        this.selected = null; // the animation object currently loaded into the form
        this.previewRig = null;
        this.previewAnimator = null;
        this.previewMode = 'scrub'; // 'scrub' | 'play'
        this.rafHandle = null;

        this.createUI();
        this.setupPreviewScene();
    }

    createUI() {
        const overlay = document.createElement('div');
        overlay.id = 'animation-editor-overlay';
        overlay.className = 'editor-modal';
        overlay.style.display = 'none';
        overlay.innerHTML = `
            <div class="editor-modal-content anim-editor-content">
                <div class="anim-editor-header">
                    <h3>🎬 Animation Editor</h3>
                    <button id="anim-editor-close" class="editor-btn">✕ Close</button>
                </div>
                <div class="anim-editor-top-row">
                    <div class="anim-editor-list-col">
                        <button id="anim-new-btn" class="editor-btn">+ New Animation</button>
                        <div id="anim-list" class="anim-list"></div>
                    </div>
                    <div class="anim-editor-preview-col">
                        <div id="anim-preview-canvas"></div>
                        <div class="anim-preview-controls">
                            <button id="anim-play-btn" class="editor-btn primary">▶ Play</button>
                            <span id="anim-preview-status" class="anim-preview-status"></span>
                        </div>
                        <div class="anim-scrub-row">
                            <label for="anim-scrub">Scrub</label>
                            <input type="range" id="anim-scrub" min="0" max="1" step="0.005" value="0">
                        </div>
                    </div>
                    <div class="anim-editor-meta-col">
                        <div class="form-row"><label>ID:</label><input id="anim-id" type="text"></div>
                        <div class="form-row"><label>Name:</label><input id="anim-name" type="text"></div>
                        <div class="form-row"><label>Category:</label><input id="anim-category" type="text"></div>
                        <div class="form-row"><label>Duration (s):</label><input id="anim-duration" type="number" step="0.05" min="0.05"></div>
                        <button id="anim-mirror-btn" class="editor-btn-small">Mirror right arm → left arm</button>
                    </div>
                </div>
                <div id="anim-form" class="anim-form" style="display:none;">
                    <div id="anim-tracks" class="anim-tracks-row"></div>
                    <div class="anim-editor-footer">
                        <button id="anim-save-btn" class="editor-btn primary">💾 Save</button>
                        <div id="anim-save-status" class="anim-save-status"></div>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        this.container = overlay;

        overlay.querySelector('#anim-editor-close').addEventListener('click', () => this.close());
        overlay.querySelector('#anim-new-btn').addEventListener('click', () => this.selectAnimation(this.blankAnimation()));
        overlay.querySelector('#anim-play-btn').addEventListener('click', () => this.playPreview());
        overlay.querySelector('#anim-save-btn').addEventListener('click', () => this.save());
        overlay.querySelector('#anim-mirror-btn').addEventListener('click', () => this.mirrorRightToLeft());
        overlay.querySelector('#anim-duration').addEventListener('input', () => this.onFormChanged());

        const scrub = overlay.querySelector('#anim-scrub');
        scrub.addEventListener('input', () => { this.previewMode = 'scrub'; this.updateScrubPreview(); });

        this.renderTrackInputs();
    }

    blankAnimation() {
        return { id: '', name: 'New Animation', category: 'general', duration: 0.5, tracks: [] };
    }

    // Called whenever a keyframe/duration field changes - keeps the scrub preview live so
    // dragging a slider is an immediate "see it move" instead of "edit, then remember to play".
    onFormChanged() {
        if (this.previewMode === 'scrub') this.updateScrubPreview();
    }

    // ---------- Preview scene ----------
    setupPreviewScene() {
        const container = this.container.querySelector('#anim-preview-canvas');
        const width = 340, height = 340;

        this.previewScene = new THREE.Scene();
        this.previewScene.background = new THREE.Color(0x1b1f24);
        this.previewScene.add(new THREE.HemisphereLight(0xcfe8ff, 0x30271c, 0.9));
        const sun = new THREE.DirectionalLight(0xffffff, 1.1);
        sun.position.set(3, 5, 2);
        this.previewScene.add(sun);
        const ground = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 1 }));
        ground.rotation.x = -Math.PI / 2;
        this.previewScene.add(ground);

        this.previewCamera = new THREE.PerspectiveCamera(45, width / height, 0.1, 20);
        this.previewCamera.position.set(1.6, 1.5, 2.0);

        this.previewRenderer = new THREE.WebGLRenderer({ antialias: true });
        this.previewRenderer.setSize(width, height);
        container.appendChild(this.previewRenderer.domElement);

        this.previewControls = new OrbitControls(this.previewCamera, this.previewRenderer.domElement);
        this.previewControls.target.set(0, 0.9, 0);
        this.previewControls.enableDamping = true;

        const rig = createCharacterRig();
        // The rig's own root sits at y=0 with an internal -0.5 (GROUND_OFFSET) visual shift -
        // PlayerManager cancels that by placing the root at the server's y=0.5 convention, and
        // this preview needs the same offset or the character sinks half a unit into the floor.
        rig.root.position.y = 0.5;
        this.previewScene.add(rig.root);
        this.previewRig = rig;
        // A private registry, not the shared one PoseAnimator defaults to - so Play can preview
        // in-progress edits without those drafts leaking into anyone else's actual game.
        this.previewRegistry = {};
        this.previewAnimator = new PoseAnimator(rig, this.previewRegistry);

        this.previewClock = new THREE.Clock();
    }

    startPreviewLoop() {
        if (this.rafHandle) return;
        const tick = () => {
            this.rafHandle = requestAnimationFrame(tick);
            const dt = Math.min(this.previewClock.getDelta(), 0.05);
            if (this.previewMode === 'play') {
                this.previewAnimator.update(dt, false);
                const action = this.previewAnimator.action;
                if (action) {
                    const duration = this.previewRegistry[action.type].duration;
                    const p = Math.min((this.previewAnimator.t - action.start) / duration, 1);
                    this.container.querySelector('#anim-scrub').value = p;
                } else {
                    this.previewMode = 'scrub'; // finished - hand control back to the scrub slider
                    this.updateScrubPreview();
                }
            }
            // In scrub mode the pose is set directly by updateScrubPreview() on input, and the
            // preview rig otherwise stands still, so there's nothing to recompute every frame.
            this.previewControls.update();
            this.previewRenderer.render(this.previewScene, this.previewCamera);
        };
        tick();
    }

    stopPreviewLoop() {
        if (this.rafHandle) cancelAnimationFrame(this.rafHandle);
        this.rafHandle = null;
    }

    playPreview() {
        if (!this.selected) return;
        // Preview the in-progress form edits, not the last-saved definition. Written into this
        // panel's own private registry (see setupPreviewScene), not the shared one every real
        // player's rig reads from, so tweaking values here never affects a live game.
        const draft = this.readFormAsAnimation();
        const previewId = draft.id || '__preview__';
        this.previewRegistry[previewId] = { duration: draft.duration, tracks: draft.tracks };
        this.previewMode = 'play';
        this.previewAnimator.triggerAction(previewId);
    }

    // Applies the in-progress form's tracks to the preview rig at the scrub slider's timeline
    // position - a pure function of the current field values, no running clock involved. The
    // preview rig has no walk cycle of its own (it just stands there), so the "rest pose" to
    // blend from/to is the plain standing-still pose (walkSwing/walkAmp/speed all 0).
    updateScrubPreview() {
        if (!this.selected) return;
        const p = parseFloat(this.container.querySelector('#anim-scrub').value);
        const draft = this.readFormAsAnimation();
        const rest = computeRestPose(0, 0, 0);
        const pose = { ...rest };
        for (const track of draft.tracks) {
            pose[track.path] = sampleTrack(track.keyframes, p, rest[track.path] ?? 0);
        }
        applyPose(this.previewRig, pose);
    }

    // ---------- List ----------
    open() {
        this.container.style.display = 'flex';
        this.startPreviewLoop();
        this.load();
    }

    close() {
        this.container.style.display = 'none';
        this.stopPreviewLoop();
    }

    load() {
        this.networkManager.socket.emit('getAnimations', {}, (result) => {
            if (result?.success) {
                this.animations = result.animations;
                this.renderList();
            }
        });
    }

    renderList() {
        const list = this.container.querySelector('#anim-list');
        list.innerHTML = '';
        for (const anim of this.animations) {
            const div = document.createElement('div');
            div.className = 'anim-list-entry' + (this.selected?.id === anim.id ? ' selected' : '');
            div.innerHTML = `<span>${anim.name}</span><span class="anim-category">${anim.category}</span>`;
            div.addEventListener('click', () => this.selectAnimation(anim));
            list.appendChild(div);
        }
    }

    // ---------- Form ----------
    selectAnimation(anim) {
        this.selected = anim;
        this.container.querySelector('#anim-form').style.display = 'block';
        this.container.querySelector('#anim-id').value = anim.id;
        this.container.querySelector('#anim-id').disabled = !!this.animations.find(a => a.id === anim.id);
        this.container.querySelector('#anim-name').value = anim.name;
        this.container.querySelector('#anim-category').value = anim.category;
        this.container.querySelector('#anim-duration').value = anim.duration;
        this.container.querySelector('#anim-save-status').textContent = '';
        this.container.querySelector('#anim-scrub').value = 0;
        this.previewMode = 'scrub';
        this.renderTrackInputs(anim.tracks || []);
        this.updateScrubPreview();
        this.renderList();
    }

    renderTrackInputs(tracks = []) {
        const container = this.container.querySelector('#anim-tracks');
        container.innerHTML = '';
        for (const { groups } of LAYOUT_COLUMNS) {
            const column = document.createElement('div');
            column.className = 'anim-track-column';
            for (const groupName of groups) {
                const header = document.createElement('div');
                header.className = 'anim-track-group-header';
                header.textContent = groupName;
                column.appendChild(header);

                for (const { path, label, group } of TRACK_PATHS) {
                    if (group !== groupName) continue;
                    const track = tracks.find(t => t.path === path);
                    const block = document.createElement('div');
                    block.className = 'anim-track-block';
                    block.dataset.path = path;
                    block.innerHTML = `
                        <div class="anim-track-label">${label}</div>
                        <div class="anim-track-keyframes"></div>
                        <button class="editor-btn-small anim-add-keyframe">+ Keyframe</button>
                    `;
                    column.appendChild(block);

                    const kfContainer = block.querySelector('.anim-track-keyframes');
                    for (const kf of (track?.keyframes || [])) {
                        kfContainer.appendChild(this.buildKeyframeRow(kf.t, kf.value));
                    }
                    block.querySelector('.anim-add-keyframe').addEventListener('click', () => {
                        kfContainer.appendChild(this.buildKeyframeRow(0.5, 0));
                        this.onFormChanged();
                    });
                }
            }
            container.appendChild(column);
        }
    }

    buildKeyframeRow(t, value) {
        const row = document.createElement('div');
        row.className = 'anim-keyframe-row';
        row.innerHTML = `
            <div class="kf-field">
                <label>t</label>
                <input type="range" class="kf-t-slider" min="0" max="1" step="0.01" value="${t}">
                <input type="number" class="kf-t-num" min="0" max="1" step="0.01" value="${t}">
            </div>
            <div class="kf-field">
                <label>value</label>
                <input type="range" class="kf-value-slider" min="${TRACK_VALUE_RANGE.min}" max="${TRACK_VALUE_RANGE.max}" step="0.01" value="${value}">
                <input type="number" class="kf-value-num" step="0.01" value="${value}">
            </div>
            <div class="kf-row-actions">
                <button class="editor-btn-small kf-duplicate" title="Duplicate this keyframe (e.g. to hold a pose)">⧉</button>
                <button class="editor-btn-small kf-remove" title="Remove">✕</button>
            </div>
        `;

        const tSlider = row.querySelector('.kf-t-slider'), tNum = row.querySelector('.kf-t-num');
        const vSlider = row.querySelector('.kf-value-slider'), vNum = row.querySelector('.kf-value-num');
        const changed = () => this.onFormChanged();
        tSlider.addEventListener('input', () => { tNum.value = tSlider.value; changed(); });
        tNum.addEventListener('input', () => { tSlider.value = tNum.value; changed(); });
        vSlider.addEventListener('input', () => { vNum.value = vSlider.value; changed(); });
        vNum.addEventListener('input', () => { vSlider.value = vNum.value; changed(); });
        row.querySelector('.kf-remove').addEventListener('click', () => { row.remove(); changed(); });
        row.querySelector('.kf-duplicate').addEventListener('click', () => {
            // Same value, nudged forward in time - the common case is "hold this pose a bit
            // longer", which is exactly two keyframes at the same value with different t.
            const dupT = Math.min(parseFloat(tNum.value) + 0.1, 1);
            const dup = this.buildKeyframeRow(dupT.toFixed(2), vNum.value);
            row.after(dup);
            changed();
        });

        return row;
    }

    readFormAsAnimation() {
        const tracks = [];
        this.container.querySelectorAll('.anim-track-block').forEach(block => {
            const path = block.dataset.path;
            const keyframes = [...block.querySelectorAll('.anim-keyframe-row')].map(row => ({
                t: parseFloat(row.querySelector('.kf-t-num').value) || 0,
                value: parseFloat(row.querySelector('.kf-value-num').value) || 0,
            })).sort((a, b) => a.t - b.t);
            if (keyframes.length > 0) tracks.push({ path, keyframes });
        });

        return {
            id: this.container.querySelector('#anim-id').value.trim(),
            name: this.container.querySelector('#anim-name').value.trim() || 'Untitled',
            category: this.container.querySelector('#anim-category').value.trim() || 'general',
            duration: parseFloat(this.container.querySelector('#anim-duration').value) || 0.5,
            tracks,
        };
    }

    // Convenience: copy the right-arm tracks to the left arm as a mirrored starting point for a
    // two-handed pose. The swing (upper.x) and elbow (mid.x) axes carry straight over (damped
    // 0.85x/0.7x, matching how a supporting hand naturally trails the lead hand) - out/in
    // (upper.z) is negated too, not just copied, because the rig's own rest pose already has
    // the left/right arms at opposite-signed z (they angle outward from the chest in mirrored
    // directions), so a same-sign copy would swing both arms the same way in world space
    // instead of mirroring them.
    mirrorRightToLeft() {
        const swing = this.readTrackKeyframes('armR.upper.x');
        const outIn = this.readTrackKeyframes('armR.upper.z');
        const elbow = this.readTrackKeyframes('armR.mid.x');
        this.setTrackKeyframes('armL.upper.x', swing.map(k => ({ t: k.t, value: k.value * 0.85 })));
        this.setTrackKeyframes('armL.upper.z', outIn.map(k => ({ t: k.t, value: -k.value * 0.85 })));
        this.setTrackKeyframes('armL.mid.x', elbow.map(k => ({ t: k.t, value: k.value * 0.7 })));
        this.onFormChanged();
    }

    readTrackKeyframes(path) {
        const block = this.container.querySelector(`.anim-track-block[data-path="${path}"]`);
        return [...block.querySelectorAll('.anim-keyframe-row')].map(row => ({
            t: parseFloat(row.querySelector('.kf-t-num').value) || 0,
            value: parseFloat(row.querySelector('.kf-value-num').value) || 0,
        }));
    }

    setTrackKeyframes(path, keyframes) {
        const block = this.container.querySelector(`.anim-track-block[data-path="${path}"]`);
        const kfContainer = block.querySelector('.anim-track-keyframes');
        kfContainer.innerHTML = '';
        for (const kf of keyframes) kfContainer.appendChild(this.buildKeyframeRow(kf.t, kf.value));
    }

    save() {
        const animation = this.readFormAsAnimation();
        const statusEl = this.container.querySelector('#anim-save-status');
        if (!animation.id) {
            statusEl.textContent = '❌ ID is required';
            return;
        }
        this.networkManager.socket.emit('adminSaveAnimation', {
            adminToken: this.editorManager.adminToken,
            animation
        }, (result) => {
            if (result?.success) {
                statusEl.textContent = '✅ Saved';
                setAnimationDefinitions([animation]); // instant effect for every rig in the live game too
                this.load();
            } else {
                statusEl.textContent = '❌ ' + (result?.error || 'Save failed');
            }
        });
    }
}
