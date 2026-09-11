// GameEvents - minimal pub/sub bus for gameplay triggers, decoupled from the network layer.
// Existing call sites that used to call a PoseAnimator action directly (Game.js's combat/spell
// listeners, InputManager's local cast finish) now emit a named event here instead; what (if
// anything) happens in response lives in EventAnimationManager.js, driven by admin-authored
// bindings (see editor/AnimationManagerUI.js). A future non-animation action, or a purely
// client-local trigger with no network event backing it (e.g. a mining action), fires through
// this same bus - see agent-knowledge/01-client.md.
const listeners = new Map(); // eventName -> Set<fn>

export const GameEvents = {
    on(eventName, fn) {
        if (!listeners.has(eventName)) listeners.set(eventName, new Set());
        listeners.get(eventName).add(fn);
    },
    off(eventName, fn) {
        listeners.get(eventName)?.delete(fn);
    },
    emit(eventName, payload) {
        listeners.get(eventName)?.forEach(fn => fn(payload));
    },
};
