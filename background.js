// background.js — Service Worker
// Handles CSS injection (bypasses page CSP) and other privileged operations

const EDIT_MODE_CSS = `
  app-zone-elements {
    cursor: crosshair !important;
  }
`;

const EXTENSION_ENABLED_KEY = 'csZoningExtensionEnabled';

// Tracks known content-script frame ids per tab for true fan-out messaging.
const tabFrameRegistry = new Map(); // tabId -> Set<frameId>

function isContentsquareUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return /(^https?:\/\/)([^/]*\.)?contentsquare\.com\//i.test(url);
}

// UPDATED: Now detects BOTH Zoning and Journey Analysis pages
function isEligibleUrl(url) {
  if (!isContentsquareUrl(url)) return false;
  
  const isZoning = /\/analyze\/zoning(?:-v2)?(?:\/|\b|[#?])/i.test(url)
    || /#\/analyze\/zoning(?:-v2)?\//i.test(url)
    || /#\/analyze\/zoning(?:-v2)?\b/i.test(url);

  // JOURNEY ONLY: Must have navigation-path BUT must NOT have funnel
  const isJourney = url.includes('/analyze/navigation-path') && !url.includes('/navigation-path/funnel');

  return isZoning || isJourney;
}

function getExtensionEnabled() {
  return new Promise(resolve => {
    chrome.storage.local.get(EXTENSION_ENABLED_KEY, result => {
      resolve(result[EXTENSION_ENABLED_KEY] !== false);
    });
  });
}

function setActionBadge(tabId, enabled) {
  const badgeText = enabled ? 'ON' : 'OFF';
  const badgeColor = enabled ? '#16a34a' : '#6b7280'; // Green for ON, Gray for OFF

  chrome.action.setBadgeText({ tabId, text: badgeText }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ tabId, color: badgeColor }).catch(() => {});
  chrome.action.setBadgeTextColor?.({ tabId, color: '#ffffff' }).catch(() => {});
}

// UPDATED: Now enables the icon for Journey pages too
async function updateActionStateForTab(tabId, url) {
  if (typeof tabId !== 'number') return;
  const enabled = await getExtensionEnabled();
  const eligible = isEligibleUrl(url || '');

  if (!eligible) {
    await chrome.action.disable(tabId).catch(() => {});
    await chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
    return;
  }

  await chrome.action.enable(tabId).catch(() => {});
  setActionBadge(tabId, enabled);
}

async function updateActionStateForAllTabs() {
  const tabs = await chrome.tabs.query({}).catch(() => []);
  await Promise.all((tabs || []).map(tab => updateActionStateForTab(tab.id, tab.url || '')));
}

async function ensureContentScriptInjected(tabId, reason) {
  if (typeof tabId !== 'number') return;

  try {
    const probe = await chrome.tabs.sendMessage(tabId, { type: 'ping' });
    if (probe?.ok) {
      console.log('[CS Demo Tool][bg] content script already present', { tabId, reason });
      return;
    }
  } catch (_) {
    // No receiver in this tab yet; proceed with injection.
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['content/content.js']
    });
    console.log('[CS Demo Tool][bg] injected content script', { tabId, reason });
  } catch (error) {
    console.warn('[CS Demo Tool][bg] injection skipped/failed', {
      tabId,
      reason,
      error: error?.message || String(error)
    });
  }
}

function registerFrameForTab(tabId, frameId) {
  if (typeof tabId !== 'number' || typeof frameId !== 'number') return;
  const known = tabFrameRegistry.get(tabId) || new Set();
  known.add(frameId);
  tabFrameRegistry.set(tabId, known);
}

function unregisterTab(tabId) {
  if (typeof tabId !== 'number') return;
  tabFrameRegistry.delete(tabId);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'getExtensionEnabled') {
    getExtensionEnabled().then(enabled => sendResponse({ enabled }));
    return true;
  }

  if (msg.type === 'setExtensionEnabled') {
    const enabled = msg.enabled !== false;
    chrome.storage.local.set({ [EXTENSION_ENABLED_KEY]: enabled }, async () => {
      await updateActionStateForAllTabs();
      if (enabled) {
        const tabs = await chrome.tabs.query({}).catch(() => []);
        await Promise.all((tabs || []).map(tab => {
          if (!isContentsquareUrl(tab?.url || '')) return Promise.resolve();
          return ensureContentScriptInjected(tab.id, 'setExtensionEnabled:true');
        }));
      }
      sendResponse({ ok: true, enabled });
    });
    return true;
  }

  if (msg.type === 'getTabContext') {
    const tabId = Number(msg.tabId);
    if (!Number.isFinite(tabId)) {
      sendResponse({ ok: false, error: 'Invalid tab id' });
      return false;
    }

    chrome.tabs.get(tabId).then(async tab => {
      const enabled = await getExtensionEnabled();
      const url = tab?.url || '';
      sendResponse({
        ok: true,
        enabled,
        isZoningPage: isEligibleUrl(url), // Broadened to include Journeys
        isContentsquarePage: isContentsquareUrl(url),
        url: url
      });
    }).catch(error => {
      sendResponse({ ok: false, error: error?.message || String(error) });
    });
    return true;
  }

  if (!sender.tab) return;

  registerFrameForTab(sender.tab.id, sender.frameId || 0);

  if (msg.type === 'registerFrame') {
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === 'broadcastToTab') {
    const tabId = sender.tab.id;
    const frameIds = Array.from(tabFrameRegistry.get(tabId) || [0]);
    const sends = frameIds.map(frameId => {
      return chrome.tabs.sendMessage(tabId, msg.payload, { frameId })
        .then(payload => ({ ok: true, frameId, payload }))
        .catch(error => ({ ok: false, frameId, error: error?.message || String(error) }));
    });

    Promise.all(sends)
      .then(results => {
        const delivered = results.filter(r => r.ok).length;
        const attempted = results.length;
        if (delivered === 0) {
          const firstError = results.find(r => !r.ok)?.error || 'No frame accepted message';
          sendResponse({ ok: false, attempted, delivered, error: firstError, results });
          return;
        }
        sendResponse({ ok: true, attempted, delivered, results });
      })
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.type === 'insertEditCSS') {
    chrome.scripting.insertCSS({
      target: { tabId: sender.tab.id },
      css: EDIT_MODE_CSS
    })
    .then(() => sendResponse({ ok: true }))
    .catch(e => sendResponse({ ok: false, error: e.message }));
    return true; // async
  }

  if (msg.type === 'removeEditCSS') {
    chrome.scripting.removeCSS({
      target: { tabId: sender.tab.id },
      css: EDIT_MODE_CSS
    })
    .then(() => sendResponse({ ok: true }))
    .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }
});

chrome.tabs.onRemoved.addListener(tabId => {
  unregisterTab(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  const url = tab?.url || changeInfo.url || '';

  updateActionStateForTab(tabId, url);

  getExtensionEnabled().then(enabled => {
    if (!enabled || !isContentsquareUrl(url)) return;
    ensureContentScriptInjected(tabId, 'tabs.onUpdated complete');
  });
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    const url = tab?.url || '';
    await updateActionStateForTab(tabId, url);
    const enabled = await getExtensionEnabled();
    if (!enabled || !isContentsquareUrl(url)) return;
    ensureContentScriptInjected(tabId, 'tabs.onActivated');
  } catch (_) {
    // Ignore tabs that disappear during activation handling.
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  const enabled = await getExtensionEnabled();
  await chrome.storage.local.set({ [EXTENSION_ENABLED_KEY]: enabled });
  await updateActionStateForAllTabs();

  if (enabled) {
    const tabs = await chrome.tabs.query({}).catch(() => []);
    await Promise.all((tabs || []).map(tab => {
      if (!isContentsquareUrl(tab?.url || '')) return Promise.resolve();
      return ensureContentScriptInjected(tab.id, 'onInstalled bootstrap');
    }));
  }
});

chrome.runtime.onStartup?.addListener(() => {
  updateActionStateForAllTabs();
  getExtensionEnabled().then(async enabled => {
    if (!enabled) return;
    const tabs = await chrome.tabs.query({}).catch(() => []);
    await Promise.all((tabs || []).map(tab => {
      if (!isContentsquareUrl(tab?.url || '')) return Promise.resolve();
      return ensureContentScriptInjected(tab.id, 'onStartup bootstrap');
    }));
  });
});