// EventAnimationManager - bridges GameEvents to PoseAnimator: for a fired event, looks up which
// animation (if any) is bound to it for which actor, resolves that actor to a live entity, and
// triggers the animation after any configured delay. Bindings come from the server (`event_bindings`
// DB table, authored via editor/AnimationManagerUI.js) and are loaded once at startup the same way
// PoseAnimator's own registry is (see Game.js's getAnimations call) - setEventBindings() mirrors
// setAnimationDefinitions() for that reason, including being called again on save for instant effect.
//
// An actor is resolved by convention, not per-event special-casing: `actor === 'self'` means the
// local player; any other actor name (e.g. 'attacker', 'caster', 'target') is looked up as
// `payload[actor + 'Id']` - see agent-knowledge/03-communication.md for which payloads carry which
// actor ids. A binding whose actor id isn't present on the payload is silently skipped.
import { GameEvents } from './GameEvents.js';

let bindings = {}; // eventName -> array of { actor, animationId, delayMs }
const subscribedEvents = new Set();
let liveManager = null; // the current EventAnimationManager instance, if one has been constructed

export function setEventBindings(list) {
    bindings = {};
    for (const b of list) {
        if (!bindings[b.eventName]) bindings[b.eventName] = [];
        bindings[b.eventName].push(b);
    }
    liveManager?.subscribeToAllBoundEvents();
}

export class EventAnimationManager {
    constructor(playerManager) {
        this.playerManager = playerManager;
        liveManager = this;
        this.subscribeToAllBoundEvents();
    }

    subscribeToAllBoundEvents() {
        for (const eventName of Object.keys(bindings)) {
            if (subscribedEvents.has(eventName)) continue;
            subscribedEvents.add(eventName);
            GameEvents.on(eventName, (payload) => this.handleEvent(eventName, payload));
        }
    }

    handleEvent(eventName, payload) {
        for (const binding of bindings[eventName] || []) {
            const actorId = binding.actor === 'self'
                ? this.playerManager.localUserId
                : payload?.[binding.actor + 'Id'];
            if (actorId === undefined || actorId === null) continue;

            const fire = () => {
                const entity = this.playerManager.players.get(actorId)
                            || this.playerManager.players.get(Number(actorId))
                            || this.playerManager.players.get(String(actorId));
                if (entity?.animator) entity.animator.triggerAction(binding.animationId);
            };
            if (binding.delayMs > 0) setTimeout(fire, binding.delayMs);
            else fire();
        }
    }
}
