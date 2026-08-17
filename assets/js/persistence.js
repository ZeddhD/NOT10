/**
 * Persistence adapter for NOT10
 * The thin network layer that sits between the pure rules engine (game.js)
 * and Supabase. game.js never imports supabaseClient directly - it returns
 * a declarative `effects` array, and this module is the only place that
 * turns those effects into actual network calls.
 *
 * Multiplayer callers should await applyEffects(result.effects) after every
 * game.js call that mutates state. Offline/AI-mode callers can ignore
 * effects entirely (there is nothing to persist).
 */

import * as supabaseClient from './supabaseClient.js';

const HANDLERS = {
    updatePlayer: (e) => supabaseClient.updatePlayer(e.playerId, e.updates),
    updateRoom: (e) => supabaseClient.updateRoom(e.roomCode, e.updates),
    updateRoundState: (e) => supabaseClient.updateRoundState(e.roomCode, e.updates),
    initRoundState: (e) => supabaseClient.initRoundState(e.roomCode, e.roundNo, e.roundState),
    saveHandCards: (e) => supabaseClient.saveHandCards(e.roomCode, e.roundNo, e.playerId, e.cards),
    removeCardFromHand: (e) => supabaseClient.removeCardFromHand(e.roomCode, e.roundNo, e.playerId, e.cardValue),
    logAction: (e) => supabaseClient.logAction(e.roomCode, e.actorPlayerId, e.actionType, e.payload)
};

/**
 * Apply a list of effects produced by game.js against Supabase, in order.
 * @param {Array<Object>} effects - Effects returned from a game.js call
 * @returns {Promise<void>}
 */
export async function applyEffects(effects) {
    if (!effects || effects.length === 0) return;

    for (const effect of effects) {
        const handler = HANDLERS[effect.type];
        if (!handler) {
            console.warn(`No persistence handler for effect type "${effect.type}"`, effect);
            continue;
        }
        await handler(effect);
    }
}
