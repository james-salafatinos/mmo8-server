// AnimationManagerUI - admin panel for binding an animation to a client-side trigger (see
// client/js/game/GameEvents.js / EventAnimationManager.js). The left-hand list is populated by
// asking the server to scan its own source for emit call sites (EventCatalogScanner.js) rather
// than a hand-maintained registry, so it reflects reality: `GameEvents.emit(...)` call sites are
// bindable triggers, plain `socket.emit`/`io.emit` call sites are shown for reference (the raw
// wire protocol - see agent-knowledge/03-communication.md) but aren't directly bindable, since
// there's no actor-resolution or self-echo handling for an arbitrary network event yet - relay it
// through GameEvents.emit(...) at its handler first (see Game.js's combat/spell listeners for the
// existing examples) to make it one.
//
// A bindable event can have more than one "actor" - e.g. combat:attack fires for both the
// attacker and the defender - so the detail pane shows one binding row per known actor for the
// selected event, not one binding per event. ACTOR_OPTIONS is the only place that actor list is
// hand-maintained; anything not listed there defaults to a single 'self' actor, which is right
// for any future solo action (a mining action, say) that has no second participant.
import { setEventBindings } from '../game/EventAnimationManager.js';

const ACTOR_OPTIONS = {
    'combat:attack': ['attacker', 'defender'],
    'spell:cast': ['caster', 'target'],
};

export class AnimationManagerUI {
    constructor(editorManager, networkManager) {
        this.editorManager = editorManager;
        this.networkManager = networkManager;
        this.events = []; // catalog rows: { eventName, category, bindable, sources }
        this.bindings = {}; // eventName -> { actor -> {animationId, delayMs} }
        this.animations = []; // for the animation-id dropdown
        this.selectedEvent = null;

        this.createUI();
    }

    createUI() {
        const overlay = document.createElement('div');
        overlay.id = 'animation-manager-overlay';
        overlay.className = 'editor-modal';
        overlay.style.display = 'none';
        overlay.innerHTML = `
            <div class="editor-modal-content anim-mgr-content">
                <div class="anim-mgr-header">
                    <h3>🔗 Animation Manager</h3>
                    <button id="anim-mgr-close" class="editor-btn">✕ Close</button>
                </div>
                <div class="anim-mgr-body">
                    <div class="anim-mgr-list" id="anim-mgr-list"></div>
                    <div class="anim-mgr-detail" id="anim-mgr-detail">
                        <div class="anim-mgr-placeholder">Select a trigger on the left.</div>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        this.container = overlay;

        overlay.querySelector('#anim-mgr-close').addEventListener('click', () => this.close());
    }

    open() {
        this.container.style.display = 'flex';
        this.load();
    }

    close() {
        this.container.style.display = 'none';
    }

    load() {
        this.networkManager.socket.emit('getEventCatalog', {}, (result) => {
            if (result?.success) {
                this.events = result.events;
                this.renderList();
            }
        });
        this.networkManager.socket.emit('getEventBindings', {}, (result) => {
            if (!result?.success) return;
            // Also feeds the actual running game's EventAnimationManager, not just this panel's
            // own display - without this a save/delete here would silently do nothing until the
            // next full page reload, same reason AnimationEditorUI.save() calls
            // setAnimationDefinitions() after adminSaveAnimation.
            setEventBindings(result.bindings);
            this.bindings = {};
            for (const b of result.bindings) {
                if (!this.bindings[b.eventName]) this.bindings[b.eventName] = {};
                this.bindings[b.eventName][b.actor] = { animationId: b.animationId, delayMs: b.delayMs ?? 0 };
            }
            this.renderList();
            if (this.selectedEvent) this.renderDetail();
        });
        this.networkManager.socket.emit('getAnimations', {}, (result) => {
            if (result?.success) this.animations = result.animations;
        });
    }

    renderList() {
        const list = this.container.querySelector('#anim-mgr-list');
        list.innerHTML = '';

        const bindable = this.events.filter(e => e.bindable);
        const reference = this.events.filter(e => !e.bindable);

        const addGroup = (label, rows) => {
            if (rows.length === 0) return;
            const header = document.createElement('div');
            header.className = 'anim-mgr-group-label';
            header.textContent = label;
            list.appendChild(header);
            for (const row of rows) list.appendChild(this.buildListRow(row));
        };

        addGroup('Bindable triggers', bindable);
        addGroup('Network reference (not directly bindable)', reference);

        if (this.events.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'anim-mgr-placeholder';
            empty.textContent = 'No emit(...) call sites found.';
            list.appendChild(empty);
        }
    }

    buildListRow(row) {
        const div = document.createElement('div');
        div.className = 'anim-mgr-row' + (this.selectedEvent === row.eventName ? ' selected' : '') + (row.bindable ? '' : ' reference');
        const actorBindings = this.bindings[row.eventName] || {};
        const summary = row.bindable
            ? (Object.keys(actorBindings).length > 0
                ? Object.entries(actorBindings).map(([actor, b]) => `${actor} → ${b.animationId}`).join(', ')
                : 'not bound')
            : `${row.sources.length} call site${row.sources.length === 1 ? '' : 's'}`;
        div.innerHTML = `<span class="anim-mgr-row-name">${row.eventName}</span><span class="anim-mgr-row-summary">${summary}</span>`;
        div.addEventListener('click', () => {
            this.selectedEvent = row.eventName;
            this.renderList();
            this.renderDetail();
        });
        return div;
    }

    renderDetail() {
        const detail = this.container.querySelector('#anim-mgr-detail');
        const row = this.events.find(e => e.eventName === this.selectedEvent);
        if (!row) {
            detail.innerHTML = '<div class="anim-mgr-placeholder">Select a trigger on the left.</div>';
            return;
        }

        if (!row.bindable) {
            detail.innerHTML = `
                <div class="anim-mgr-eyebrow">network reference</div>
                <h2 class="anim-mgr-event-name">${row.eventName}</h2>
                <p class="anim-mgr-info">
                    Not directly bindable yet - relay it through <code>GameEvents.emit(name, payload)</code>
                    at its handler to make it one (see <code>combat:attack</code> / <code>spell:cast</code> for examples).
                </p>
                <div class="anim-mgr-sources">
                    ${row.sources.map(s => `<div class="anim-mgr-source">${s.file}:${s.line}</div>`).join('')}
                </div>
            `;
            return;
        }

        const actors = ACTOR_OPTIONS[row.eventName] || ['self'];
        const actorBindings = this.bindings[row.eventName] || {};

        detail.innerHTML = `
            <div class="anim-mgr-eyebrow">bindable trigger</div>
            <h2 class="anim-mgr-event-name">${row.eventName}</h2>
            <div class="anim-mgr-sources">
                ${row.sources.map(s => `<div class="anim-mgr-source">${s.file}:${s.line}</div>`).join('')}
            </div>
            <div class="anim-mgr-actor-forms">
                ${actors.map(actor => this.buildActorFormHtml(row.eventName, actor, actorBindings[actor])).join('')}
            </div>
        `;

        for (const actor of actors) {
            this.wireActorForm(row.eventName, actor);
        }
    }

    buildActorFormHtml(eventName, actor, current) {
        const options = ['<option value="">— none —</option>']
            .concat(this.animations.map(a =>
                `<option value="${a.id}" ${current?.animationId === a.id ? 'selected' : ''}>${a.name}</option>`
            ));
        return `
            <div class="anim-mgr-actor-form" data-actor="${actor}">
                <div class="anim-mgr-actor-label">${actor}</div>
                <div class="form-row">
                    <label>Animation</label>
                    <select class="anim-mgr-anim-select">${options.join('')}</select>
                </div>
                <div class="form-row anim-mgr-delay-row">
                    <label>Delay (ms)</label>
                    <input type="number" class="anim-mgr-delay-input" min="0" step="50" value="${current?.delayMs ?? 0}">
                </div>
                <button class="editor-btn primary anim-mgr-save-btn">💾 Save</button>
                <span class="anim-mgr-save-status"></span>
            </div>
        `;
    }

    wireActorForm(eventName, actor) {
        const form = this.container.querySelector(`.anim-mgr-actor-form[data-actor="${actor}"]`);
        form.querySelector('.anim-mgr-save-btn').addEventListener('click', () => {
            const animationId = form.querySelector('.anim-mgr-anim-select').value;
            const delayMs = parseInt(form.querySelector('.anim-mgr-delay-input').value, 10) || 0;
            const status = form.querySelector('.anim-mgr-save-status');

            if (!animationId) {
                this.networkManager.socket.emit('adminDeleteEventBinding', {
                    adminToken: this.editorManager.adminToken,
                    eventName, actor
                }, (result) => this.handleSaveResult(result, status));
                return;
            }

            this.networkManager.socket.emit('adminSaveEventBinding', {
                adminToken: this.editorManager.adminToken,
                eventName, actor,
                actionType: 'playAnimation',
                actionConfig: { animationId, delayMs }
            }, (result) => this.handleSaveResult(result, status));
        });
    }

    handleSaveResult(result, statusEl) {
        if (result?.success) {
            statusEl.textContent = '✅ Saved';
            this.load();
        } else {
            statusEl.textContent = '❌ ' + (result?.error || 'Save failed');
        }
    }
}
