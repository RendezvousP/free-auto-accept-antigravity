const vscode = require('vscode');

// --- CONSTANTS ---
const GLOBAL_STATE_KEY = 'free-auto-accept-enabled';
// Polling frequency in ms. Default to 100ms for responsiveness (Unlimited speed)
const POLL_FREQUENCY = 1000; // Faster polling (1s)

// --- STATE ---
let isEnabled = false;
let pollTimer;
let statusBarItem;
let outputChannel;

// --- HANDLERS ---
let cdpHandler;
let relauncher;

function log(message) {
    try {
        const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
        outputChannel ? outputChannel.appendLine(`[${timestamp}] ${message}`) : console.log(`[${timestamp}] ${message}`);
    } catch (e) { console.error(e); }
}

async function activate(context) {
    console.log('Free Auto Accept: Activating...');

    // 1. Create Output Channel
    outputChannel = vscode.window.createOutputChannel('Free Auto Accept');
    context.subscriptions.push(outputChannel);

    // 2. Create Status Bar Item
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'free-auto-accept.toggle';
    context.subscriptions.push(statusBarItem);
    updateStatusBar();
    statusBarItem.show();

    // 3. Initialize State
    isEnabled = false; // Always start OFF to avoid UI freeze

    // 4. Initialize Handlers
    try {
        const { CDPHandler } = require('./main_scripts/cdp-handler');
        const { Relauncher } = require('./main_scripts/relauncher');
        cdpHandler = new CDPHandler(log);
        relauncher = new Relauncher(log);
        log('CDP Handlers initialized.');
    } catch (e) {
        log(`Failed to load handlers: ${e.message}`);
        vscode.window.showErrorMessage(`Free Auto Accept Error: ${e.message}`);
    }

    // 5. Register Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('free-auto-accept.toggle', () => handleToggle(context)),
        vscode.commands.registerCommand('free-auto-accept.relaunch', () => handleRelaunch())
    );

    // 6. Start if enabled
    if (isEnabled) {
        startPolling();
    }
}

async function handleToggle(context) {
    isEnabled = !isEnabled;
    await context.globalState.update(GLOBAL_STATE_KEY, isEnabled);
    updateStatusBar();

    if (isEnabled) {
        log('Extension Enabled');
        startPolling();
    } else {
        log('Extension Disabled');
        stopPolling();
    }
}

async function handleRelaunch() {
    if (relauncher) await relauncher.ensureCDPAndRelaunch();
}

function updateStatusBar() {
    if (isEnabled) {
        statusBarItem.text = '$(zap) Auto Accept: ON';
        statusBarItem.tooltip = 'Free Auto Accept is running (High Speed)';
    } else {
        statusBarItem.text = '$(circle-slash) Auto Accept: OFF';
        statusBarItem.tooltip = 'Click to enable Free Auto Accept';
    }
}

async function startPolling() {
    if (pollTimer) clearInterval(pollTimer);

    // Initial sync
    syncSessions();

    // Poll to keep sessions active
    pollTimer = setInterval(() => {
        if (isEnabled) syncSessions();
    }, 2000); // Check for new windows every 2s
}

async function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    if (cdpHandler) await cdpHandler.stop();
}

async function syncSessions() {
    if (cdpHandler) {
        try {
            await cdpHandler.start({
                isPro: true, // Pro mode
                isBackgroundMode: false, // DISABLED: Causing cursor freeze
                pollInterval: POLL_FREQUENCY, // UNLOCKED: High speed
                ide: 'antigravity',
                bannedCommands: [] // UNLOCKED: No blocked commands by default
            });
        } catch (e) {
            log(`Sync error: ${e.message}`);
        }
    }
}

function deactivate() {
    stopPolling();
}

module.exports = {
    activate,
    deactivate
};
