/**
 * FULL CDP CORE BUNDLE
 * Monolithic script for browser-side injection.
 * Combines utils, auto-accept, overlay, background polls, and lifecycle management.
 */
(function () {
    "use strict";

    // Guard: Bail out immediately if not in a browser context (e.g., service worker)
    if (typeof window === 'undefined') return;

    // ============================================================
    // ANALYTICS MODULE (Embedded)
    // Clean, modular analytics with separated concerns.
    // See: main_scripts/analytics/ for standalone module files
    // ============================================================
    const Analytics = (function () {
        // --- Constants ---
        const TERMINAL_KEYWORDS = ['run', 'execute', 'command', 'terminal'];
        const SECONDS_PER_CLICK = 5;
        const TIME_VARIANCE = 0.2;

        const ActionType = {
            FILE_EDIT: 'file_edit',
            TERMINAL_COMMAND: 'terminal_command'
        };

        // --- State Management ---
        function createDefaultStats() {
            return {
                clicksThisSession: 0,
                blockedThisSession: 0,
                sessionStartTime: null,
                fileEditsThisSession: 0,
                terminalCommandsThisSession: 0,
                actionsWhileAway: 0,
                isWindowFocused: true,
                lastConversationUrl: null,
                lastConversationStats: null
            };
        }

        function getStats() {
            return window.__autoAcceptState?.stats || createDefaultStats();
        }

        function getStatsMutable() {
            return window.__autoAcceptState.stats;
        }

        // --- Click Tracking ---
        function categorizeClick(buttonText) {
            const text = (buttonText || '').toLowerCase();
            for (const keyword of TERMINAL_KEYWORDS) {
                if (text.includes(keyword)) return ActionType.TERMINAL_COMMAND;
            }
            return ActionType.FILE_EDIT;
        }

        function trackClick(buttonText, log) {
            const stats = getStatsMutable();
            stats.clicksThisSession++;
            log(`[Stats] Click tracked. Total: ${stats.clicksThisSession}`);

            const category = categorizeClick(buttonText);
            if (category === ActionType.TERMINAL_COMMAND) {
                stats.terminalCommandsThisSession++;
                log(`[Stats] Terminal command. Total: ${stats.terminalCommandsThisSession}`);
            } else {
                stats.fileEditsThisSession++;
                log(`[Stats] File edit. Total: ${stats.fileEditsThisSession}`);
            }

            let isAway = false;
            if (!stats.isWindowFocused) {
                stats.actionsWhileAway++;
                isAway = true;
                log(`[Stats] Away action. Total away: ${stats.actionsWhileAway}`);
            }

            return { category, isAway, totalClicks: stats.clicksThisSession };
        }

        function trackBlocked(log) {
            const stats = getStatsMutable();
            stats.blockedThisSession++;
            log(`[Stats] Blocked. Total: ${stats.blockedThisSession}`);
        }

        // --- ROI Reporting ---
        function collectROI(log) {
            const stats = getStatsMutable();
            const collected = {
                clicks: stats.clicksThisSession || 0,
                blocked: stats.blockedThisSession || 0,
                sessionStart: stats.sessionStartTime
            };
            log(`[ROI] Collected: ${collected.clicks} clicks, ${collected.blocked} blocked`);
            stats.clicksThisSession = 0;
            stats.blockedThisSession = 0;
            stats.sessionStartTime = Date.now();
            return collected;
        }

        // --- Session Summary ---
        function getSessionSummary() {
            const stats = getStats();
            const clicks = stats.clicksThisSession || 0;
            const baseSecs = clicks * SECONDS_PER_CLICK;
            const minMins = Math.max(1, Math.floor((baseSecs * (1 - TIME_VARIANCE)) / 60));
            const maxMins = Math.ceil((baseSecs * (1 + TIME_VARIANCE)) / 60);

            return {
                clicks,
                fileEdits: stats.fileEditsThisSession || 0,
                terminalCommands: stats.terminalCommandsThisSession || 0,
                blocked: stats.blockedThisSession || 0,
                estimatedTimeSaved: clicks > 0 ? `${minMins}–${maxMins} minutes` : null
            };
        }

        // --- Away Actions ---
        function consumeAwayActions(log) {
            const stats = getStatsMutable();
            const count = stats.actionsWhileAway || 0;
            log(`[Away] Consuming away actions: ${count}`);
            stats.actionsWhileAway = 0;
            return count;
        }

        function isUserAway() {
            return !getStats().isWindowFocused;
        }

        // --- Focus Management ---
        // NOTE: Browser-side focus events are UNRELIABLE in webview contexts.
        // The VS Code extension pushes the authoritative focus state via __autoAcceptSetFocusState.
        // We only keep a minimal initializer here that defaults to focused=true.

        function initializeFocusState(log) {
            const state = window.__autoAcceptState;
            if (state && state.stats) {
                // Default to focused (assume user is present) - extension will correct this
                state.stats.isWindowFocused = true;
                log('[Focus] Initialized (awaiting extension sync)');
            }
        }

        // --- Initialization ---
        function initialize(log) {
            if (!window.__autoAcceptState) {
                window.__autoAcceptState = {
                    isRunning: false,
                    tabNames: [],
                    completionStatus: {},
                    sessionID: 0,
                    currentMode: null,
                    startTimes: {},
                    bannedCommands: [],
                    isPro: false,
                    stats: createDefaultStats()
                };
                log('[Analytics] State initialized');
            } else if (!window.__autoAcceptState.stats) {
                window.__autoAcceptState.stats = createDefaultStats();
                log('[Analytics] Stats added to existing state');
            } else {
                const s = window.__autoAcceptState.stats;
                if (s.actionsWhileAway === undefined) s.actionsWhileAway = 0;
                if (s.isWindowFocused === undefined) s.isWindowFocused = true;
                if (s.fileEditsThisSession === undefined) s.fileEditsThisSession = 0;
                if (s.terminalCommandsThisSession === undefined) s.terminalCommandsThisSession = 0;
            }

            initializeFocusState(log);

            if (!window.__autoAcceptState.stats.sessionStartTime) {
                window.__autoAcceptState.stats.sessionStartTime = Date.now();
            }

            log('[Analytics] Initialized');
        }

        // Set focus state (called from extension via CDP)
        function setFocusState(isFocused, log) {
            const state = window.__autoAcceptState;
            if (!state || !state.stats) return;

            const wasAway = !state.stats.isWindowFocused;
            state.stats.isWindowFocused = isFocused;

            if (log) {
                log(`[Focus] Extension sync: focused=${isFocused}, wasAway=${wasAway}`);
            }
        }

        // Public API
        return {
            initialize,
            trackClick,
            trackBlocked,
            categorizeClick,
            ActionType,
            collectROI,
            getSessionSummary,
            consumeAwayActions,
            isUserAway,
            getStats,
            setFocusState
        };
    })();

    // --- LOGGING ---
    const log = (msg, isSuccess = false) => {
        // Simple log for CDP interception
        console.log(`[AutoAccept] ${msg}`);
    };

    // Initialize Analytics
    Analytics.initialize(log);

    // --- 1. UTILS ---
    let cachedRoots = [document];
    let lastScanTime = 0;
    // Map for isAcceptButton results to avoid redundant layout-forced checks
    const buttonResultCache = new Map();

    // Hyper-efficient recursive root search
    const updateRoots = (force = false) => {
        const now = Date.now();
        // REMOVED THROTTLE: Full speed discovery for Dual Xeon responsiveness
        if (!force && lastScanTime > 0 && now - lastScanTime < 20) return cachedRoots;

        const roots = new Set([document]);
        const queue = [document];
        const processed = new Set();

        while (queue.length > 0) {
            const current = queue.shift();
            if (processed.has(current)) continue;
            processed.add(current);

            const walker = document.createTreeWalker(
                current instanceof Document ? (current.body || current.documentElement) : current,
                NodeFilter.SHOW_ELEMENT,
                {
                    acceptNode: (node) => (node.shadowRoot || node.tagName === 'IFRAME') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
                }
            );

            let node;
            while (node = walker.nextNode()) {
                if (node.shadowRoot) {
                    roots.add(node.shadowRoot);
                    queue.push(node.shadowRoot);
                }
                if (node.tagName === 'IFRAME') {
                    try {
                        const doc = node.contentDocument || node.contentWindow?.document;
                        if (doc && !roots.has(doc)) {
                            roots.add(doc);
                            queue.push(doc);
                        }
                    } catch (e) { }
                }
            }
        }

        const newRoots = Array.from(roots);
        cachedRoots = newRoots;
        lastScanTime = now;

        // Ensure all roots are observed for mutations
        newRoots.forEach(root => {
            if (!root.__observed) {
                const observer = new MutationObserver((mutations) => {
                    buttonResultCache.clear();

                    // Instant Trigger: If we see new nodes, try clicking immediately
                    // But debounce slightly to avoid storming
                    if (!window.__aaTriggerTimer) {
                        window.__aaTriggerTimer = setTimeout(() => {
                            window.__aaTriggerTimer = null;
                            if (window.__autoAcceptState.isRunning) {
                                performClick(['button', '.monaco-button', '[class*="button"]']).catch(() => { });
                            }
                        }, 10);
                    }

                    // If a new shadow host or iframe is added, force a root update
                    let needsRootUpdate = false;
                    for (const m of mutations) {
                        for (const n of m.addedNodes) {
                            if (n.nodeType === 1 && (n.shadowRoot || n.tagName === 'IFRAME' || n.querySelector?.('iframe, [shadowroot]'))) {
                                needsRootUpdate = true;
                                break;
                            }
                        }
                        if (needsRootUpdate) break;
                    }
                    if (needsRootUpdate) updateRoots(true);
                });
                const target = root instanceof Document ? (root.body || root.documentElement) : root;
                if (target) {
                    observer.observe(target, { childList: true, subtree: true });
                    root.__observed = true;
                }
            }
        });

        return cachedRoots;
    };

    // Initial scan
    updateRoots(true);

    const queryAll = (selector) => {
        const results = [];
        updateRoots().forEach(root => {
            if (root.querySelectorAll) {
                try {
                    results.push(...root.querySelectorAll(selector));
                } catch (e) { }
            }
        });
        return results;
    };

    // Helper to strip time suffixes like "3m", "4h", "12s"
    const stripTimeSuffix = (text) => (text || '').trim().replace(/\s*\d+[smh]$/, '').trim();

    // Helper to deduplicate tab names by appending (2), (3), etc.
    const deduplicateNames = (names) => {
        const counts = {};
        return names.map(name => {
            if (counts[name] === undefined) {
                counts[name] = 1;
                return name;
            } else {
                counts[name]++;
                return `${name} (${counts[name]})`;
            }
        });
    };

    const updateTabNames = (tabs) => {
        const rawNames = Array.from(tabs).map(tab => stripTimeSuffix(tab.textContent));
        const tabNames = deduplicateNames(rawNames);

        // Don't clear tabs if temporarily empty (DOM refresh) - keep previous state
        if (tabNames.length === 0 && window.__autoAcceptState.tabNames?.length > 0) {
            return;
        }

        if (JSON.stringify(window.__autoAcceptState.tabNames) !== JSON.stringify(tabNames)) {
            window.__autoAcceptState.tabNames = tabNames;
        }
    };

    // Completion states: undefined (not started) | 'working' | 'done'
    const updateConversationCompletionState = (rawTabName, status) => {
        const tabName = stripTimeSuffix(rawTabName);
        const current = window.__autoAcceptState.completionStatus[tabName];
        if (current !== status) {
            log(`[State] ${tabName}: ${current} → ${status}`);
            window.__autoAcceptState.completionStatus[tabName] = status;
        }
    };

    // --- 2. OVERLAY LOGIC ---
    const OVERLAY_ID = '__autoAcceptBgOverlay';
    const STYLE_ID = '__autoAcceptBgStyles';
    const STYLES = `
        #__autoAcceptBgOverlay { position: fixed; background: rgba(0, 0, 0, 0.98); z-index: 2147483647; font-family: sans-serif; color: #fff; display: flex; flex-direction: column; justify-content: center; align-items: center; pointer-events: none; opacity: 0; transition: opacity 0.3s; }
        #__autoAcceptBgOverlay.visible { opacity: 1; }
        .aab-slot { margin-bottom: 12px; width: 80%; padding: 8px; background: rgba(255,255,255,0.05); border-radius: 4px; }
        .aab-header { display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 4px; }
        .aab-progress-track { height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px; }
        .aab-progress-fill { height: 100%; width: 20%; background: #6b7280; transition: width 0.3s, background 0.3s; }
        .aab-slot.working .aab-progress-fill { background: #a855f7; }
        .aab-slot.done .aab-progress-fill { background: #22c55e; }
        .aab-slot .status-text { color: #6b7280; }
        .aab-slot.working .status-text { color: #a855f7; }
        .aab-slot.done .status-text { color: #22c55e; }
    `;

    // Called ONCE when background mode is enabled
    function showOverlay() {
        if (document.getElementById(OVERLAY_ID)) {
            log('[Overlay] Already exists, skipping creation');
            return;
        }

        log('[Overlay] Creating overlay...');
        const state = window.__autoAcceptState;

        // Inject styles
        if (!document.getElementById(STYLE_ID)) {
            const style = document.createElement('style');
            style.id = STYLE_ID;
            style.textContent = STYLES;
            document.head.appendChild(style);
            log('[Overlay] Styles injected');
        }

        // Create overlay
        const overlay = document.createElement('div');
        overlay.id = OVERLAY_ID;

        // Create container
        const container = document.createElement('div');
        container.id = 'aab-c';
        container.style.cssText = 'width:100%; display:flex; flex-direction:column; align-items:center;';
        overlay.appendChild(container);

        document.body.appendChild(overlay);
        log('[Overlay] Overlay appended to body');

        // Find panel and sync position
        const ide = state.currentMode || 'cursor';
        let panel = null;
        if (ide === 'antigravity') {
            panel = queryAll('#antigravity\\.agentPanel').find(p => p.offsetWidth > 50);
        } else {
            panel = queryAll('#workbench\\.parts\\.auxiliarybar').find(p => p.offsetWidth > 50);
        }

        if (panel) {
            log(`[Overlay] Found panel for ${ide}, syncing position`);
            const sync = () => {
                const r = panel.getBoundingClientRect();
                // Only sync if panel has valid dimensions (not collapsed/hidden)
                if (r.width > 50 && r.height > 50) {
                    Object.assign(overlay.style, { top: r.top + 'px', left: r.left + 'px', width: r.width + 'px', height: r.height + 'px' });
                } else {
                    // Panel collapsed - use fallback fullscreen
                    log('[Overlay] Panel collapsed, using fullscreen fallback');
                    Object.assign(overlay.style, { top: '0', left: '0', width: '100%', height: '100%' });
                }
            };
            sync();
            new ResizeObserver(sync).observe(panel);
        } else {
            log('[Overlay] No panel found, using fullscreen');
            Object.assign(overlay.style, { top: '0', left: '0', width: '100%', height: '100%' });
        }

        // Add initial waiting message
        const waitingDiv = document.createElement('div');
        waitingDiv.className = 'aab-waiting';
        waitingDiv.style.cssText = 'color:#888; font-size:12px;';
        waitingDiv.textContent = 'Scanning for conversations...';
        container.appendChild(waitingDiv);

        requestAnimationFrame(() => overlay.classList.add('visible'));
    }

    // Called on each loop iteration to update content (never creates/destroys)
    function updateOverlay() {
        const state = window.__autoAcceptState;
        const container = document.getElementById('aab-c');

        if (!container) {
            return;
        }

        const newNames = state.tabNames || [];

        // Handle waiting state
        if (newNames.length === 0) {
            if (!container.querySelector('.aab-waiting')) {
                container.textContent = '';
                const waitingDiv = document.createElement('div');
                waitingDiv.className = 'aab-waiting';
                waitingDiv.style.cssText = 'color:#888; font-size:12px;';
                waitingDiv.textContent = 'Scanning for conversations...';
                container.appendChild(waitingDiv);
            }
            return;
        }

        // Remove waiting if tabs exist
        const waiting = container.querySelector('.aab-waiting');
        if (waiting) waiting.remove();

        const currentSlots = Array.from(container.querySelectorAll('.aab-slot'));

        // Remove old slots
        currentSlots.forEach(slot => {
            const name = slot.getAttribute('data-name');
            if (!newNames.includes(name)) slot.remove();
        });

        // Add/Update slots
        newNames.forEach(name => {
            const status = state.completionStatus[name]; // undefined, 'working', or 'done'
            const isDone = status === 'done';

            // Simplified State Logic:
            // 1. Completed (Green)
            // 2. In Progress (Purple) - Default for everything else
            const statusClass = isDone ? 'done' : 'working';
            const statusText = isDone ? 'COMPLETED' : 'IN PROGRESS';
            const progressWidth = isDone ? '100%' : '66%';

            let slot = container.querySelector(`.aab-slot[data-name="${name}"]`);

            if (!slot) {
                slot = document.createElement('div');
                slot.className = `aab-slot ${statusClass}`;
                slot.setAttribute('data-name', name);

                const header = document.createElement('div');
                header.className = 'aab-header';

                const nameSpan = document.createElement('span');
                nameSpan.textContent = name;
                header.appendChild(nameSpan);

                const statusSpan = document.createElement('span');
                statusSpan.className = 'status-text';
                statusSpan.textContent = statusText;
                header.appendChild(statusSpan);

                slot.appendChild(header);

                const track = document.createElement('div');
                track.className = 'aab-progress-track';

                const fill = document.createElement('div');
                fill.className = 'aab-progress-fill';
                fill.style.width = progressWidth;
                track.appendChild(fill);

                slot.appendChild(track);
                container.appendChild(slot);
            } else {
                // Update existing
                slot.className = `aab-slot ${statusClass}`;

                const statusSpan = slot.querySelector('.status-text');
                if (statusSpan) statusSpan.textContent = statusText;

                const bar = slot.querySelector('.aab-progress-fill');
                if (bar) bar.style.width = progressWidth;
            }
        });
    }

    // Called ONCE when background mode is disabled
    function hideOverlay() {
        const overlay = document.getElementById(OVERLAY_ID);
        if (overlay) {
            log('[Overlay] Hiding overlay...');
            overlay.classList.remove('visible');
            setTimeout(() => overlay.remove(), 300);
        }
    }

    // --- 3. BANNED COMMAND DETECTION ---
    /**
     * Traverses the parent containers and their siblings to find the command text being executed.
     * Based on Antigravity DOM structure: the command is in a PRE/CODE block that's a sibling
     * of the button's parent/grandparent container.
     *
     * DOM Structure (Antigravity):
     *   <div> (grandparent: flex w-full...)
     *     <p>Run command?</p>
     *     <div> (parent: ml-auto flex...)
     *       <button>Reject</button>
     *       <button>Accept</button>  <-- we start here
     *     </div>
     *   </div>
     *
     * The command text is in a PRE block that's a previous sibling of the grandparent.
     */
    function findNearbyCommandText(el) {
        const commandSelectors = ['pre', 'code', 'pre code'];
        let commandText = '';

        // Strategy 1: Walk up to find parent containers, then search their previous siblings
        // This matches the actual Antigravity DOM where PRE blocks are siblings of the button's ancestor
        let container = el.parentElement;
        let depth = 0;
        const maxDepth = 10; // Walk up to 10 levels

        while (container && depth < maxDepth) {
            // Search previous siblings of this container for PRE/CODE blocks
            let sibling = container.previousElementSibling;
            let siblingCount = 0;

            while (sibling && siblingCount < 5) {
                // Check if sibling itself is a PRE/CODE
                if (sibling.tagName === 'PRE' || sibling.tagName === 'CODE') {
                    const text = sibling.textContent.trim();
                    if (text.length > 0) {
                        commandText += ' ' + text;
                        log(`[BannedCmd] Found <${sibling.tagName}> sibling at depth ${depth}: "${text.substring(0, 100)}..."`);
                    }
                }

                // Check children of sibling for PRE/CODE
                for (const selector of commandSelectors) {
                    const codeElements = sibling.querySelectorAll(selector);
                    for (const codeEl of codeElements) {
                        if (codeEl && codeEl.textContent) {
                            const text = codeEl.textContent.trim();
                            if (text.length > 0 && text.length < 5000) {
                                commandText += ' ' + text;
                                log(`[BannedCmd] Found <${selector}> in sibling at depth ${depth}: "${text.substring(0, 100)}..."`);
                            }
                        }
                    }
                }

                sibling = sibling.previousElementSibling;
                siblingCount++;
            }

            // If we found command text, we're done
            if (commandText.length > 10) {
                break;
            }

            container = container.parentElement;
            depth++;
        }

        // Strategy 2: Fallback - check immediate button siblings
        if (commandText.length === 0) {
            let btnSibling = el.previousElementSibling;
            let count = 0;
            while (btnSibling && count < 3) {
                for (const selector of commandSelectors) {
                    const codeElements = btnSibling.querySelectorAll ? btnSibling.querySelectorAll(selector) : [];
                    for (const codeEl of codeElements) {
                        if (codeEl && codeEl.textContent) {
                            commandText += ' ' + codeEl.textContent.trim();
                        }
                    }
                }
                btnSibling = btnSibling.previousElementSibling;
                count++;
            }
        }

        // Strategy 3: Check aria-label and title attributes
        if (el.getAttribute('aria-label')) commandText += ' ' + el.getAttribute('aria-label');
        if (el.getAttribute('title')) commandText += ' ' + el.getAttribute('title');

        // Strategy 4: Search ancestor text nodes (robust for Antigravity)
        if (commandText.length < 10) {
            let p = el.parentElement;
            for (let i = 0; i < 6 && p; i++) {
                // If we find a container that looks like a dialog (role="dialog" or specific classes)
                // we scan its entire content.
                if (p.getAttribute('role') === 'dialog' || p.classList.contains('monaco-dialog-box')) {
                    commandText += ' ' + p.textContent;
                    break;
                }
                commandText += ' ' + p.textContent;
                p = p.parentElement;
            }
        }

        // Strategy 5: Check inputs/textareas in the same container
        if (commandText.length < 10) {
            let container = el.closest('.monaco-dialog-box') || el.closest('[role="dialog"]') || el.parentElement?.parentElement;
            if (container) {
                const inputs = container.querySelectorAll('input, textarea');
                inputs.forEach(input => { commandText += ' ' + (input.value || ''); });
            }
        }

        const result = commandText.trim().toLowerCase();
        if (result.length > 0) {
            log(`[BannedCmd] Extracted command text (${result.length} chars): "${result.substring(0, 150)}..."`);
        }
        return result;
    }

    /**
     * Check if a command is banned based on user-defined patterns.
     * Supports both literal substring matching and regex patterns.
     *
     * Pattern format (line by line in settings):
     *   - Plain text: matches as literal substring (case-insensitive)
     *   - /pattern/: treated as regex (e.g., /rm\s+-rf/ matches "rm -rf")
     *
     * @param {string} commandText - The extracted command text to check
     * @returns {boolean} True if command matches any banned pattern
     */
    function isCommandBanned(commandText) {
        const state = window.__autoAcceptState;
        const bannedList = state.bannedCommands || [];

        if (bannedList.length === 0) return false;
        if (!commandText || commandText.length === 0) return false;

        const lowerText = commandText.toLowerCase();

        for (const banned of bannedList) {
            const pattern = banned.trim();
            if (!pattern || pattern.length === 0) continue;

            try {
                // Check if pattern is a regex (starts and ends with /)
                if (pattern.startsWith('/') && pattern.lastIndexOf('/') > 0) {
                    // Extract regex pattern and flags
                    const lastSlash = pattern.lastIndexOf('/');
                    const regexPattern = pattern.substring(1, lastSlash);
                    const flags = pattern.substring(lastSlash + 1) || 'i'; // Default case-insensitive

                    const regex = new RegExp(regexPattern, flags);
                    if (regex.test(commandText)) {
                        log(`[BANNED] Command blocked by regex: /${regexPattern}/${flags}`);
                        Analytics.trackBlocked(log);
                        return true;
                    }
                } else {
                    // Plain text - literal substring match (case-insensitive)
                    const lowerPattern = pattern.toLowerCase();
                    if (lowerText.includes(lowerPattern)) {
                        log(`[BANNED] Command blocked by pattern: "${pattern}"`);
                        Analytics.trackBlocked(log);
                        return true;
                    }
                }
            } catch (e) {
                // If regex is invalid, fall back to literal match
                log(`[BANNED] Invalid regex pattern "${pattern}", using literal match: ${e.message}`);
                if (lowerText.includes(pattern.toLowerCase())) {
                    log(`[BANNED] Command blocked by pattern (fallback): "${pattern}"`);
                    Analytics.trackBlocked(log);
                    return true;
                }
            }
        }
        return false;
    }

    // --- 4. CLICKING LOGIC ---
    function isAcceptButton(el) {
        // Fast exit: check cache
        if (buttonResultCache.has(el)) return buttonResultCache.get(el);

        const rawText = (el.textContent || "").trim();
        const text = rawText.toLowerCase();

        const check = () => {
            if (text.length === 0 || text.length > 60) return false;

            // 1. EXCLUSIONS (Strictly avoid dropdowns and floating menus)
            if (el.getAttribute('aria-haspopup') === 'true' ||
                el.getAttribute('aria-expanded') !== null ||
                el.closest('.monaco-menu-container') ||
                el.closest('.context-view')) {
                return false;
            }

            const className = (el.className || "").toLowerCase();
            const blacklistClasses = ['dropdown', 'toggle', 'chevron', 'arrow', 'settings', 'gear'];
            if (blacklistClasses.some(c => className.includes(c))) return false;

            // EXCLUSION: Don't click buttons matching specific parent styles (to avoid toolbar items)
            if (el.closest('.monaco-toolbar')) return false;

            // 2. PATTERNS
            const patterns = [
                'accept', 'run', 'retry', 'apply', 'execute', 'confirm',
                'allow', 'always run', 'approve', 'proceed', 'ok', 'yes'
            ];

            const rejectPatterns = ['deny', 'skip', 'reject', 'cancel', 'close', 'refine', 'configure', 'ask every time'];

            const hasAcceptWord = patterns.some(p => text.includes(p));
            const hasRejectWord = rejectPatterns.some(r => text.includes(r));

            if (hasRejectWord) return false;

            // SUPER-OVERRIDE: If it's a pure "Run" command button, click it immediately
            // Antigravity often uses "Run" or "Run Command"
            if (text === 'run' || text === 'run command' || text === 'allow' || text === 'yes') {
                return true;
            }

            // Special Case: "Run Alt+..." or "Run ⏎" is always a primary accept button
            // Broaden to include just "Run" if it's a monaco-button
            const isRunShortcut = text.includes('run') && (text.includes('alt') || text.includes('enter') || text.includes('⏎'));

            if (!hasAcceptWord && !isRunShortcut) return false;

            // 3. SAFETY (Banned Commands)
            if (text.includes('run') || text.includes('execute')) {
                const nearbyText = findNearbyCommandText(el);
                if (isCommandBanned(nearbyText)) {
                    log(`[Safety] BANNED: "${nearbyText.substring(0, 50)}..."`);
                    return false;
                }
            }

            // 4. VISIBILITY & USABILITY
            const style = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();

            // ULTRA-RELAXED VISIBILITY for high-confidence 'Run' buttons
            const isRunButton = text.includes('run') || text.includes('accept');
            const minSize = isRunButton ? 0 : 1; // Trust run buttons even if tiny/scaling

            const isVisible = style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                style.opacity !== '0' &&
                rect.width > minSize &&
                rect.height > minSize;

            if (!isVisible) {
                if (isRunButton && Math.random() < 0.1) {
                    log(`[Diagnostic] Run button found but hidden/0-size: "${text}" (display=${style.display}, vis=${style.visibility}, op=${style.opacity}, rect=${rect.width}x${rect.height})`);
                }
                return false;
            }

            // EXCLUSION: Only reject 'always run' if there's a better 'Run' button nearby
            if (text === 'always run' && el.classList.contains('monaco-text-button')) {
                // Check if this is part of a dropdown pair
                const parent = el.parentElement;
                if (parent && parent.querySelector('.monaco-button:not(.monaco-text-button)')) {
                    return false; // Skip the secondary 'always run' part of a split button
                }
            }

            if (el.classList.contains('monaco-button')) return true;

            return style.pointerEvents !== 'none' && !el.disabled && !el.hasAttribute('data-aa-clicked');
        };

        const result = check();
        buttonResultCache.set(el, result);
        return result;
    }

    /**
     * Check if an element is still visible in the DOM.
     * @param {Element} el - Element to check
     * @returns {boolean} True if element is visible
     */
    function isElementVisible(el) {
        if (!el || !el.isConnected) return false;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && rect.width > 0 && style.visibility !== 'hidden';
    }

    /**
     * Wait for an element to disappear (removed from DOM or hidden).
     * @param {Element} el - Element to watch
     * @param {number} timeout - Max time to wait in ms
     * @returns {Promise<boolean>} True if element disappeared
     */
    function waitForDisappear(el, timeout = 500) {
        return new Promise(resolve => {
            const startTime = Date.now();
            const check = () => {
                if (!isElementVisible(el)) {
                    resolve(true);
                } else if (Date.now() - startTime >= timeout) {
                    resolve(false);
                } else {
                    requestAnimationFrame(check); // Restored for reload stability
                }
            };
            setTimeout(check, 50);
        });
    }

    // --- Helper: Auto-Expand ---
    async function performExpand() {
        // Targeted selectors for "Expand", "Show", "Details" toggles
        // DISABLED PERMANENTLY: Causes menu flickering on Antigravity UI
        const expandSelectors = [];

        let expandedCount = 0;
        for (const sel of expandSelectors) {
            const els = queryAll(sel);
            for (const el of els) {
                // --- SAFETY FILTERS (Prevent Flickering) ---
                // Exclude File Explorer / SideBar / Settings Tree
                if (el.matches('.monaco-tl-twistie') || el.closest('.monaco-tl-twistie')) continue;
                if (el.closest('.monaco-list-row')) continue;
                if (el.closest('.sidebar')) continue;
                if (el.closest('.activity-bar')) continue;

                // Exclude "Ask every time" / "Always run" dropdowns
                const t = (el.textContent || '').toLowerCase();
                const textBlacklist = [
                    'ask every time', 'always run', 'configure', // Permissions
                    'model', 'gemini', 'claude', 'gpt', 'planning', 'fast', 'slow', 'mode', // Global Selectors
                    'add conversation', 'filter', // Toolbar
                    'customizations', 'mcp servers', // Top right menu
                    'add context', 'media', 'mentions', 'workflows' // Bottom left context menu
                ];

                if (textBlacklist.some(bad => t.includes(bad))) continue;

                // Additional check for aria-label (often used for tooltips/buttons)
                const label = (el.getAttribute('aria-label') || '').toLowerCase();
                if (textBlacklist.some(bad => label.includes(bad))) continue;

                // Only allow expansion if inside content areas (Chat, Editor, Output)
                // Heuristic: If we can't confirm it's safe, SKIP IT.
                // But detecting "safe" is hard. Exclusion is better.

                if (el.getAttribute('data-auto-expanded') === 'true') continue;

                log(`[Expand] Clicking safe expander: ${sel}`);
                el.click();
                el.setAttribute('data-auto-expanded', 'true'); // Prevent double click
                expandedCount++;
                await new Promise(r => setTimeout(r, 50));
            }
        }
        return expandedCount;
    }

    // --- 5. MAIN LOOP ---
    async function staticLoop(sid) {
        const state = window.__autoAcceptState;
        if (!state || !state.isRunning || state.sessionID !== sid) {
            log(`[Loop] Terminating stale session ${sid}`);
            return;
        }

        const startTime = performance.now();
        try {
            // Broaden selectors to catch all potential button-like elements in Antigravity/Cursor
            const selectors = [
                'button:not([disabled])',
                'div[role="button"]:not([disabled])',
                '.monaco-button:not(.disabled)',
                '.bg-ide-button-background',
                '[class*="button"]' // High-risk but necessary fallback
            ];
            await performClick(selectors);
        } catch (e) {
            log(`STALL ERROR: ${e.message}\n${e.stack}`);
        }

        const duration = performance.now() - startTime;
        if (duration > 200) {
            log(`[Performance] SLOW LOOP: ${duration.toFixed(1)}ms. Active roots: ${cachedRoots.length}`);
        }

        // Delay: 50ms if fast, longer if slow.
        const nextDelay = duration > 100 ? 100 : 50;
        setTimeout(() => staticLoop(sid), nextDelay);
    }

    // Periodically clear the button result cache to handle dynamic changes
    setInterval(() => buttonResultCache.clear(), 1000);

    async function performClick(selectors) {
        // Skip if user is focused on input/textarea (typing)
        const activeEl = document.activeElement;
        if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) {
            return 0; // Don't interfere with user typing
        }

        const found = [];
        selectors.forEach(s => queryAll(s).forEach(el => found.push(el)));
        let clicked = 0;
        let verified = 0;
        const uniqueFound = [...new Set(found)];

        for (const el of uniqueFound) {
            if (isAcceptButton(el)) {
                const buttonText = (el.textContent || "").trim();

                // Extra check: If we've clicked this element recently, only click again if text changed
                const lastClickedText = el.getAttribute('data-aa-text');
                if (el.hasAttribute('data-aa-clicked')) {
                    if (lastClickedText === buttonText) {
                        // Truly a redundant click on the same button state
                        log(`[Throttle] Skipping recently clicked button with same text: "${buttonText}"`);
                        continue;
                    } else {
                        // Text changed! It's a recycled element (e.g. next command in queue)
                        el.removeAttribute('data-aa-clicked');
                    }
                }

                log(`Clicking: "${buttonText}"`);

                // Tag as clicked with current text state
                el.setAttribute('data-aa-clicked', Date.now());
                el.setAttribute('data-aa-text', buttonText);

                // Remove tag after 250ms (enough to skip redundant cycles but fast for batching)
                setTimeout(() => {
                    if (el.isConnected) el.removeAttribute('data-aa-clicked');
                }, 250);

                // Try native click first
                if (typeof el.click === 'function') {
                    el.click();
                }

                // Also dispatch synthetic click event (catches custom handlers)
                el.dispatchEvent(new MouseEvent('click', { view: window, bubbles: true, cancelable: true }));
                clicked++;

                // NO AWAIT: Fire and move to the next item for instant response
                Analytics.trackClick(buttonText, log);
                verified++;
            }
        }

        if (clicked > 0) {
            log(`[Click] Attempted: ${clicked}, Verified: ${verified}`);
        }
        return verified;
    }

    // --- 4. POLL LOOPS ---
    async function cursorLoop(sid) {
        log('[Loop] cursorLoop STARTED');
        let index = 0;
        let cycle = 0;
        while (window.__autoAcceptState.isRunning && window.__autoAcceptState.sessionID === sid) {
            cycle++;
            log(`[Loop] Cycle ${cycle}: Starting...`);

            const clicked = await performClick(['button', '[class*="button"]', '[class*="anysphere"]']);
            log(`[Loop] Cycle ${cycle}: Clicked ${clicked} buttons`);

            await new Promise(r => setTimeout(r, 800));

            // Try multiple selectors for Cursor tabs
            const tabSelectors = [
                '#workbench\\.parts\\.auxiliarybar ul[role="tablist"] li[role="tab"]',
                '.monaco-pane-view .monaco-list-row[role="listitem"]',
                'div[role="tablist"] div[role="tab"]',
                '.chat-session-item' // Potential future-proof selector
            ];

            let tabs = [];
            for (const selector of tabSelectors) {
                tabs = queryAll(selector);
                if (tabs.length > 0) {
                    log(`[Loop] Cycle ${cycle}: Found ${tabs.length} tabs using selector: ${selector}`);
                    break;
                }
            }

            if (tabs.length === 0) {
                log(`[Loop] Cycle ${cycle}: No tabs found in any known locations.`);
            }

            updateTabNames(tabs);

            if (tabs.length > 0) {
                const targetTab = tabs[index % tabs.length];
                const tabLabel = targetTab.getAttribute('aria-label') || targetTab.textContent?.trim() || 'unnamed tab';
                log(`[Loop] Cycle ${cycle}: Clicking tab "${tabLabel}"`);
                targetTab.dispatchEvent(new MouseEvent('click', { view: window, bubbles: true, cancelable: true }));
                index++;
            }

            const state = window.__autoAcceptState;
            log(`[Loop] Cycle ${cycle}: State = { tabs: ${state.tabNames?.length || 0}, isRunning: ${state.isRunning}, sid: ${state.sessionID} }`);

            updateOverlay();
            log(`[Loop] Cycle ${cycle}: Overlay updated, waiting 3s...`);

            await new Promise(r => setTimeout(r, 3000));
        }
        log('[Loop] cursorLoop STOPPED');
    }

    async function antigravityLoop(sid) {
        log('[Loop] antigravityLoop STARTED (NO TAB CYCLING)');
        let cycle = 0;
        while (window.__autoAcceptState.isRunning && window.__autoAcceptState.sessionID === sid) {
            cycle++;

            // ONLY click Accept/Run/Retry buttons - DO NOT touch tabs or conversations
            const clicked = await performClick(['button', '[role="button"]', 'div[role="button"]', '.bg-ide-button-background', '[class*="button"]']);

            if (clicked > 0) {
                log(`[Loop] Cycle ${cycle}: Clicked ${clicked} accept buttons`);
            }

            // Wait 1s between scans
            await new Promise(r => setTimeout(r, 1000));
        }
        log('[Loop] antigravityLoop STOPPED');
    }

    // --- 5. LIFECYCLE API ---
    // --- Update banned commands list ---
    window.__autoAcceptUpdateBannedCommands = function (bannedList) {
        const state = window.__autoAcceptState;
        state.bannedCommands = Array.isArray(bannedList) ? bannedList : [];
        log(`[Config] Updated banned commands list: ${state.bannedCommands.length} patterns`);
        if (state.bannedCommands.length > 0) {
            log(`[Config] Banned patterns: ${state.bannedCommands.join(', ')}`);
        }
    };

    // --- Get current stats for ROI notification ---
    window.__autoAcceptGetStats = function () {
        const stats = Analytics.getStats();
        return {
            clicks: stats.clicksThisSession || 0,
            blocked: stats.blockedThisSession || 0,
            sessionStart: stats.sessionStartTime,
            fileEdits: stats.fileEditsThisSession || 0,
            terminalCommands: stats.terminalCommandsThisSession || 0,
            actionsWhileAway: stats.actionsWhileAway || 0
        };
    };

    // --- Reset stats (called when extension wants to collect and reset) ---
    window.__autoAcceptResetStats = function () {
        return Analytics.collectROI(log);
    };

    // --- Get session summary for notifications ---
    window.__autoAcceptGetSessionSummary = function () {
        return Analytics.getSessionSummary();
    };

    // --- Get and reset away actions count ---
    window.__autoAcceptGetAwayActions = function () {
        return Analytics.consumeAwayActions(log);
    };

    // --- Set focus state (called from extension - authoritative source) ---
    window.__autoAcceptSetFocusState = function (isFocused) {
        Analytics.setFocusState(isFocused, log);
    };

    window.__autoAcceptStart = function (config) {
        try {
            const ide = (config.ide || 'cursor').toLowerCase();
            const isPro = config.isPro !== false;
            const isBG = config.isBackgroundMode === true;

            // Update banned commands from config
            if (config.bannedCommands) {
                window.__autoAcceptUpdateBannedCommands(config.bannedCommands);
            }

            log(`__autoAcceptStart called: ide=${ide}, isPro=${isPro}, isBG=${isBG}`);

            const state = window.__autoAcceptState;

            // Skip restart only if EXACTLY the same config
            if (state.isRunning && state.currentMode === ide && state.isBackgroundMode === isBG) {
                log(`Already running with same config, skipping`);
                return;
            }

            // Stop previous loop if switching
            if (state.isRunning) {
                log(`Stopping previous session...`);
                state.isRunning = false;
            }

            state.isRunning = true;
            state.currentMode = ide;
            state.isBackgroundMode = isBG;
            state.sessionID++;
            const sid = state.sessionID;

            // Initialize session start time if not set (for stats tracking)
            if (!state.stats.sessionStartTime) {
                state.stats.sessionStartTime = Date.now();
            }

            log(`Agent Loaded (IDE: ${ide}, BG: ${isBG}, isPro: ${isPro})`, true);

            if (isBG && isPro) {
                log(`[BG] Background Mode enabled (no overlay), starting ${ide} loop...`);
                // NO OVERLAY - just run the background polling loop
                hideOverlay(); // Ensure any previous overlay is hidden
                if (ide === 'cursor') cursorLoop(sid);
                else antigravityLoop(sid);
            } else if (isBG && !isPro) {
                log(`[BG] Background mode enabled, starting ${ide} loop...`);
                hideOverlay();
                if (ide === 'cursor') cursorLoop(sid);
                else antigravityLoop(sid);
            } else {
                log(`Starting static poll loop... (SID: ${sid})`);
                staticLoop(sid);
            }
        } catch (e) {
            log(`ERROR in __autoAcceptStart: ${e.message}`);
            console.error('[AutoAccept] Start error:', e);
        }
    };

    window.__autoAcceptStop = function () {
        window.__autoAcceptState.isRunning = false;
        hideOverlay();
        log("Agent Stopped.");
    };

    log("Core Bundle Initialized.", true);
})();
