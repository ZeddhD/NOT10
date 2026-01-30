/**
 * UI rendering functions for NOT10
 * Handles all screen rendering and DOM updates
 */

import * as utils from './utils.js';

/**
 * Show a specific screen and hide others
 * @param {string} screenId - ID of screen to show
 */
export function showScreen(screenId) {
    console.log('showScreen called with:', screenId);
    const screens = document.querySelectorAll('.screen');
    console.log('Found screens:', screens.length);
    screens.forEach(screen => {
        if (screen.id === screenId) {
            console.log('Showing screen:', screen.id);
            screen.classList.remove('hidden');
        } else {
            console.log('Hiding screen:', screen.id);
            screen.classList.add('hidden');
        }
    });
    console.log('showScreen complete');
}

/**
 * Show loading screen with message
 * @param {string} message - Loading message
 */
export function showLoading(message = 'Loading...') {
    const loadingText = document.querySelector('.loading-text');
    if (loadingText) {
        loadingText.textContent = message;
    }
    showScreen('loading-screen');
}

/**
 * Show error message
 * @param {string} elementId - ID of error element
 * @param {string} message - Error message
 */
export function showError(elementId, message) {
    const errorEl = document.getElementById(elementId);
    if (errorEl) {
        errorEl.textContent = message;
        errorEl.classList.remove('hidden');
    }
}

/**
 * Hide error message
 * @param {string} elementId - ID of error element
 */
export function hideError(elementId) {
    const errorEl = document.getElementById(elementId);
    if (errorEl) {
        errorEl.classList.add('hidden');
    }
}

/**
 * Render seats list for lobby
 * @param {string} containerId - Container element ID
 * @param {Array} players - Array of player objects
 * @param {string} currentPlayerId - Current player's ID
 */
export function renderSeats(containerId, players, currentPlayerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    container.innerHTML = '';
    
    for (let i = 0; i < 4; i++) {
        const player = players.find(p => p.seat_index === i);
        const seatItem = document.createElement('div');
        seatItem.className = 'seat-item';
        
        if (player) {
            seatItem.classList.add('occupied');
            if (player.is_ready) {
                seatItem.classList.add('ready');
            }
            
            const isYou = player.id === currentPlayerId;
            const isBot = player.is_bot || false;
            
            seatItem.innerHTML = `
                <div class="seat-info">
                    <div class="seat-number">${i + 1}</div>
                    <div class="seat-name">${utils.sanitizeHTML(player.name)}${isYou ? ' (You)' : ''}${isBot ? ' 🤖' : ''}</div>
                </div>
                <div class="seat-status ${player.is_ready ? 'ready' : 'joined'}">
                    ${player.is_ready ? 'Ready' : 'Joined'}
                </div>
            `;
        } else {
            seatItem.innerHTML = `
                <div class="seat-info">
                    <div class="seat-number">${i + 1}</div>
                    <div class="seat-name">Empty</div>
                </div>
                <div class="seat-status empty">Empty</div>
            `;
        }
        
        container.appendChild(seatItem);
    }
}

/**
 * Update room code display
 * @param {string} elementId - Element ID
 * @param {string} code - Room code
 */
export function updateRoomCode(elementId, code) {
    const el = document.getElementById(elementId);
    if (el) {
        el.textContent = code;
    }
}

/**
 * Render game table with player panels
 * @param {Array} players - Array of player objects
 * @param {string} currentPlayerId - Current player's ID
 * @param {string} turnPlayerId - ID of player whose turn it is
 */
export function renderGameTable(players, currentPlayerId, turnPlayerId, finalized_json = {}) {
    for (let i = 0; i < 4; i++) {
        const panel = document.getElementById(`player-${i}`);
        if (!panel) continue;
        
        const player = players.find(p => p.seat_index === i);
        
        if (player) {
            const isYou = player.id === currentPlayerId;
            const isTurn = player.id === turnPlayerId && player.status === 'active';
            const isSpectator = player.status === 'spectator';
            const hasFinalized = finalized_json[player.id] === true;
            
            panel.classList.remove('eliminated', 'spectator', 'active-turn', 'finalized');
            if (isTurn) panel.classList.add('active-turn');
            if (isSpectator) panel.classList.add('spectator');
            if (hasFinalized) panel.classList.add('finalized');
            
            const nameEl = panel.querySelector('.player-name');
            const moneyEl = panel.querySelector('.player-money');
            const statusEl = panel.querySelector('.player-status');
            
            if (nameEl) {
                nameEl.textContent = `${utils.sanitizeHTML(player.name)}${isYou ? ' (You)' : ''}`;
            }
            if (moneyEl) {
                moneyEl.textContent = utils.formatMoney(player.money_cents);
            }
            if (statusEl) {
                if (isSpectator) {
                    statusEl.textContent = '👻 Spectating';
                } else if (hasFinalized) {
                    statusEl.textContent = '✓ Finalized';
                } else if (isTurn) {
                    statusEl.textContent = '▶ Your Turn';
                } else {
                    statusEl.textContent = '';
                }
            }
        } else {
            // Empty seat
            const nameEl = panel.querySelector('.player-name');
            const moneyEl = panel.querySelector('.player-money');
            const statusEl = panel.querySelector('.player-status');
            
            if (nameEl) nameEl.textContent = 'Empty';
            if (moneyEl) moneyEl.textContent = '$0';
            if (statusEl) statusEl.textContent = '';
            
            panel.classList.remove('active-turn', 'eliminated', 'spectator');
        }
    }
}

/**
 * Update player bet displays
 * @param {Array} players - Array of player objects
 * @param {Object} bets - Bets object {playerId: betAmount}
 */
export function updatePlayerBets(players, bets) {
    for (let i = 0; i < 4; i++) {
        const panel = document.getElementById(`player-${i}`);
        if (!panel) continue;
        
        const player = players.find(p => p.seat_index === i);
        const betEl = panel.querySelector('.player-bet');
        
        if (betEl && player) {
            const bet = bets[player.id] || 0;
            betEl.textContent = `Bet: ${utils.formatMoney(bet)}`;
        }
    }
}

/**
 * Update table total display
 * @param {number} total - Table total
 */
export function updateTableTotal(total) {
    const totalEl = document.getElementById('table-total');
    if (totalEl) {
        totalEl.textContent = total;
        
        // Add visual feedback for danger zone
        totalEl.classList.remove('warning', 'danger');
        if (total >= 10) {
            totalEl.classList.add('danger');
        } else if (total >= 7) {
            totalEl.classList.add('warning');
        }
    }
}

/**
 * Show played card next to player panel
 * @param {number} seatIndex - Player's seat index (0-3)
 * @param {number} cardValue - Card value played
 */
export function showPlayedCard(seatIndex, cardValue) {
    const playedCardEl = document.getElementById(`played-card-${seatIndex}`);
    if (playedCardEl) {
        playedCardEl.textContent = utils.getCardDisplay(cardValue);
        playedCardEl.classList.add('visible');
        
        // Apply card color styling
        playedCardEl.className = 'played-card-display visible';
        if (cardValue === 0) {
            playedCardEl.classList.add('card-0');
        } else if (cardValue === 1) {
            playedCardEl.classList.add('card-1');
        } else if (cardValue === 2) {
            playedCardEl.classList.add('card-2');
        } else if (cardValue === 3) {
            playedCardEl.classList.add('card-3');
        }
        
        // Auto-hide after 2 seconds
        setTimeout(() => {
            playedCardEl.classList.remove('visible');
        }, 2000);
    }
}

/**
 * Clear all played card displays
 */
export function clearPlayedCards() {
    for (let i = 0; i < 4; i++) {
        const playedCardEl = document.getElementById(`played-card-${i}`);
        if (playedCardEl) {
            playedCardEl.classList.remove('visible');
        }
    }
}

/**
 * Update pot display
 * @param {number} potCents - Pot amount in cents
 */
export function updatePot(potCents) {
    const potEl = document.getElementById('pot-amount');
    if (potEl) {
        potEl.textContent = utils.formatMoney(potCents);
    }
}

/**
 * Update round number display
 * @param {number} roundNo - Round number
 */
export function updateRoundNumber(roundNo) {
    const roundEl = document.getElementById('round-number');
    if (roundEl) {
        roundEl.textContent = `Round ${roundNo}`;
    }
}

/**
 * Update phase indicator
 * @param {string} phase - Current phase
 */
export function updatePhaseIndicator(phase) {
    const phaseEl = document.getElementById('phase-indicator');
    if (phaseEl) {
        const phaseText = {
            'lobby': 'Waiting...',
            'dealing': 'Dealing cards...',
            'betting': 'Betting Phase',
            'playing': 'Playing Cards',
            'round_end': 'Round Ending...'
        };
        phaseEl.textContent = phaseText[phase] || phase;
    }
}

/**
 * Render player hand cards
 * @param {Array<number>} hand - Array of card values
 * @param {boolean} enabled - Are cards clickable
 * @param {Function} onCardClick - Click handler
 */
export function renderHand(hand, enabled, onCardClick) {
    const handContainer = document.getElementById('hand-cards');
    if (!handContainer) return;
    
    handContainer.innerHTML = '';
    
    if (!hand || hand.length === 0) {
        handContainer.innerHTML = '<p style="color: var(--color-text-dim);">No cards</p>';
        return;
    }
    
    hand.forEach((cardValue, index) => {
        const card = document.createElement('div');
        card.className = 'card';
        
        // Add color class based on card value
        if (cardValue === 0) {
            card.classList.add('card-0');
        } else if (cardValue === 1) {
            card.classList.add('card-1');
        } else if (cardValue === 2) {
            card.classList.add('card-2');
        } else if (cardValue === 3) {
            card.classList.add('card-3');
        }
        
        card.textContent = utils.getCardDisplay(cardValue);
        card.dataset.value = cardValue;
        card.dataset.index = index;
        
        if (!enabled) {
            card.classList.add('disabled');
        } else {
            card.addEventListener('click', () => onCardClick(cardValue));
        }
        
        handContainer.appendChild(card);
    });
}

/**
 * Show betting controls
 * @param {boolean} show - Show or hide
 * @param {boolean} hasRaised - Has player raised this phase
 */
export function showBettingControls(show, hasRaised = false) {
    const bettingControls = document.getElementById('betting-controls');
    const playingControls = document.getElementById('playing-controls');
    const spectatorNotice = document.getElementById('spectator-notice');
    
    if (bettingControls) {
        if (show) {
            bettingControls.classList.remove('hidden');
            playingControls?.classList.add('hidden');
            spectatorNotice?.classList.add('hidden');
            
            // Update instruction text
            const instruction = document.getElementById('betting-instruction');
            if (instruction) {
                instruction.textContent = 'Place your bet or call to continue';
            }
        } else {
            bettingControls.classList.add('hidden');
        }
    }
}

/**
 * Show playing controls
 * @param {boolean} show - Show or hide
 */
export function showPlayingControls(show) {
    const playingControls = document.getElementById('playing-controls');
    const bettingControls = document.getElementById('betting-controls');
    const spectatorNotice = document.getElementById('spectator-notice');
    
    if (playingControls) {
        if (show) {
            playingControls.classList.remove('hidden');
            bettingControls?.classList.add('hidden');
            spectatorNotice?.classList.add('hidden');
            
            const instruction = document.getElementById('playing-instruction');
            if (instruction) {
                instruction.textContent = 'Click a card to play it';
            }
        } else {
            playingControls.classList.add('hidden');
        }
    }
}

/**
 * Show spectator notice
 * @param {boolean} show - Show or hide
 */
export function showSpectatorNotice(show) {
    const spectatorNotice = document.getElementById('spectator-notice');
    const bettingControls = document.getElementById('betting-controls');
    const playingControls = document.getElementById('playing-controls');
    
    if (spectatorNotice) {
        if (show) {
            spectatorNotice.classList.remove('hidden');
            bettingControls?.classList.add('hidden');
            playingControls?.classList.add('hidden');
        } else {
            spectatorNotice.classList.add('hidden');
        }
    }
}

/**
 * Enable/disable betting buttons
 * @param {boolean} enabled - Enable or disable
 * @param {number} playerMoney - Player's money
 * @param {number} highestBet - Highest current bet
 * @param {boolean} hasRaised - Has raised once
 */
export function updateBettingButtons(enabled, playerMoney, highestBet, hasRaised) {
    const betButtons = document.querySelectorAll('.btn-bet');
    const callButton = document.getElementById('call-btn');
    const allInBtn = document.getElementById('all-in-btn');
    
    betButtons.forEach(btn => {
        const amount = parseInt(btn.dataset.amount) * 100; // Convert to cents
        btn.disabled = !enabled || playerMoney < amount;
    });
    
    if (callButton) {
        callButton.disabled = !enabled;
    }
    
    if (allInBtn) {
        allInBtn.disabled = !enabled || playerMoney <= 0;
    }
}

/**
 * Add log entry
 * @param {string} message - Log message
 * @param {string} type - Log type ('normal', 'highlight', 'danger')
 */
export function addLogEntry(message, type = 'normal') {
    const logMessages = document.getElementById('log-messages');
    if (!logMessages) return;
    
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    
    if (type === 'highlight') {
        entry.classList.add('highlight');
    } else if (type === 'danger') {
        entry.classList.add('danger');
    }
    
    const time = new Date().toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit' 
    });
    
    entry.textContent = `[${time}] ${message}`;
    
    logMessages.appendChild(entry);
    
    // Auto-scroll to bottom
    logMessages.scrollTop = logMessages.scrollHeight;
    
    // Limit log entries to prevent memory issues
    const entries = logMessages.querySelectorAll('.log-entry');
    if (entries.length > 100) {
        entries[0].remove();
    }
}

/**
 * Clear log
 */
export function clearLog() {
    const logMessages = document.getElementById('log-messages');
    if (logMessages) {
        logMessages.innerHTML = '';
    }
}

/**
 * Show game over screen
 * @param {Object} winner - Winner player object
 * @param {Array} allPlayers - All players for standings
 */
export function showGameOver(winner, allPlayers) {
    showScreen('gameover-screen');
    
    const winnerName = document.getElementById('winner-name');
    const winnerAmount = document.getElementById('winner-amount');
    
    if (winnerName) {
        winnerName.textContent = utils.sanitizeHTML(winner.name);
    }
    
    if (winnerAmount) {
        winnerAmount.textContent = utils.formatMoney(winner.money_cents);
    }
    
    // Render standings
    const standingsList = document.getElementById('standings-list');
    if (standingsList) {
        standingsList.innerHTML = '';
        
        // Sort by money (descending)
        const sorted = [...allPlayers].sort((a, b) => b.money_cents - a.money_cents);
        
        sorted.forEach((player, index) => {
            const item = document.createElement('div');
            item.className = 'standing-item';
            item.innerHTML = `
                <span class="standing-rank">#${index + 1}</span>
                <span class="standing-name">${utils.sanitizeHTML(player.name)}</span>
                <span class="standing-money">${utils.formatMoney(player.money_cents)}</span>
            `;
            standingsList.appendChild(item);
        });
    }
}

/**
 * Show toast notification
 * @param {string} message - Toast message
 * @param {number} duration - Duration in ms
 */
export function showToast(message, duration = 3000) {
    // Create toast element if it doesn't exist
    let toast = document.getElementById('toast-notification');
    
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast-notification';
        toast.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: var(--color-bg-secondary);
            color: var(--color-text-primary);
            padding: 1rem 2rem;
            border-radius: 0.5rem;
            box-shadow: var(--shadow-lg);
            border: 2px solid var(--color-accent);
            z-index: 10000;
            opacity: 0;
            transition: opacity 0.3s ease;
        `;
        document.body.appendChild(toast);
    }
    
    toast.textContent = message;
    toast.style.opacity = '1';
    
    setTimeout(() => {
        toast.style.opacity = '0';
    }, duration);
}

/**
 * Update button visibility and state
 * @param {string} buttonId - Button element ID
 * @param {boolean} visible - Show or hide
 * @param {boolean} enabled - Enable or disable
 */
export function updateButton(buttonId, visible, enabled = true) {
    const button = document.getElementById(buttonId);
    if (!button) return;
    
    if (visible) {
        button.classList.remove('hidden');
    } else {
        button.classList.add('hidden');
    }
    
    button.disabled = !enabled;
}

/**
 * Highlight player panel (for animations)
 * @param {number} seatIndex - Seat index
 * @param {string} className - Class to add temporarily
 * @param {number} duration - Duration in ms
 */
export function highlightPlayerPanel(seatIndex, className = 'active-turn', duration = 2000) {
    const panel = document.getElementById(`player-${seatIndex}`);
    if (!panel) return;
    
    panel.classList.add(className);
    
    setTimeout(() => {
        panel.classList.remove(className);
    }, duration);
}

/**
 * Set up modal
 * @param {string} modalId - Modal element ID
 * @param {string} closeButtonId - Close button ID
 */
export function setupModal(modalId, closeButtonId) {
    const modal = document.getElementById(modalId);
    const closeBtn = document.getElementById(closeButtonId);
    
    if (closeBtn && modal) {
        closeBtn.addEventListener('click', () => {
            modal.classList.add('hidden');
        });
        
        // Click outside to close
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.add('hidden');
            }
        });
    }
}

/**
 * Show help modal
 */
export function showHelpModal() {
    const modal = document.getElementById('help-modal');
    if (modal) {
        modal.classList.remove('hidden');
    }
}

/**
 * Hide all controls
 */
export function hideAllControls() {
    showBettingControls(false);
    showPlayingControls(false);
    showSpectatorNotice(false);
}

/**
 * Render create/lobby screen based on room and player state
 * @param {Object} room - Room object
 * @param {Array} players - Players array
 * @param {string} currentPlayerId - Current player ID
 * @param {boolean} isHost - Is current player the host
 */
export function renderLobbyScreen(room, players, currentPlayerId, isHost) {
    const readyPlayers = players.filter(p => p.is_ready);
    const canStart = readyPlayers.length >= 2 && isHost;
    
    // Update start button visibility
    if (isHost) {
        updateButton('start-game-btn', true, canStart);
        updateButton('host-start-btn', true, canStart);
    } else {
        updateButton('start-game-btn', false);
        updateButton('host-start-btn', false);
    }
}

/**
 * Initialize game screen
 */
export function initGameScreen() {
    updateTableTotal(0);
    updatePot(0);
    updateRoundNumber(1);
    clearLog();
    hideAllControls();
}

/**
 * Copy text to clipboard and show feedback
 * @param {string} text - Text to copy
 */
export async function copyWithFeedback(text) {
    const success = await utils.copyToClipboard(text);
    if (success) {
        showToast('Room code copied!');
    } else {
        showToast('Failed to copy');
    }
}
