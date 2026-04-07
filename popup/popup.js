// popup/popup.js

let currentTabId = null;
let currentUrl = null;
let extensionEnabled = true;
let currentState = { isZoningPage: false, analysisMode: 'unknown', editMode: false, uiVisible: true, overrideCount: 0 };

async function tryInjectContentScript(tabId) {
  if (!tabId) return false;
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['content/content.js']
    });
    return true;
  } catch (err) {
    console.warn('[CS Demo Tool][popup] Manual injection failed:', err?.message || err);
    return false;
  }
}

async function sendMessageWithInjection(message) {
  if (!currentTabId) throw new Error('No active tab');

  try {
    return await chrome.tabs.sendMessage(currentTabId, message);
  } catch (_) {
    const injected = await tryInjectContentScript(currentTabId);
    if (!injected) throw _;
    return await chrome.tabs.sendMessage(currentTabId, message);
  }
}

// ─── INIT ──────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTabId = tab?.id;

  if (!currentTabId) {
    setStatus('error', 'No active tab');
    return;
  }

  const context = await chrome.runtime.sendMessage({ type: 'getTabContext', tabId: currentTabId });
  extensionEnabled = !!context?.enabled;

  if (!context?.ok) {
    setStatus('error', 'Could not read extension state');
    updateExtensionToggleUi();
    setupListeners();
    return;
  }

  if (!context.isContentsquarePage) {
    setStatus('not-on-cs', 'Not on ContentSquare');
    updateExtensionToggleUi();
    setupListeners();
    return;
  }

  if (!context.isZoningPage) {
    setStatus('inactive', extensionEnabled ? 'Open a Zoning page' : 'Extension is OFF');
    updateExtensionToggleUi();
    setupListeners();
    return;
  }

  if (!extensionEnabled) {
    setStatus('inactive', 'Extension is OFF on this zoning page');
    updateExtensionToggleUi();
    setupListeners();
    return;
  }

  try {
    const state = await sendMessageWithInjection({ type: 'getState' });
    currentState = state;
    currentUrl = state.url;
    updateUI(state);
  } catch (_) {
    setStatus('error', 'Could not attach to page script');
    return;
  }

  updateExtensionToggleUi();
  loadScenarios();
  setupListeners();
});

// ─── UI UPDATE ─────────────────────────────────────────────────────────────

function updateUI(state) {
  const editBtn = document.getElementById('btn-edit-toggle');
  const editHint = document.getElementById('edit-hint');
  const editBadge = document.getElementById('edit-badge');
  const overrideInfo = document.getElementById('override-info');
  const resetAllBtn = document.getElementById('btn-reset-all');
  const uiBtn = document.getElementById('btn-ui-toggle');

  const pageEligible = !!state.isZoningPage;
  const controlsEnabled = pageEligible && extensionEnabled;

  if (!extensionEnabled) {
    setStatus('inactive', pageEligible ? 'Extension is OFF on this zoning page' : 'Extension is OFF');
    editBtn.disabled = true;
    uiBtn.disabled = true;
    resetAllBtn.disabled = true;
    editHint.style.display = 'block';
    editHint.textContent = 'Turn the extension ON to edit zoning and heatmap data.';
  } else if (state.isZoningPage) {
    setStatus('active', `Zoning report detected`);
    editBtn.disabled = false;
    uiBtn.disabled = false;
    resetAllBtn.disabled = false;
    editHint.style.display = 'none';
  } else if (state.analysisMode === 'heatmap') {
    setStatus('inactive', 'Heatmap view detected');
    editBtn.disabled = false;
    uiBtn.disabled = false;
    resetAllBtn.disabled = true;
    editHint.style.display = 'block';
    editHint.textContent = 'Heatmap editing is available on this view. Turn editing on, then click the heatmap surface.';
  } else {
    setStatus('inactive', 'No zoning report on this tab');
    editBtn.disabled = true;
    uiBtn.disabled = true;
    resetAllBtn.disabled = true;
    editHint.style.display = 'block';
  }

  // Edit mode button
  if (controlsEnabled && state.editMode) {
    editBtn.textContent = '✏️ Editing ON — Click to Stop';
    editBtn.classList.add('btn-active');
    editBadge.style.display = 'block';
  } else {
    editBtn.textContent = 'Enable Edit Mode';
    editBtn.classList.remove('btn-active');
    editBadge.style.display = 'none';
  }

  if (controlsEnabled && state.uiVisible === false) {
    uiBtn.textContent = 'Show Extension UI';
    uiBtn.classList.add('btn-active');
  } else {
    uiBtn.textContent = 'Hide Extension UI';
    uiBtn.classList.remove('btn-active');
  }

  // Override count
  const c = state.overrideCount;
  if (c > 0) {
    overrideInfo.textContent = `${c} zone${c !== 1 ? 's' : ''} overridden on this page`;
    overrideInfo.classList.add('has-overrides');
    resetAllBtn.style.display = 'block';
  } else {
    overrideInfo.textContent = 'No active overrides';
    overrideInfo.classList.remove('has-overrides');
    resetAllBtn.style.display = 'none';
  }
}

function updateExtensionToggleUi() {
  const toggle = document.getElementById('extension-toggle');
  if (!toggle) return;
  toggle.checked = !!extensionEnabled;
  toggle.setAttribute('aria-label', extensionEnabled ? 'Extension on' : 'Extension off');
}

function setStatus(type, text) {
  const dot = document.getElementById('status-dot');
  const label = document.getElementById('status-text');
  label.textContent = text;
  dot.className = 'status-dot ' + type;
}

// ─── EVENT LISTENERS ───────────────────────────────────────────────────────

function setupListeners() {
  document.getElementById('extension-toggle').addEventListener('change', async event => {
    const next = !!event.target.checked;
    const response = await chrome.runtime.sendMessage({ type: 'setExtensionEnabled', enabled: next });
    extensionEnabled = !!response?.enabled;
    updateExtensionToggleUi();

    // PRO FIX: Instantly tell the content script to hide/show the menu and data!
    if (currentTabId) {
      try {
        await sendMessageWithInjection({ type: 'setMasterEnabled', enabled: extensionEnabled });
      } catch (e) {}
    }

    if (!extensionEnabled) {
      currentState = { ...currentState, editMode: false, uiVisible: false };
      updateUI(currentState);
      return;
    }

    if (!currentTabId) {
      updateUI(currentState);
      return;
    }

    try {
      const refreshed = await sendMessageWithInjection({ type: 'getState' });
      currentState = refreshed;
      currentUrl = refreshed.url;
      updateUI(currentState);
      loadScenarios();
    } catch (_) {
      setStatus('inactive', 'Extension enabled. Open a zoning page to edit.');
    }
  });

  document.getElementById('btn-edit-toggle').addEventListener('click', async () => {
    if (!extensionEnabled) return;
    const newMode = !currentState.editMode;
    await sendMessageWithInjection({ type: 'setEditMode', enabled: newMode });
    currentState.editMode = newMode;
    currentState.isZoningPage = true;
    updateUI(currentState);
  });

  document.getElementById('btn-reset-all').addEventListener('click', async () => {
    if (!extensionEnabled) return;
    if (!confirm('Reset all overrides on this page? This cannot be undone.')) return;
    await sendMessageWithInjection({ type: 'resetAll' });
    currentState.overrideCount = 0;
    updateUI(currentState);
    loadScenarios();
  });

  document.getElementById('btn-ui-toggle').addEventListener('click', async () => {
    if (!extensionEnabled) return;
    const visible = !(currentState.uiVisible === false);
    await sendMessageWithInjection({ type: 'setUiVisible', visible: !visible });
    currentState.uiVisible = !visible;
    updateUI(currentState);
  });

  document.getElementById('btn-save-scenario').addEventListener('click', async () => {
    if (!extensionEnabled) return;
    const name = document.getElementById('inp-scenario-name').value.trim();
    if (!name) {
      document.getElementById('inp-scenario-name').focus();
      return;
    }
    // Get current overrides from storage using the exact URL key returned by content script.
    let overrides = {};
    try {
      const data = await chrome.storage.local.get('csZoningOverrides');
      const key = currentUrl || currentState.url;
      overrides = (data.csZoningOverrides || {})[key] || {};
    } catch (_) {}

    chrome.storage.local.get('csZoningScenarios', result => {
      const all = result.csZoningScenarios || {};
      all[name] = {
        url: currentUrl || currentState.url,
        createdAt: Date.now(),
        overrides: { ...overrides }
      };
      chrome.storage.local.set({ csZoningScenarios: all }, () => {
        document.getElementById('inp-scenario-name').value = '';
        loadScenarios();
      });
    });
  });
}

// ─── SCENARIOS ─────────────────────────────────────────────────────────────

function loadScenarios() {
  chrome.storage.local.get('csZoningScenarios', result => {
    const all = result.csZoningScenarios || {};
    const filtered = Object.entries(all)
      .filter(([, v]) => !currentUrl || v.url === currentUrl)
      .sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0));

    const list = document.getElementById('scenarios-list');
    if (filtered.length === 0) {
      list.innerHTML = '<div class="empty-state">No scenarios saved for this page</div>';
      return;
    }

    list.innerHTML = filtered.map(([name, sc]) => `
      <div class="scenario-item">
        <div class="scenario-info">
          <div class="scenario-name">${escHtml(name)}</div>
          <div class="scenario-meta">${Object.keys(sc.overrides || {}).length} zone overrides</div>
        </div>
        <div class="scenario-actions">
          <button class="btn btn-tiny btn-load" data-load="${escHtml(name)}">Load</button>
          <button class="btn btn-tiny btn-del-sc" data-del="${escHtml(name)}">✕</button>
        </div>
      </div>
    `).join('');

    list.querySelectorAll('.btn-load').forEach(btn => {
      btn.addEventListener('click', async () => {
        const name = btn.dataset.load;
        const sc = all[name];
        if (!sc) return;
        const loadResult = await sendMessageWithInjection({ type: 'loadScenario', overrides: sc.overrides });
        console.log('[CS Demo Tool][popup] Scenario load result:', loadResult);
        const refreshed = await sendMessageWithInjection({ type: 'getState' });
        if (refreshed) {
          currentState = refreshed;
          currentUrl = refreshed.url;
          updateUI(currentState);
        }
      });
    });

    list.querySelectorAll('.btn-del-sc').forEach(btn => {
      btn.addEventListener('click', () => {
        const name = btn.dataset.del;
        if (!confirm(`Delete scenario "${name}"?`)) return;
        chrome.storage.local.get('csZoningScenarios', res => {
          const updated = res.csZoningScenarios || {};
          delete updated[name];
          chrome.storage.local.set({ csZoningScenarios: updated }, loadScenarios);
        });
      });
    });
  });
}

// ─── UTILS ─────────────────────────────────────────────────────────────────

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
