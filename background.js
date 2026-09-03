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

// Mirrors content.js's normalizeCsUrlKey for the top-level tab URL (never a
// snapshot iframe URL, since chrome.tabs.get always reports the top frame's
// address). Computing the key here — from the tab's real URL — sidesteps the
// race where a subframe asks the top frame's content script for its key
// before that script has finished initializing.
function normalizeCsUrlKeyBg(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return parsed.origin + parsed.pathname + parsed.hash.split('?')[0];
  } catch (_) {
    return '';
  }
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

  if (msg.type === 'getActivePageKey') {
    // Direct, synchronous-from-the-caller's-perspective answer computed from
    // chrome.tabs' own record of the tab's URL — not dependent on the top
    // frame's content script having run yet, and not routed through the
    // frame registry (which can be stale/incomplete while CSQ's own
    // app-zonings component is still destroying and rebuilding pane iframes
    // during zoning-editor bootstrap).
    chrome.tabs.get(sender.tab.id).then(tab => {
      const key = normalizeCsUrlKeyBg(tab?.url || '');
      sendResponse({ ok: !!key, key });
    }).catch(error => {
      sendResponse({ ok: false, error: error?.message || String(error) });
    });
    return true;
  }

  if (msg.type === 'requestPaneSideAssignment') {
    // Tell each compare-pane iframe which side it's on via chrome.tabs.sendMessage
    // targeted at its exact frameId — an extension-privileged channel, unlike
    // window.name/postMessage which page-level cross-origin policies (e.g. COOP)
    // can silently block. chrome.webNavigation gives real frame topology
    // (parentFrameId) instead of guessing from DOM geometry, which content
    // scripts can't do across the cross-origin boundary anyway.
    const tabId = sender.tab.id;
    chrome.webNavigation.getAllFrames({ tabId }).then(frames => {
      const candidates = (frames || [])
        .filter(f => f.parentFrameId === 0 && f.frameId !== 0 && /snapshot\.contentsquare\.com/i.test(f.url || ''))
        .sort((a, b) => a.frameId - b.frameId);

      if (candidates.length < 2) {
        sendResponse({ ok: false, reason: 'fewer than 2 candidate pane frames found', candidateCount: candidates.length });
        return;
      }

      const leftFrameId = candidates[0].frameId;
      const rightFrameId = candidates[candidates.length - 1].frameId;

      Promise.all([
        chrome.tabs.sendMessage(tabId, { type: 'assignPaneSide', side: 'left' }, { frameId: leftFrameId }).catch(() => null),
        chrome.tabs.sendMessage(tabId, { type: 'assignPaneSide', side: 'right' }, { frameId: rightFrameId }).catch(() => null)
      ]).then(() => {
        sendResponse({ ok: true, leftFrameId, rightFrameId, candidateCount: candidates.length });
      });
    }).catch(error => {
      sendResponse({ ok: false, error: error?.message || String(error) });
    });
    return true;
  }

  if (msg.type === 'getMyPaneSide') {
    // Self-service pull, called directly by a pane iframe's own content
    // script (with retries on its side) rather than waiting on the top
    // frame to notice DOM changes and push a one-shot assignment. That push
    // (requestPaneSideAssignment above) has no retry, so if it fires while
    // CSQ's own app-zonings component is still destroying/rebuilding pane
    // iframes and fewer than 2 candidates exist yet, the assignment is lost
    // for good. This lets a frame that missed it ask again once topology
    // has settled.
    //
    // Resolves the side by matching this frame's own URL against the top
    // frame's live geometry (queryPaneGeometry), not by frameId order —
    // frameId reflects creation order, not screen position, and the two
    // can disagree after a destroy/rebuild cycle. Falls back to frameId
    // order only if the geometry query is unavailable or neither URL
    // matches (e.g. iframe src differs slightly from its committed URL).
    const tabId = sender.tab.id;
    const requestingFrameId = sender.frameId;
    Promise.all([
      chrome.webNavigation.getAllFrames({ tabId }),
      chrome.tabs.sendMessage(tabId, { type: 'queryPaneGeometry' }, { frameId: 0 }).catch(error => ({ ok: false, error: error?.message || String(error) }))
    ]).then(([frames, geometry]) => {
      const candidates = (frames || [])
        .filter(f => f.parentFrameId === 0 && f.frameId !== 0 && /snapshot\.contentsquare\.com/i.test(f.url || ''))
        .sort((a, b) => a.frameId - b.frameId);

      if (candidates.length < 2) {
        sendResponse({ ok: false, reason: 'fewer than 2 candidate pane frames found', candidateCount: candidates.length });
        return;
      }

      const idx = candidates.findIndex(f => f.frameId === requestingFrameId);
      if (idx === -1) {
        sendResponse({ ok: false, reason: 'requesting frame not among current candidates', candidateCount: candidates.length });
        return;
      }

      const ownUrl = candidates[idx].url || '';
      let side = null;
      let method = null;
      if (geometry && geometry.ok) {
        if (geometry.leftSrc && ownUrl === geometry.leftSrc) { side = 'left'; method = 'geometry'; }
        else if (geometry.rightSrc && ownUrl === geometry.rightSrc) { side = 'right'; method = 'geometry'; }
      }
      if (!side && geometry && geometry.error) {
        // Geometry query itself is unavailable (e.g. top frame not
        // responding at all) — fall back to frameId order rather than
        // stalling forever. Best-effort only; may be wrong after churn.
        side = idx === 0 ? 'left' : (idx === candidates.length - 1 ? 'right' : null);
        method = 'frameOrderFallback';
      }
      if (!side) {
        // Geometry answered but topology isn't settled yet (not ready, or
        // this frame's URL didn't match either slot this instant) — say so
        // without guessing, so the caller retries instead of locking in a
        // wrong answer.
        sendResponse({ ok: false, reason: 'geometry not ready or no match yet', geometryOk: !!(geometry && geometry.ok), candidateCount: candidates.length, ownUrl, leftSrc: geometry?.leftSrc, rightSrc: geometry?.rightSrc });
        return;
      }
      sendResponse({ ok: true, side, method, candidateCount: candidates.length });
    }).catch(error => {
      sendResponse({ ok: false, error: error?.message || String(error) });
    });
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