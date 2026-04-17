// popup/popup.js

let currentTabId = null;
let currentUrl = null;
let extensionEnabled = true;
let currentState = { isZoningPage: false, isJourneyPage: false, analysisMode: 'unknown', editMode: false, uiVisible: true, overrideCount: 0 };

async function tryInjectContentScript(tabId) {
  if (!tabId) return false;
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['content/content.js']
    });
    return true;
  } catch (err) {
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

document.addEventListener('DOMContentLoaded', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTabId = tab?.id;

  if (!currentTabId) {
    setStatus('error', 'No active tab');
    return;
  }

  const context = await chrome.runtime.sendMessage({ type: 'getTabContext', tabId: currentTabId });
  extensionEnabled = !!context?.enabled;

  if (!context?.ok || !context.isContentsquarePage) {
    setStatus(context?.ok ? 'not-on-cs' : 'error', context?.ok ? 'Not on ContentSquare' : 'Could not read state');
    updateExtensionToggleUi();
    setupListeners();
    return;
  }

  const url = tab?.url || '';
  const isJourneyPage = url.includes('/analyze/navigation-path') && !url.includes('/navigation-path/funnel');

  if (!context.isZoningPage && !isJourneyPage) {
    setStatus('inactive', extensionEnabled ? 'Open a Zoning or Journey page' : 'Extension is OFF');
    updateExtensionToggleUi();
    setupListeners();
    return;
  }

  if (!extensionEnabled) {
    setStatus('inactive', 'Extension is OFF on this page');
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

function updateUI(state) {
  const editBtn = document.getElementById('btn-edit-toggle');
  const editHint = document.getElementById('edit-hint');
  const editBadge = document.getElementById('edit-badge');
  const overrideInfo = document.getElementById('override-info');
  const resetAllBtn = document.getElementById('btn-reset-all');
  const uiBtn = document.getElementById('btn-ui-toggle');

  const pageEligible = !!state.isZoningPage || !!state.isJourneyPage;
  const controlsEnabled = pageEligible && extensionEnabled;

  if (!extensionEnabled) {
    setStatus('inactive', pageEligible ? 'Extension is OFF on this page' : 'Extension is OFF');
    editBtn.disabled = true; uiBtn.disabled = true; resetAllBtn.disabled = true;
    editHint.style.display = 'block';
    editHint.textContent = 'Turn the extension ON to edit data.';
  } else if (state.isJourneyPage) {
    setStatus('active', `Journey report detected`);
    editBtn.disabled = true; // Edit mode is for zoning clicks, not journeys
    uiBtn.disabled = false;
    resetAllBtn.disabled = false;
    editHint.style.display = 'block';
    editHint.textContent = 'Use the Advanced menu in the webpage to configure Journeys.';
  } else if (state.isZoningPage) {
    setStatus('active', `Zoning report detected`);
    editBtn.disabled = false; uiBtn.disabled = false; resetAllBtn.disabled = false;
    editHint.style.display = 'none';
  } else if (state.analysisMode === 'heatmap') {
    setStatus('inactive', 'Heatmap view detected');
    editBtn.disabled = false; uiBtn.disabled = false; resetAllBtn.disabled = true;
    editHint.style.display = 'block';
    editHint.textContent = 'Heatmap editing is available. Turn editing on, then click the heatmap.';
  }

  if (controlsEnabled && state.editMode && state.isZoningPage) {
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

  const c = state.overrideCount;
  if (c > 0) {
    overrideInfo.textContent = `${c} zone${c !== 1 ? 's' : ''} overridden on this page`;
    overrideInfo.classList.add('has-overrides');
    resetAllBtn.style.display = 'block';
  } else {
    overrideInfo.textContent = 'No active overrides';
    overrideInfo.classList.remove('has-overrides');
    if (!state.isJourneyPage) resetAllBtn.style.display = 'none';
  }
}

function updateExtensionToggleUi() {
  const toggle = document.getElementById('extension-toggle');
  if (!toggle) return;
  toggle.checked = !!extensionEnabled;
}

function setStatus(type, text) {
  const dot = document.getElementById('status-dot');
  const label = document.getElementById('status-text');
  label.textContent = text;
  dot.className = 'status-dot ' + type;
}

function setupListeners() {
  document.getElementById('extension-toggle').addEventListener('change', async event => {
    const next = !!event.target.checked;
    const response = await chrome.runtime.sendMessage({ type: 'setExtensionEnabled', enabled: next });
    extensionEnabled = !!response?.enabled;
    updateExtensionToggleUi();
    if (currentTabId) {
      try { await sendMessageWithInjection({ type: 'setMasterEnabled', enabled: extensionEnabled }); } catch (e) {}
    }
    if (!extensionEnabled) {
      currentState = { ...currentState, editMode: false, uiVisible: false };
      updateUI(currentState);
      return;
    }
    try {
      const refreshed = await sendMessageWithInjection({ type: 'getState' });
      currentState = refreshed; currentUrl = refreshed.url;
      updateUI(currentState); loadScenarios();
    } catch (_) { setStatus('inactive', 'Extension enabled.'); }
  });

  document.getElementById('btn-edit-toggle').addEventListener('click', async () => {
    if (!extensionEnabled) return;
    const newMode = !currentState.editMode;
    await sendMessageWithInjection({ type: 'setEditMode', enabled: newMode });
    currentState.editMode = newMode; currentState.isZoningPage = true; updateUI(currentState);
  });

  document.getElementById('btn-reset-all').addEventListener('click', async () => {
    if (!extensionEnabled) return;
    if (!confirm('Reset all overrides on this page? This cannot be undone.')) return;
    await sendMessageWithInjection({ type: 'resetAll' });
    currentState.overrideCount = 0; updateUI(currentState); loadScenarios();
  });

  document.getElementById('btn-ui-toggle').addEventListener('click', async () => {
    if (!extensionEnabled) return;
    const visible = !(currentState.uiVisible === false);
    await sendMessageWithInjection({ type: 'setUiVisible', visible: !visible });
    currentState.uiVisible = !visible; updateUI(currentState);
  });

  document.getElementById('btn-save-scenario').addEventListener('click', async () => {
    if (!extensionEnabled) return;
    const name = document.getElementById('inp-scenario-name').value.trim();
    if (!name) return document.getElementById('inp-scenario-name').focus();
    let overrides = {};
    try {
      const data = await chrome.storage.local.get('csZoningOverrides');
      overrides = (data.csZoningOverrides || {})[currentUrl || currentState.url] || {};
    } catch (_) {}
    chrome.storage.local.get('csZoningScenarios', result => {
      const all = result.csZoningScenarios || {};
      all[name] = { url: currentUrl || currentState.url, createdAt: Date.now(), overrides: { ...overrides } };
      chrome.storage.local.set({ csZoningScenarios: all }, () => {
        document.getElementById('inp-scenario-name').value = ''; loadScenarios();
      });
    });
  });
}

function loadScenarios() {
  chrome.storage.local.get('csZoningScenarios', result => {
    const all = result.csZoningScenarios || {};
    const filtered = Object.entries(all).filter(([, v]) => !currentUrl || v.url === currentUrl).sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0));
    const list = document.getElementById('scenarios-list');
    if (filtered.length === 0) { list.innerHTML = '<div class="empty-state">No scenarios saved</div>'; return; }
    list.innerHTML = filtered.map(([name, sc]) => `
      <div class="scenario-item">
        <div class="scenario-info"><div class="scenario-name">${escHtml(name)}</div><div class="scenario-meta">${Object.keys(sc.overrides || {}).length} overrides</div></div>
        <div class="scenario-actions">
          <button class="btn btn-tiny btn-load" data-load="${escHtml(name)}">Load</button>
          <button class="btn btn-tiny btn-del-sc" data-del="${escHtml(name)}">✕</button>
        </div>
      </div>
    `).join('');

    list.querySelectorAll('.btn-load').forEach(btn => btn.addEventListener('click', async () => {
      await sendMessageWithInjection({ type: 'loadScenario', overrides: all[btn.dataset.load].overrides });
      const refreshed = await sendMessageWithInjection({ type: 'getState' });
      if (refreshed) { currentState = refreshed; currentUrl = refreshed.url; updateUI(currentState); }
    }));
    list.querySelectorAll('.btn-del-sc').forEach(btn => btn.addEventListener('click', () => {
      if (!confirm(`Delete scenario "${btn.dataset.del}"?`)) return;
      chrome.storage.local.get('csZoningScenarios', res => {
        const updated = res.csZoningScenarios || {}; delete updated[btn.dataset.del];
        chrome.storage.local.set({ csZoningScenarios: updated }, loadScenarios);
      });
    }));
  });
}

function escHtml(str) { return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }