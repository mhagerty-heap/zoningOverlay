// content/content.js — CS Zoning Demo Tool
// Runs on app.contentsquare.com
// Uses open-shadow Vue custom elements: <app-zone-elements>
// Editing: setAttribute('metric', displayStr) + setAttribute('value', num)
// Vue's custom element wrapper (_setAttr → _setProp → _update) handles re-render + color

(function () {
  'use strict';

  const existingInstance = document.documentElement?.getAttribute('data-cs-demo-instance');
  if (existingInstance) {
    return;
  }
  const bootstrapInstance = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  document.documentElement?.setAttribute('data-cs-demo-instance', bootstrapInstance);

  const CS_DEBUG = true;
  const CS_FORCE_CONTEXT = true;
  const CS_DEFAULT_LOG_MODE = 'trace'; // 'trace' | 'all' | 'off'
  const CS_ENABLE_HEATMAP_INTERACTIONS = true;
  const CS_TRACE_LOG_PREFIXES = [
    'Intercepted zone click',
    'Opening top-frame editor for',
    'Edit mode changed',
    'Storage edit-mode update received',
    'Apply override requested',
    'applyEditorOverride message',
    'applyEditorOverride matched element',
    'resetEditorOverride message',
    'resetEditorOverride matched element',
    'Persisting override',
    'Zone lookup miss for key',
    'Global zone interaction',
    'Global zone path preview',
    'Global zone match',
    'Global zone no-match',
    'Global zone block',
    'Global zone click fallback'
  ];
  const CS_ZONE_SELECTORS = 'app-zone-elements, app-zone-element';
  const HEATMAP_LAYER_KEYS = ['clicks', 'moves', 'scrolls', 'attention'];
  const isTopFrame = window.top === window;
  const frameTag = isTopFrame ? 'top' : 'subframe';

  function makeFrameInstanceKey() {
    try {
      if (window.crypto && window.crypto.randomUUID) {
        return window.crypto.randomUUID();
      }
    } catch (_) {}
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function getFrameScopeKey() {
    if (isTopFrame) return 'top';

    try {
      const frameEl = window.frameElement;
      const parentDoc = frameEl && frameEl.ownerDocument;
      if (frameEl && parentDoc) {
        const allFrames = Array.from(parentDoc.querySelectorAll('iframe, frame'));
        const idx = allFrames.indexOf(frameEl);
        if (idx >= 0) return `frame:${idx}`;
      }
    } catch (_) {
      // Cross-origin or restricted parent access.
    }

    // CORE FIX: Strip location.hash because CS injects changing JWT tokens here
    return `sub:${location.origin}${location.pathname}`;
  }


  const frameScopeKey = getFrameScopeKey();
  const frameInstanceKey = makeFrameInstanceKey();
  const frameContextKey = `${location.origin}${location.pathname}${(location.hash || '').split('?')[0]}|${frameScopeKey}|inst:${frameInstanceKey}`;

  function isContentsquareContext() {
    const href = location.href || '';
    const referrer = document.referrer || '';
    const host = location.hostname || '';
    const ancestorOrigins = Array.from(window.location.ancestorOrigins || []);
    const hasCsAncestorOrigin = ancestorOrigins.some(origin => /(^|\.)contentsquare\.com$/i.test(origin));

    let topHost = '';
    try {
      topHost = window.top?.location?.hostname || '';
    } catch (_) {
      // Cross-origin top access is expected in many preview iframes.
    }

    const referrerLooksLikeCs = referrer.includes('app.contentsquare.com')
      || /(^|\.)contentsquare\.com/i.test(referrer);

    return host === 'app.contentsquare.com'
      || /(^|\.)contentsquare\.com$/i.test(host)
      || /(^|\.)contentsquare\.com$/i.test(topHost)
      || hasCsAncestorOrigin
      || referrerLooksLikeCs
      || referrer.includes('contentsquare.com/#/analyze/zoning')
      || href.includes('contentsquare')
      || document.title.includes('Contentsquare');
  }

  if (CS_DEBUG) {
    try {
      console.log('[CS Demo Tool][boot]', {
        href: location.href,
        host: location.hostname,
        isTopFrame,
        forced: CS_FORCE_CONTEXT,
        contextMatch: isContentsquareContext(),
        referrer: document.referrer || ''
      });
    } catch (_) {
      // Ignore boot diagnostics failures.
    }
  }

  if (!CS_FORCE_CONTEXT && !isContentsquareContext()) {
    // Keep lightweight debug helpers available even when this frame is ignored.
    try {
      window.__CS_DEMO_DUMP_SELECTED = () => ({
        loaded: false,
        reason: 'content script skipped in this frame (not a Contentsquare context)',
        href: location.href,
        host: location.hostname,
        referrer: document.referrer || ''
      });
      window.__CS_DEMO_DUMP_KEYS = () => [];
    } catch (_) {
      // Ignore if window is not writable.
    }
    return;
  }

  try {
    document.documentElement?.setAttribute('data-cs-demo-loaded', '1');
    window.postMessage({
      __csDemoReady: true,
      frameContextKey,
      href: location.href,
      isTopFrame
    }, '*');
  } catch (_) {
    // Ignore readiness marker failures.
  }

  function log(...args) {
    if (!CS_DEBUG) return;
    const mode = (window.__CS_DEMO_LOG_MODE || CS_DEFAULT_LOG_MODE);
    if (mode === 'off') return;
    if (mode !== 'all') {
      const first = typeof args[0] === 'string' ? args[0] : '';
      const isTraceEvent = CS_TRACE_LOG_PREFIXES.some(prefix => first.startsWith(prefix));
      if (!isTraceEvent) return;
    }
    console.log('[CS Demo Tool]', `[${frameTag}]`, ...args);

    // Mirror subframe logs to top frame so debugging does not depend on
    // selecting the iframe console context in DevTools.
    if (!isTopFrame) {
      try {
        window.top.postMessage({
          __csDemoRelay: true,
          frameTag,
          frameContextKey,
          args: args.map(v => {
            try {
              if (typeof v === 'string') return v;
              return JSON.parse(JSON.stringify(v));
            } catch (_) {
              return String(v);
            }
          })
        }, '*');
      } catch (_) {
        // Ignore cross-origin relay failures.
      }
    }
  }

  // ─── STATE ───────────────────────────────────────────────────────────────

  let editMode = false;
  let uiVisible = true;
  let activePageKey = '';
  let csMetricTypeName = ''; // Current CS metric type label read from URL / DOM (e.g. "Click Rate")
  let overrides = {};           // { zoneId: { metric, value, origMetric, origValue } }
  const zoneObservers = new Map(); // zoneKey -> { observer, element }
  let docObserver = null;
  let toolbarHost = null;
  let toolbarShadow = null;
  let popoverHost = null;
  let popoverShadow = null;
  let popoverElement = null;
  let popoverOpenedAt = 0;
  let appliedOverrideFlag = false; // guard against MutationObserver loop
  let lastUrl = location.href;
  let lastHandledExposureRequestId = '';
  let lastDirectZoneOpenAt = 0;
  let lastDirectZoneOpenKey = '';
  let heatmapHintHost = null;
  let heatmapHintTimer = null;
  let heatmapPointOverrides = {};
  let heatmapOverlayHost = null;
  let heatmapOverlayShadow = null;
  const heatmapSurfaceOverlays = new Map();
  const heatmapAnchorElements = new Map();
  let heatmapPrimaryScrollContainer = null;
  let heatmapNeedsPersist = false;
  let lastKnownHeatmapLayer = 'clicks';

  // ─── STORAGE ─────────────────────────────────────────────────────────────

  function normalizeCsUrlKey(rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      // CORE FIX: If it's a snapshot iframe, the hash is a volatile JWT. Strip it.
      if (parsed.hostname.includes('snapshot.contentsquare.com')) {
        return parsed.origin + parsed.pathname;
      }
      // Otherwise, keep the hash (used for routing in the main app)
      return parsed.origin + parsed.pathname + parsed.hash.split('?')[0];
    } catch (_) {
      return '';
    }
  }

  

  function setActivePageKey(nextKey, syncGlobal = false) {
    if (!nextKey) return;
    activePageKey = nextKey;
    if (syncGlobal && isTopFrame) {
      chrome.storage.local.set({ csZoningActivePageKey: nextKey });
    }
  }

  function loadActivePageKey() {
    return new Promise(resolve => {
      chrome.storage.local.get('csZoningActivePageKey', result => {
        if (result.csZoningActivePageKey) {
          activePageKey = result.csZoningActivePageKey;
        }
        log('Loaded active page key:', activePageKey || '(none)');
        resolve();
      });
    });
  }

  function getCsAppUrlFromReferrer() {
    const ref = document.referrer || '';
    if (!ref) return '';
    if (!ref.includes('app.contentsquare.com')) return '';
    if (!ref.includes('#/analyze/zoning')) return '';
    return normalizeCsUrlKey(ref);
  }

  function getUrlKey() {
    if (activePageKey) return activePageKey;

    // Always prefer the CS app URL key, even from preview iframes.
    if (location.hostname === 'app.contentsquare.com') {
      return normalizeCsUrlKey(location.href);
    }

    const fromReferrer = getCsAppUrlFromReferrer();
    if (fromReferrer) return fromReferrer;

    // Fallback for unexpected contexts.
    return normalizeCsUrlKey(location.href) || (location.origin + location.pathname);
  }

  function loadOverrides() {
    return new Promise(resolve => {
      chrome.storage.local.get('csZoningOverrides', result => {
        const all = result.csZoningOverrides || {};
        overrides = all[getUrlKey()] || {};
        resolve();
      });
    });
  }

  function loadHeatmapPointOverrides() {
    return new Promise(resolve => {
      chrome.storage.local.get('csZoningHeatmapPoints', result => {
        const all = result.csZoningHeatmapPoints || {};
        const raw = all[getUrlKey()] || {};
        const normalized = {};
        Object.entries(raw).forEach(([key, point]) => {
          const nextPoint = normalizeHeatmapPointRecord(point);
          if (!nextPoint) return;
          normalized[key] = nextPoint;
        });
        heatmapPointOverrides = normalized;
        resolve();
      });
    });
  }

  function loadGlobalEditMode() {
    return new Promise(resolve => {
      chrome.storage.local.get('csZoningEditMode', result => {
        editMode = !!result.csZoningEditMode;
        log('Loaded global edit mode:', editMode);
        resolve();
      });
    });
  }

  function loadUiVisibility() {
    return new Promise(resolve => {
      chrome.storage.local.get('csZoningUiVisible', result => {
        uiVisible = result.csZoningUiVisible !== false;
        log('Loaded UI visibility:', uiVisible);
        resolve();
      });
    });
  }

  function persistOverrides() {
    return new Promise(resolve => {
      chrome.storage.local.get('csZoningOverrides', result => {
        const all = result.csZoningOverrides || {};
        all[getUrlKey()] = overrides;
        chrome.storage.local.set({ csZoningOverrides: all }, resolve);
      });
    });
  }

  function persistHeatmapPointOverrides() {
    return new Promise(resolve => {
      chrome.storage.local.get('csZoningHeatmapPoints', result => {
        const all = result.csZoningHeatmapPoints || {};
        all[getUrlKey()] = heatmapPointOverrides;
        chrome.storage.local.set({ csZoningHeatmapPoints: all }, resolve);
      });
    });
  }

  // Merge-only persistence used by cross-frame bulk operations so one frame
  // does not clobber overrides produced by another frame in the same tick.
  function persistOverridesMerged() {
    return new Promise(resolve => {
      chrome.storage.local.get('csZoningOverrides', result => {
        const all = result.csZoningOverrides || {};
        const current = all[getUrlKey()] || {};
        const merged = { ...current, ...overrides };
        all[getUrlKey()] = merged;
        overrides = merged;
        chrome.storage.local.set({ csZoningOverrides: all }, resolve);
      });
    });
  }

  function closeScenariosPanel() {
    const panel = document.getElementById('cs-demo-scenarios-host');
    if (panel) panel.remove();
  }

  function closeExposurePanel() {
    const panel = document.getElementById('cs-demo-exposure-host');
    if (panel) panel.remove();
  }

  function showHeatmapEditHint(message) {
    if (!isTopFrame) return;
    if (heatmapHintTimer) {
      clearTimeout(heatmapHintTimer);
      heatmapHintTimer = null;
    }
    if (!heatmapHintHost) {
      heatmapHintHost = document.createElement('div');
      heatmapHintHost.id = 'cs-demo-heatmap-hint';
      heatmapHintHost.style.position = 'fixed';
      heatmapHintHost.style.right = '20px';
      heatmapHintHost.style.bottom = '20px';
      heatmapHintHost.style.zIndex = '2147483647';
      heatmapHintHost.style.maxWidth = '360px';
      heatmapHintHost.style.background = 'rgba(18, 20, 40, 0.96)';
      heatmapHintHost.style.color = '#fff';
      heatmapHintHost.style.border = '1px solid rgba(255,255,255,0.18)';
      heatmapHintHost.style.borderRadius = '10px';
      heatmapHintHost.style.padding = '10px 12px';
      heatmapHintHost.style.boxShadow = '0 8px 24px rgba(0,0,0,0.35)';
      heatmapHintHost.style.fontFamily = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif";
      heatmapHintHost.style.fontSize = '12px';
      heatmapHintHost.style.lineHeight = '1.35';
      heatmapHintHost.style.pointerEvents = 'none';
      document.body.appendChild(heatmapHintHost);
    }
    heatmapHintHost.textContent = message;
    heatmapHintHost.style.display = 'block';
    heatmapHintTimer = setTimeout(() => {
      if (heatmapHintHost) heatmapHintHost.style.display = 'none';
      heatmapHintTimer = null;
    }, 2600);
  }

  function applyUiVisibility() {
    if (!isTopFrame) return;
    if (toolbarHost) {
      toolbarHost.style.display = uiVisible ? 'block' : 'none';
    }
    if (!uiVisible) {
      closePopover();
      closeScenariosPanel();
      closeExposurePanel();
    }
  }

  function setUiVisible(visible, syncGlobal = true) {
    const next = !!visible;
    if (uiVisible === next) return;
    uiVisible = next;
    log('UI visibility changed:', uiVisible, 'syncGlobal=', syncGlobal);
    applyUiVisibility();
    syncPageWorldState();
    if (syncGlobal) {
      chrome.storage.local.set({ csZoningUiVisible: uiVisible });
      if (isTopFrame) {
        chrome.runtime.sendMessage({
          type: 'broadcastToTab',
          payload: { type: 'setUiVisibleFrame', visible: uiVisible }
        }, () => {
          void chrome.runtime.lastError;
        });
      }
    }
  }

  // ─── ZONE COLOR HELPERS ──────────────────────────────────────────────────

  // Mirrors CS's exact color formula from zone-elements.js
  function csHslaColor(value, limitMin, limitMax) {
    if (isNaN(value)) return 'rgba(215, 218, 224, 0.5)';
    let s = (value - limitMin) / (limitMax - limitMin || 1);
    s = Math.min(Math.max(0, s), 1);
    return `hsla(${(1 - s) * 220}, 100%, 50%, 0.5)`;
  }

  function parseNumericMetric(rawValue) {
    if (rawValue === null || rawValue === undefined) return NaN;
    if (typeof rawValue === 'number') return rawValue;
    const cleaned = String(rawValue).replace(/,/g, '.').replace(/[^\d.-]/g, '');
    return cleaned ? Number(cleaned) : NaN;
  }

  // Finds zoning elements across document, open shadow roots, and same-origin iframes.
  function collectZoneElementsFromRoot(root, out) {
    if (!root) return;

    if (root.nodeType === 1 && root.tagName && CS_ZONE_SELECTORS.includes(root.tagName.toLowerCase())) {
      out.push(root);
    }

    if (!root.querySelectorAll) return;

    root.querySelectorAll(CS_ZONE_SELECTORS).forEach(el => out.push(el));

    root.querySelectorAll('*').forEach(el => {
      if (el.shadowRoot) {
        collectZoneElementsFromRoot(el.shadowRoot, out);
      }

      const tag = el.tagName ? el.tagName.toLowerCase() : '';
      if (tag === 'iframe' || tag === 'frame') {
        try {
          if (el.contentDocument) collectZoneElementsFromRoot(el.contentDocument, out);
        } catch (_) {
          // Cross-origin frame, ignore.
        }
      }
    });
  }

  function getAllZoneElements() {
    const list = [];
    collectZoneElementsFromRoot(document, list);
    return Array.from(new Set(list)).filter(el => !!el && el.isConnected);
  }

  function getCandidateZoneElements() {
    const seen = new Set(getAllZoneElements());
    zoneObservers.forEach(entry => {
      const el = entry?.element;
      if (el && el.isConnected) seen.add(el);
    });
    return Array.from(seen).filter(el => !!el && el.isConnected);
  }

  // Collects any tag across document, open shadow roots, and same-origin iframes.
  function collectElementsByTagFromRoot(root, tagName, out) {
    if (!root || !tagName) return;
    const wanted = String(tagName).toLowerCase();

    if (root.nodeType === 1 && root.tagName && root.tagName.toLowerCase() === wanted) {
      out.push(root);
    }

    if (!root.querySelectorAll) return;

    root.querySelectorAll(wanted).forEach(el => out.push(el));

    root.querySelectorAll('*').forEach(el => {
      if (el.shadowRoot) {
        collectElementsByTagFromRoot(el.shadowRoot, wanted, out);
      }

      const tag = el.tagName ? el.tagName.toLowerCase() : '';
      if (tag === 'iframe' || tag === 'frame') {
        try {
          if (el.contentDocument) collectElementsByTagFromRoot(el.contentDocument, wanted, out);
        } catch (_) {
          // Cross-origin frame, ignore.
        }
      }
    });
  }

  function getAllElementsByTag(tagName) {
    const list = [];
    collectElementsByTagFromRoot(document, tagName, list);
    return Array.from(new Set(list));
  }

  function collectElementsBySelectorFromRoot(root, selector, out) {
    if (!root || !selector) return;
    if (!root.querySelectorAll) return;

    root.querySelectorAll(selector).forEach(el => out.push(el));

    root.querySelectorAll('*').forEach(el => {
      if (el.shadowRoot) {
        collectElementsBySelectorFromRoot(el.shadowRoot, selector, out);
      }

      const tag = el.tagName ? el.tagName.toLowerCase() : '';
      if (tag === 'iframe' || tag === 'frame') {
        try {
          if (el.contentDocument) collectElementsBySelectorFromRoot(el.contentDocument, selector, out);
        } catch (_) {
          // Cross-origin frame, ignore.
        }
      }
    });
  }

  function getAllElementsBySelector(selector) {
    const list = [];
    collectElementsBySelectorFromRoot(document, selector, list);
    return Array.from(new Set(list)).filter(el => !!el && el.isConnected);
  }

  function closestAcrossShadow(startEl, selector) {
    let node = startEl;

    while (node) {
      if (node.nodeType === 1 && node.matches && node.matches(selector)) {
        return node;
      }

      if (node.parentElement) {
        node = node.parentElement;
        continue;
      }

      const root = node.getRootNode ? node.getRootNode() : null;
      if (root && root.host) {
        node = root.host;
        continue;
      }

      break;
    }

    return null;
  }

  function isLikelyZoningRoute() {
    const hash = location.hash || '';
    return hash.includes('/analyze/zoning-v2/') || hash.includes('/analyze/zoning/');
  }

  function getAnalysisModeCandidates() {
    const candidates = [];
    const selectors = ['button', '[role="tab"]', '[role="button"]', 'a'];
    selectors.forEach(selector => {
      getAllElementsBySelector(selector).forEach(el => {
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
        if (text === 'heatmap' || text === 'zoning') {
          candidates.push(el);
        }
      });
    });
    return Array.from(new Set(candidates));
  }

  function isModeElementActive(el) {
    if (!el) return false;
    const ariaPressed = (el.getAttribute('aria-pressed') || '').toLowerCase();
    const ariaSelected = (el.getAttribute('aria-selected') || '').toLowerCase();
    const className = String(el.className || '').toLowerCase();
    if (ariaPressed === 'true' || ariaSelected === 'true') return true;
    if (/(active|selected|current|checked)/.test(className)) return true;

    try {
      const style = window.getComputedStyle(el);
      const borderColor = `${style.borderTopColor} ${style.borderRightColor} ${style.borderBottomColor} ${style.borderLeftColor}`.toLowerCase();
      if (borderColor.includes('99, 93, 220') || borderColor.includes('5959dc')) return true;
    } catch (_) {
      // Ignore style inspection failures.
    }

    return false;
  }

  function getActiveAnalysisMode() {
    const candidates = getAnalysisModeCandidates();
    const heatmapEl = candidates.find(el => (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase() === 'heatmap') || null;
    const zoningEl = candidates.find(el => (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase() === 'zoning') || null;

    // Prefer explicit UI tab state whenever available.
    if (zoningEl && isModeElementActive(zoningEl)) return 'zoning';
    if (heatmapEl && isModeElementActive(heatmapEl)) return 'heatmap';

    // Heatmap layer buttons (clicks/moves/scrolls/attention) are a stronger signal
    // than zone element presence — check them before counting zones.
    const layerNames = ['clicks', 'moves', 'scrolls', 'attention'];
    const visibleLabels = getAllElementsBySelector('button, [role="tab"], [role="button"]')
      .map(el => (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase())
      .filter(Boolean);
    if (layerNames.every(name => visibleLabels.includes(name))) return 'heatmap';

    // Fallback: if zone elements are present and no explicit tab state is available,
    // treat as zoning.
    const zones = getAllZoneElements();
    if (zones.length > 0) return 'zoning';

    if (isLikelyZoningRoute()) return 'zoning';
    return 'unknown';
  }

  function getAllHeatmapSurfaceElements() {
    const byTag = getAllElementsByTag('app-heatmap-scroll-element');
    const byHj = getAllElementsByTag('hj-heatmaps-report');
    const byClass = Array.from(document.querySelectorAll('[class*="heatmap"], [data-testid*="heatmap"]'));
    return Array.from(new Set([...byTag, ...byHj, ...byClass])).filter(el => !!el && el.isConnected);
  }

  function getPrimaryHeatmapSurfaceElements() {
    const native = getAllElementsByTag('app-heatmap-scroll-element').filter(el => !!el && el.isConnected);
    if (native.length) return native;
    return getAllElementsByTag('hj-heatmaps-report').filter(el => !!el && el.isConnected);
  }

  function getHeatmapLayerLabelFromNode(node) {
    if (!(node instanceof Element)) return '';
    const isLayerControl = !!(node.matches && node.matches('button, [role="tab"], [role="button"]'));
    if (!isLayerControl) return '';
    return layerKeyFromText(node.textContent);
  }

  function rememberHeatmapLayerFromEvent(event) {
    if (!event) return;
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
    for (const node of path) {
      const label = getHeatmapLayerLabelFromNode(node);
      if (!label) continue;
      // Avoid accidental updates from unrelated "Clicks/Moves" labels outside heatmap controls.
      const inHeatmapContext = getActiveAnalysisMode() === 'heatmap' || isLikelyHeatmapView();
      if (inHeatmapContext) {
        lastKnownHeatmapLayer = label;
      }
      return;
    }
  }

  // Extract the canonical layer key from raw button textContent.
  // Uses first whitespace-delimited token so "clicks 4,521" resolves to "clicks".
  function layerKeyFromText(raw) {
    const first = String(raw || '').replace(/\s+/g, ' ').trim().toLowerCase().split(' ')[0];
    return HEATMAP_LAYER_KEYS.includes(first) ? first : '';
  }

  function getActiveHeatmapLayerName() {
    // Page-bridge can read inside page-world/shadow DOM reliably. When it captured
    // a recent layer tab interaction, prefer that value before DOM heuristics.
    if (HEATMAP_LAYER_KEYS.includes(lastKnownHeatmapLayer)) {
      return lastKnownHeatmapLayer;
    }

    const candidates = getAllElementsBySelector('button, [role="tab"], [role="button"]');
    const active = candidates.find(el => {
      return layerKeyFromText(el.textContent) && isModeElementActive(el);
    });
    const label = layerKeyFromText(active?.textContent);
    if (label) {
      lastKnownHeatmapLayer = label;
      return label;
    }

    const visibleLabels = candidates
      .map(el => {
        const key = layerKeyFromText(el.textContent);
        if (!key) return '';
        try {
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') return '';
        } catch (_) {
          // Ignore style resolution failures.
        }
        return key;
      })
      .filter(Boolean);

    if (visibleLabels.includes(lastKnownHeatmapLayer)) {
      return lastKnownHeatmapLayer;
    }

    return visibleLabels[0] || 'clicks';
  }

  function isHeatmapEditingContext() {
    // Respect explicit CS mode first.
    const analysisMode = getActiveAnalysisMode();
    if (analysisMode === 'heatmap') return true;

    // Never treat zoning routes as heatmap-editable fallbacks.
    if (isLikelyZoningRoute()) return false;

    // If zoning elements are present, default to zoning semantics.
    if (getAllZoneElements().length > 0) return false;

    // Fallback for pages where mode controls are the only signal.
    return isLikelyHeatmapView();
  }

  function isLikelyZoningInteractionContext(eventPath = []) {
    const analysisMode = getActiveAnalysisMode();
    // Do not classify generic wrappers as zoning when CS is explicitly in heatmap mode
    // and no editable zone elements are present.
    if (analysisMode === 'heatmap' && getCandidateZoneElements().length === 0) return false;

    if (isLikelyZoningRoute()) return true;

    // If we can already see zone nodes (or tracked replacements), always
    // treat this frame as zoning context.
    if (getCandidateZoneElements().length > 0) return true;

    // Prefer explicit CS mode signal when present.
    if (analysisMode === 'zoning') return true;

    const path = Array.isArray(eventPath) ? eventPath : [];
    for (const node of path) {
      if (!(node instanceof Element)) continue;
      const tag = (node.tagName || '').toLowerCase();
      if (tag === 'app-zone-elements' || tag === 'app-zone-element') {
        return true;
      }
      const classText = String(node.className || '').toLowerCase();
      if (classText.includes('zoning') || classText.includes('zone')) return true;
      if (node.closest && node.closest('app-zone-elements, app-zone-element')) return true;
    }

    return false;
  }

  function isLikelyHeatmapView() {
    if (getActiveAnalysisMode() === 'heatmap') return true;

    const known = ['clicks', 'moves', 'scrolls', 'attention'];
    const labels = getAllElementsBySelector('button, [role="tab"], [role="button"]')
      .map(el => (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase())
      .filter(Boolean);

    // Heatmap view consistently exposes the four layer selectors.
    return known.every(name => labels.includes(name));
  }

  function getHeatmapSurfaceKey(surfaceEl) {
    if (!surfaceEl) return 'heatmap:unknown';
    const fullpath = surfaceEl.getAttribute?.('fullpath') || '';
    if (fullpath) return `heatmap:${fullpath}`;

    const byTagIndex = getPrimaryHeatmapSurfaceElements().indexOf(surfaceEl);
    if (byTagIndex >= 0) return `heatmap:scroll:${byTagIndex}`;

    const dataTestId = surfaceEl.getAttribute?.('data-testid') || '';
    if (dataTestId) return `heatmap:testid:${dataTestId}`;

    const domPath = [];
    let node = surfaceEl;
    let depth = 0;
    while (node && depth < 6) {
      if (node.nodeType !== 1) break;
      const tag = (node.tagName || 'node').toLowerCase();
      const parent = node.parentElement;
      let pos = 1;
      if (parent) {
        const sameTagSiblings = Array.from(parent.children).filter(child => (child.tagName || '').toLowerCase() === tag);
        const idx = sameTagSiblings.indexOf(node);
        pos = idx >= 0 ? idx + 1 : 1;
      }
      domPath.push(`${tag}:${pos}`);
      node = parent;
      depth += 1;
    }

    if (domPath.length) return `heatmap:path:${domPath.reverse().join('>')}`;
    return 'heatmap:unknown';
  }

  function getParentAcrossShadow(node) {
    if (!node) return null;
    if (node.parentElement) return node.parentElement;
    const root = node.getRootNode ? node.getRootNode() : null;
    return root && root.host ? root.host : null;
  }

  function isScrollableElement(el) {
    if (!(el instanceof Element)) return false;
    const canScrollVertically = (el.scrollHeight - el.clientHeight) > 1;
    const canScrollHorizontally = (el.scrollWidth - el.clientWidth) > 1;
    if (!canScrollVertically && !canScrollHorizontally) return false;

    const classText = String(el.className || '').toLowerCase();
    if (/(^|\s)(scroll|scrollable)(\s|$)/.test(classText) || classText.includes('overflow')) {
      return true;
    }

    try {
      const style = window.getComputedStyle(el);
      const overflowY = String(style.overflowY || '').toLowerCase();
      const overflowX = String(style.overflowX || '').toLowerCase();
      const allowsY = /(auto|scroll|overlay)/.test(overflowY);
      const allowsX = /(auto|scroll|overlay)/.test(overflowX);
      return allowsY || allowsX;
    } catch (_) {
      return true;
    }
  }

  function buildAnchorPathFromDocument(anchorEl) {
    if (!anchorEl || !(anchorEl instanceof Element)) return '';
    const path = [];
    let node = anchorEl;
    let guard = 0;
    while (node && node !== document.documentElement && guard < 64) {
      const parent = node.parentElement;
      if (!parent) return '';
      const idx = Array.from(parent.children).indexOf(node);
      if (idx < 0) return '';
      path.push(idx);
      node = parent;
      guard += 1;
    }
    if (node !== document.documentElement) return '';
    return path.reverse().join('.');
  }

  function resolveAnchorPathFromDocument(pathRaw) {
    if (!pathRaw) return null;
    const parts = String(pathRaw).split('.').map(v => Number(v)).filter(Number.isInteger);
    let node = document.documentElement;
    for (const idx of parts) {
      if (!node || !node.children || idx < 0 || idx >= node.children.length) {
        return null;
      }
      node = node.children[idx];
    }
    return node && node.isConnected ? node : null;
  }

  function getLikelyPrimaryScrollContainer() {
    if (heatmapPrimaryScrollContainer
      && heatmapPrimaryScrollContainer.isConnected
      && isScrollableElement(heatmapPrimaryScrollContainer)) {
      return heatmapPrimaryScrollContainer;
    }

    const seen = new Set();
    const candidates = [];
    const pushCandidate = el => {
      if (!el || !(el instanceof Element) || seen.has(el)) return;
      seen.add(el);
      candidates.push(el);
    };

    pushCandidate(document.scrollingElement);
    pushCandidate(document.documentElement);
    pushCandidate(document.body);
    getAllElementsBySelector('[data-cs-qa-id="heatmap-report-container"], [data-qa-id="heatmap-report-container"], [id*="layers-container"], [class*="layers-container"]').forEach(root => {
      pushCandidate(root);
      if (root && root.querySelectorAll) {
        root.querySelectorAll('*').forEach(pushCandidate);
      }
    });
    getPrimaryHeatmapSurfaceElements().forEach(pushCandidate);
    getAllHeatmapSurfaceElements().forEach(pushCandidate);
    document.querySelectorAll('main, [role="main"], [class*="scroll"], [data-testid*="scroll"]').forEach(pushCandidate);

    let best = null;
    let bestScore = -1;
    candidates.forEach(el => {
      if (!isScrollableElement(el)) return;
      const clientW = Number(el.clientWidth || 0);
      const clientH = Number(el.clientHeight || 0);
      const scrollW = Number(el.scrollWidth || 0);
      const scrollH = Number(el.scrollHeight || 0);
      const scrollTop = Number(el.scrollTop || 0);
      const scrollLeft = Number(el.scrollLeft || 0);
      const depthPenalty = (() => {
        let depth = 0;
        let node = el;
        while (node && node.parentElement && depth < 20) {
          depth += 1;
          node = node.parentElement;
        }
        return depth;
      })();
      const score = (clientW * clientH)
        + Math.max(0, scrollH - clientH)
        + Math.max(0, scrollW - clientW)
        + ((scrollTop > 0 || scrollLeft > 0) ? 50000 : 0)
        - depthPenalty * 5;
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    });

    heatmapPrimaryScrollContainer = best;
    return best;
  }

  function getHeatmapReportContainerCandidates() {
    const seen = new Set();
    const out = [];
    const push = el => {
      if (!el || !(el instanceof Element) || seen.has(el)) return;
      seen.add(el);
      out.push(el);
    };

    getAllElementsBySelector('[data-cs-qa-id="heatmap-report-container"], [data-qa-id="heatmap-report-container"], [id*="layers-container"], [class*="layers-container"]').forEach(root => {
      push(root);
      if (root.querySelectorAll) {
        root.querySelectorAll('[id*="layers-container"], [class*="layers-container"], [class*="scroll"], [data-testid*="scroll"], [data-cs-qa-id*="heatmap"], [data-qa-id*="heatmap"], canvas, div').forEach(push);
      }
    });
    return out;
  }

  function getBestViewportFallbackContainer() {
    const candidates = getHeatmapReportContainerCandidates();
    if (!candidates.length) return null;

    let best = null;
    let bestScore = -1;
    candidates.forEach(el => {
      const clientW = Number(el.clientWidth || 0);
      const clientH = Number(el.clientHeight || 0);
      if (clientW <= 0 || clientH <= 0) return;
      const scrollW = Number(el.scrollWidth || 0);
      const scrollH = Number(el.scrollHeight || 0);
      const scrollTop = Number(el.scrollTop || 0);
      const classText = String(el.className || '').toLowerCase();
      const idText = String(el.id || '').toLowerCase();
      const hasLayersHint = idText.includes('layers') || classText.includes('layers');
      const hasScrollHint = classText.includes('scroll') || isScrollableElement(el);
      let hasTransform = false;
      try {
        hasTransform = window.getComputedStyle(el).transform !== 'none';
      } catch (_) {}

      const score = (clientW * clientH)
        + Math.max(0, scrollH - clientH) * 3
        + Math.max(0, scrollW - clientW)
        + (scrollTop > 0 ? 80000 : 0)
        + (hasLayersHint ? 60000 : 0)
        + (hasScrollHint ? 45000 : 0)
        + (hasTransform ? 12000 : 0);

      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    });

    return best;
  }

  function resolveScrollableFromNode(node) {
    let current = node;
    let guard = 0;
    while (current && guard < 40) {
      if (current instanceof Element && isScrollableElement(current)) {
        return current;
      }
      current = getParentAcrossShadow(current);
      guard += 1;
    }
    return null;
  }

  function recordHeatmapPrimaryScrollContainer(container) {
    if (!container || !(container instanceof Element)) return;
    if (!isScrollableElement(container)) return;
    if (heatmapPrimaryScrollContainer === container) return;
    heatmapPrimaryScrollContainer = container;
    scheduleHeatmapOverlayRender();
  }

  function handleHeatmapScrollSignal(event) {
    const target = event?.target;
    const fromTarget = resolveScrollableFromNode(target);
    if (fromTarget) {
      recordHeatmapPrimaryScrollContainer(fromTarget);
      heatmapFollowUntil = Math.max(heatmapFollowUntil, performance.now() + 450);
      scheduleHeatmapOverlayRender();
      return;
    }

    if (typeof event?.composedPath === 'function') {
      const path = event.composedPath();
      for (const node of path) {
        const found = resolveScrollableFromNode(node);
        if (found) {
          recordHeatmapPrimaryScrollContainer(found);
          heatmapFollowUntil = Math.max(heatmapFollowUntil, performance.now() + 450);
          scheduleHeatmapOverlayRender();
          return;
        }
      }
    }

    heatmapFollowUntil = Math.max(heatmapFollowUntil, performance.now() + 450);
    scheduleHeatmapOverlayRender();
  }

  function ensureHeatmapAnchorKey(el) {
    if (!el || !(el instanceof Element)) return '';
    const existing = el.getAttribute('data-cs-demo-anchor-key');
    if (existing) {
      heatmapAnchorElements.set(existing, el);
      return existing;
    }
    const key = `ha:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
    el.setAttribute('data-cs-demo-anchor-key', key);
    heatmapAnchorElements.set(key, el);
    return key;
  }

  function getHeatmapAnchorElementAtPoint(clientX, clientY, surfaceEl = null) {
    const pointEl = document.elementFromPoint(clientX, clientY);
    let node = pointEl;
    let guard = 0;
    while (node && guard < 40) {
      if (isScrollableElement(node)) return node;
      if (surfaceEl && node === surfaceEl) break;
      node = getParentAcrossShadow(node);
      guard += 1;
    }
    return surfaceEl || null;
  }

  function getHeatmapTrackingElementAtPoint(clientX, clientY, surfaceEl = null, eventPath = []) {
    const path = Array.isArray(eventPath) ? eventPath : [];
    for (const node of path) {
      if (!(node instanceof Element) || !node.isConnected) continue;
      if (node === toolbarHost || node === popoverHost || node === heatmapOverlayHost) continue;
      const tag = (node.tagName || '').toLowerCase();
      if (tag === 'html' || tag === 'body') continue;
      return node;
    }

    const pointEl = document.elementFromPoint(clientX, clientY);
    if (pointEl instanceof Element && pointEl.isConnected) return pointEl;
    return surfaceEl || null;
  }

  function getHeatmapMotionContainerAtPoint(clientX, clientY, surfaceEl = null) {
    const selectors = [
      '[data-cs-qa-id="heatmap-report-container"]',
      '[data-qa-id="heatmap-report-container"]',
      '[id*="layers-container"]',
      '[class*="layers-container"]',
      '[class*="heatmap-layer"]',
      '[data-testid*="heatmap-layer"]'
    ].join(',');

    const pointEl = document.elementFromPoint(clientX, clientY);
    let node = pointEl;
    let guard = 0;
    while (node && guard < 48) {
      if (node instanceof Element && node.matches && node.matches(selectors)) return node;
      if (surfaceEl && node === surfaceEl) break;
      node = getParentAcrossShadow(node);
      guard += 1;
    }

    if (surfaceEl) {
      let cur = surfaceEl;
      let hops = 0;
      while (cur && hops < 32) {
        if (cur instanceof Element && cur.matches && cur.matches(selectors)) return cur;
        cur = getParentAcrossShadow(cur);
        hops += 1;
      }
    }

    return null;
  }

  function resolveHeatmapPointAnchorElement(point, fallbackSurface) {
    const key = String(point?.anchorKey || '');
    if (key) {
      const el = heatmapAnchorElements.get(key);
      if (el && el.isConnected) return el;
    }

    const pathRaw = String(point?.anchorPath || '');
    if (fallbackSurface && pathRaw) {
      const parts = pathRaw.split('.').map(v => Number(v)).filter(Number.isInteger);
      let node = fallbackSurface;
      for (const idx of parts) {
        if (!node || !node.children || idx < 0 || idx >= node.children.length) {
          node = null;
          break;
        }
        node = node.children[idx];
      }
      if (node && node.isConnected) return node;
    }

    const docPath = String(point?.anchorDocPath || '');
    if (docPath) {
      const resolved = resolveAnchorPathFromDocument(docPath);
      if (resolved) {
        const resolvedKey = ensureHeatmapAnchorKey(resolved);
        if (resolvedKey) point.anchorKey = resolvedKey;
        return resolved;
      }
    }

    return fallbackSurface || null;
  }

  function resolveHeatmapPointTrackingElement(point) {
    const key = String(point?.trackingKey || '');
    if (key) {
      const el = heatmapAnchorElements.get(key);
      if (el && el.isConnected) return el;
    }

    const docPath = String(point?.trackingDocPath || '');
    if (docPath) {
      const resolved = resolveAnchorPathFromDocument(docPath);
      if (resolved) {
        const resolvedKey = ensureHeatmapAnchorKey(resolved);
        if (resolvedKey) point.trackingKey = resolvedKey;
        return resolved;
      }
    }

    return null;
  }

  function getHeatmapViewportClipElement(surfaceEl, trackingEl = null) {
    const hintRegex = /(heatmap|layer|report|viewport|scroll|canvas|screenshot)/i;

    const isCandidate = node => {
      if (!(node instanceof Element) || !node.isConnected) return false;
      const tag = (node.tagName || '').toLowerCase();
      if (tag === 'html' || tag === 'body') return false;

      let style;
      try {
        style = window.getComputedStyle(node);
      } catch (_) {
        return false;
      }

      const overflowX = String(style.overflowX || '').toLowerCase();
      const overflowY = String(style.overflowY || '').toLowerCase();
      const clips = /(hidden|clip|auto|scroll|overlay)/.test(overflowX) || /(hidden|clip|auto|scroll|overlay)/.test(overflowY);
      if (!clips) return false;

      let rect;
      try {
        rect = node.getBoundingClientRect();
      } catch (_) {
        return false;
      }
      if (!rect || rect.width <= 0 || rect.height <= 0) return false;

      // Ignore broad app/root containers that won't provide useful clipping.
      if (rect.height > window.innerHeight * 0.96 && rect.width > window.innerWidth * 0.96) return false;

      const hintText = `${node.id || ''} ${typeof node.className === 'string' ? node.className : ''} ${node.getAttribute('data-testid') || ''}`;
      const hinted = hintRegex.test(hintText);
      const stronglyClipped = /(hidden|clip)/.test(overflowX) || /(hidden|clip)/.test(overflowY);
      return hinted || stronglyClipped;
    };

    const walkUp = start => {
      let node = start;
      let guard = 0;
      while (node && guard < 36) {
        if (isCandidate(node)) return node;
        node = getParentAcrossShadow(node);
        guard += 1;
      }
      return null;
    };

    return walkUp(trackingEl) || walkUp(surfaceEl) || null;
  }

  function buildAnchorPathWithinSurface(anchorEl, surfaceEl) {
    if (!anchorEl || !surfaceEl || anchorEl === surfaceEl) return '';
    const path = [];
    let node = anchorEl;
    let guard = 0;
    while (node && node !== surfaceEl && guard < 32) {
      const parent = node.parentElement;
      if (!parent) return '';
      const idx = Array.from(parent.children).indexOf(node);
      if (idx < 0) return '';
      path.push(idx);
      node = parent;
      guard += 1;
    }
    if (node !== surfaceEl) return '';
    return path.reverse().join('.');
  }

  function findHeatmapSurfaceAtPoint(clientX, clientY) {
    const pointEl = document.elementFromPoint(clientX, clientY);
    const pointSurface = pointEl ? closestAcrossShadow(pointEl, 'app-heatmap-scroll-element') : null;
    if (pointSurface) return pointSurface;
    const hjSurface = pointEl ? closestAcrossShadow(pointEl, 'hj-heatmaps-report') : null;
    if (hjSurface) return hjSurface;

    const primarySurfaces = getPrimaryHeatmapSurfaceElements();
    const primaryInside = primarySurfaces.filter(el => {
      try {
        const rect = el.getBoundingClientRect();
        return rect.width > 0
          && rect.height > 0
          && clientX >= rect.left
          && clientX <= rect.right
          && clientY >= rect.top
          && clientY <= rect.bottom;
      } catch (_) {
        return false;
      }
    });
    if (primaryInside[0]) return primaryInside[0];

    const surfaces = getAllHeatmapSurfaceElements();
    const inside = surfaces.filter(el => {
      try {
        const rect = el.getBoundingClientRect();
        return rect.width > 0
          && rect.height > 0
          && clientX >= rect.left
          && clientX <= rect.right
          && clientY >= rect.top
          && clientY <= rect.bottom;
      } catch (_) {
        return false;
      }
    });
    return (inside[0] || null);
  }

  function isPointInsideRect(clientX, clientY, rect) {
    if (!rect) return false;
    return rect.width > 0
      && rect.height > 0
      && clientX >= rect.left
      && clientX <= rect.right
      && clientY >= rect.top
      && clientY <= rect.bottom;
  }

  function getHeatmapInteractionSurfaceAtPoint(clientX, clientY, eventPath = []) {
    const path = Array.isArray(eventPath) ? eventPath : [];
    const pathSurface = path.find(node => {
      if (!(node instanceof Element)) return false;
      const tag = (node.tagName || '').toLowerCase();
      return tag === 'app-heatmap-scroll-element' || tag === 'hj-heatmaps-report';
    }) || null;

    return pathSurface || findHeatmapSurfaceAtPoint(clientX, clientY) || null;
  }

  function isWithinHeatmapInteractionBoundary(clientX, clientY, surfaceEl = null, eventPath = []) {
    const surface = surfaceEl || getHeatmapInteractionSurfaceAtPoint(clientX, clientY, eventPath);
    if (!surface) return false;

    const trackingEl = getHeatmapTrackingElementAtPoint(clientX, clientY, surface, eventPath);
    const clipEl = getHeatmapViewportClipElement(surface, trackingEl);
    const boundaryRect = (clipEl || surface).getBoundingClientRect();
    return isPointInsideRect(clientX, clientY, boundaryRect);
  }

  function makeHeatmapPointId() {
    return `pt:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
  }

  // Extracts the CSS 2D/3D translate components from an element's computed transform.
  function getCSSTranslate(el) {
    if (!el) return { x: 0, y: 0 };
    try {
      const t = window.getComputedStyle(el).transform;
      if (!t || t === 'none') return { x: 0, y: 0 };
      const m = new DOMMatrix(t);
      return { x: m.m41, y: m.m42 };
    } catch (_) {
      return { x: 0, y: 0 };
    }
  }

  // Finds the element CS uses for virtual scroll via CSS transform.
  // CS scrolls its heatmap viewer by applying transform: translateY() to an inner layer element,
  // not via scrollTop. We identify that element so we can track its translate delta.
  function findHeatmapScrollTransformElement(composedPathArr) {
    const path = Array.isArray(composedPathArr) ? composedPathArr : [];
    const boundarySels = [
      'app-heatmap-scroll-element',
      'hj-heatmaps-report',
      '[data-cs-qa-id="heatmap-report-container"]',
      '[data-qa-id="heatmap-report-container"]',
      '[id*="layers-container"]',
      '[class*="layers-container"]',
    ].join(',');

    const hasTransform = node => {
      if (!(node instanceof Element)) return false;
      try {
        const style = window.getComputedStyle(node);
        const t = style.transform;
        const wc = style.willChange || '';
        const tr = style.transition || '';
        return (t && t !== 'none') || wc.includes('transform') || tr.includes('transform');
      } catch (_) {
        return false;
      }
    };

    // Walk composedPath from innermost outward; return first element with a CSS transform,
    // stopping when we reach the outer heatmap container boundary.
    for (const node of path) {
      if (node === document.body || node === document.documentElement || node === document || node === window) break;
      if (!(node instanceof Element)) continue;
      if (hasTransform(node)) return node;
      if (node.matches && node.matches(boundarySels)) break;
    }

    // Scan children (including inside shadow roots) of known heatmap containers.
    const scanChildren = (root) => {
      for (const child of Array.from(root.children || [])) {
        if (hasTransform(child)) return child;
        for (const grand of Array.from(child.children || [])) {
          if (hasTransform(grand)) return grand;
        }
        if (child.shadowRoot) {
          const found = scanChildren(child.shadowRoot);
          if (found) return found;
        }
      }
      return null;
    };

    const containerCands = [
      ...getAllElementsBySelector('[id*="layers-container"],[class*="layers-container"]'),
      ...getPrimaryHeatmapSurfaceElements(),
      ...getAllElementsBySelector('[data-qa-id="heatmap-report-container"],[data-cs-qa-id="heatmap-report-container"]'),
    ];
    for (const container of containerCands) {
      const found = scanChildren(container.shadowRoot || container);
      if (found) return found;
    }
    return null;
  }

  function getHeatmapPointClientPosition(point, surfaceEl, rect, fallbackAnchorEl = null) {
    if (!point || !rect) return null;
    const anchorEl = resolveHeatmapPointAnchorElement(point, surfaceEl) || fallbackAnchorEl || null;
    const anchorContentX = Number(point.anchorContentX);
    const anchorContentY = Number(point.anchorContentY);
    const surfaceContentX = Number(point.surfaceContentX);
    const surfaceContentY = Number(point.surfaceContentY);
    const legacyContentX = Number(point.contentX);
    const legacyContentY = Number(point.contentY);

    const baseSurfaceX = Number.isFinite(surfaceContentX)
      ? surfaceContentX
      : (Number.isFinite(legacyContentX) ? legacyContentX : Number.NaN);
    const baseSurfaceY = Number.isFinite(surfaceContentY)
      ? surfaceContentY
      : (Number.isFinite(legacyContentY) ? legacyContentY : Number.NaN);

    if (surfaceEl && Number.isFinite(baseSurfaceX) && Number.isFinite(baseSurfaceY)) {
      let x = rect.left + (baseSurfaceX - Number(surfaceEl.scrollLeft || 0));
      let y = rect.top + (baseSurfaceY - Number(surfaceEl.scrollTop || 0));

      const anchorStartLeft = Number(point.anchorStartScrollLeft);
      const anchorStartTop = Number(point.anchorStartScrollTop);
      if (anchorEl && Number.isFinite(anchorStartLeft) && Number.isFinite(anchorStartTop)) {
        x += (anchorStartLeft - Number(anchorEl.scrollLeft || 0));
        y += (anchorStartTop - Number(anchorEl.scrollTop || 0));
      }

      return { x, y };
    }

    if (anchorEl) {
      const baseAnchorX = Number.isFinite(anchorContentX)
        ? anchorContentX
        : (Number.isFinite(legacyContentX) ? legacyContentX : Number.NaN);
      const baseAnchorY = Number.isFinite(anchorContentY)
        ? anchorContentY
        : (Number.isFinite(legacyContentY) ? legacyContentY : Number.NaN);

      if (Number.isFinite(baseAnchorX) && Number.isFinite(baseAnchorY)) {
        const anchorRect = anchorEl.getBoundingClientRect();
        return {
          x: anchorRect.left + (baseAnchorX - Number(anchorEl.scrollLeft || 0)),
          y: anchorRect.top + (baseAnchorY - Number(anchorEl.scrollTop || 0))
        };
      }
    }

    const pageX = Number(point.pageX);
    const pageY = Number(point.pageY);
    if (Number.isFinite(pageX) && Number.isFinite(pageY)) {
      return {
        x: pageX - Number(window.scrollX || 0),
        y: pageY - Number(window.scrollY || 0)
      };
    }

    return {
      x: rect.left + Number(point.xPct || 0) * rect.width,
      y: rect.top + Number(point.yPct || 0) * rect.height
    };
  }

  function findNearestHeatmapPoint(surfaceEl, clientX, clientY, layer) {
    if (!surfaceEl) return null;
    const rect = surfaceEl.getBoundingClientRect();
    let best = null;

    Object.entries(heatmapPointOverrides).forEach(([key, point]) => {
      if (!point || point.surfaceKey !== getHeatmapSurfaceKey(surfaceEl) || point.layer !== layer) return;
      const pos = getHeatmapPointClientPosition(point, surfaceEl, rect);
      if (!pos) return;
      const px = pos.x;
      const py = pos.y;
      const distance = Math.hypot(px - clientX, py - clientY);
      if (!best || distance < best.distance) {
        best = { key, point, distance };
      }
    });

    return best && best.distance <= 28 ? best : null;
  }

  function buildHeatmapPointEditorState(clientX, clientY, surfaceEl = null, anchorHintEl = null, eventPath = []) {
    const transformEl = findHeatmapScrollTransformElement(eventPath);
    const transformTranslate = getCSSTranslate(transformEl);
    const hintedAnchor = (anchorHintEl && anchorHintEl.isConnected) ? anchorHintEl : null;
    const motionContainer = hintedAnchor || getHeatmapMotionContainerAtPoint(clientX, clientY, surfaceEl || null);
    const surface = surfaceEl
      || findHeatmapSurfaceAtPoint(clientX, clientY)
      || motionContainer
      || null;

    if (isLikelyHeatmapView() && !surface && !motionContainer) {
      return null;
    }

    const anchor = motionContainer || getHeatmapAnchorElementAtPoint(clientX, clientY, surface);
    const trackingEl = getHeatmapTrackingElementAtPoint(clientX, clientY, surface || motionContainer, eventPath);
    const anchorRect = anchor
      ? anchor.getBoundingClientRect()
      : {
          left: 0,
          top: 0,
          right: window.innerWidth,
          bottom: window.innerHeight,
          width: window.innerWidth,
          height: window.innerHeight
        };
    const trackingRect = trackingEl ? trackingEl.getBoundingClientRect() : null;
    const rect = surface
      ? surface.getBoundingClientRect()
      : {
          left: 0,
          top: 0,
          right: window.innerWidth,
          bottom: window.innerHeight,
          width: window.innerWidth,
          height: window.innerHeight
        };
    if (!rect.width || !rect.height) return null;

    const layer = normalizeHeatmapLayerName(getActiveHeatmapLayerName());
    const surfaceKey = surface ? getHeatmapSurfaceKey(surface) : 'heatmap:unknown';
    const existing = surface ? findNearestHeatmapPoint(surface, clientX, clientY, layer) : null;
    const surfaceScrollLeft = surface ? Number(surface.scrollLeft || 0) : 0;
    const surfaceScrollTop = surface ? Number(surface.scrollTop || 0) : 0;
    const anchorScrollLeft = anchor ? Number(anchor.scrollLeft || 0) : 0;
    const anchorScrollTop = anchor ? Number(anchor.scrollTop || 0) : 0;
    const surfaceContentX = existing && Number.isFinite(Number(existing.point.surfaceContentX))
      ? Number(existing.point.surfaceContentX)
      : (surface ? (surfaceScrollLeft + (clientX - rect.left)) : clientX);
    const surfaceContentY = existing && Number.isFinite(Number(existing.point.surfaceContentY))
      ? Number(existing.point.surfaceContentY)
      : (surface ? (surfaceScrollTop + (clientY - rect.top)) : clientY);
    const anchorContentX = existing && Number.isFinite(Number(existing.point.anchorContentX))
      ? Number(existing.point.anchorContentX)
      : (anchor ? (anchorScrollLeft + (clientX - anchorRect.left)) : surfaceContentX);
    const anchorContentY = existing && Number.isFinite(Number(existing.point.anchorContentY))
      ? Number(existing.point.anchorContentY)
      : (anchor ? (anchorScrollTop + (clientY - anchorRect.top)) : surfaceContentY);
    const contentX = existing && Number.isFinite(Number(existing.point.contentX))
      ? Number(existing.point.contentX)
      : surfaceContentX;
    const contentY = existing && Number.isFinite(Number(existing.point.contentY))
      ? Number(existing.point.contentY)
      : surfaceContentY;
    const xPct = existing
      ? Number(existing.point.xPct)
      : Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
    const yPct = existing
      ? Number(existing.point.yPct)
      : Math.min(Math.max((clientY - rect.top) / rect.height, 0), 1);
    const pageX = existing && Number.isFinite(Number(existing.point.pageX))
      ? Number(existing.point.pageX)
      : (window.scrollX + clientX);
    const pageY = existing && Number.isFinite(Number(existing.point.pageY))
      ? Number(existing.point.pageY)
      : (window.scrollY + clientY);
    const pointId = existing?.point?.pointId || makeHeatmapPointId();
    const zoneKey = existing?.key || `heatmap-point:${layer}:${surfaceKey}:${pointId}`;

    return {
      kind: 'heatmap-point',
      frameContextKey,
      zoneId: pointId,
      zoneKey,
      currentMetric: String(existing?.point?.metric || '50%'),
      currentValue: String(Number(existing?.point?.value ?? 50)),
      hasOverride: !!existing,
      limitMin: 0,
      limitMax: 100,
      zoneName: existing?.point?.zoneName || '',
      origMetric: existing?.point?.metric || '',
      csMetricTypeName: `${layer[0].toUpperCase()}${layer.slice(1)} Heatmap`,
      clickRect: { top: clientY, left: clientX, right: clientX, height: 1, width: 1 },
      heatmapPoint: {
        pointId,
        layer,
        xPct,
        yPct,
        surfaceKey,
        anchorKey: ensureHeatmapAnchorKey(anchor || surface),
        anchorPath: buildAnchorPathWithinSurface(anchor, surface),
        anchorDocPath: buildAnchorPathFromDocument(anchor || surface),
        anchorStartScrollLeft: anchorScrollLeft,
        anchorStartScrollTop: anchorScrollTop,
        anchorContentX,
        anchorContentY,
        surfaceContentX,
        surfaceContentY,
        contentX,
        contentY,
        pageX,
        pageY,
        trackingKey: String(existing?.point?.trackingKey || ensureHeatmapAnchorKey(trackingEl || anchor || surface)),
        trackingDocPath: String(existing?.point?.trackingDocPath || buildAnchorPathFromDocument(trackingEl || anchor || surface)),
        trackingOffsetX: (existing && Number.isFinite(Number(existing.point.trackingOffsetX)))
          ? Number(existing.point.trackingOffsetX)
          : (trackingRect ? (clientX - trackingRect.left) : undefined),
        trackingOffsetY: (existing && Number.isFinite(Number(existing.point.trackingOffsetY)))
          ? Number(existing.point.trackingOffsetY)
          : (trackingRect ? (clientY - trackingRect.top) : undefined),
        anchorTransformX: (existing && typeof existing.point.anchorTransformX !== 'undefined')
          ? Number(existing.point.anchorTransformX)
          : (!existing ? transformTranslate.x : undefined),
        anchorTransformY: (existing && typeof existing.point.anchorTransformY !== 'undefined')
          ? Number(existing.point.anchorTransformY)
          : (!existing ? transformTranslate.y : undefined),
        level: String(existing?.point?.level || inferHeatmapPointLevel(existing?.point || {})),
        centerColor: String(existing?.point?.centerColor || '#ee3a32')
      }
    };
  }

  function ensureHeatmapOverlayHost() {
    if (heatmapOverlayHost?.isConnected && heatmapOverlayShadow) return heatmapOverlayShadow;

    heatmapOverlayHost = document.createElement('div');
    heatmapOverlayHost.id = 'cs-demo-heatmap-overlay-host';
    heatmapOverlayHost.style.position = 'fixed';
    heatmapOverlayHost.style.left = '0';
    heatmapOverlayHost.style.top = '0';
    heatmapOverlayHost.style.width = '100vw';
    heatmapOverlayHost.style.height = '100vh';
    heatmapOverlayHost.style.pointerEvents = 'none';
    heatmapOverlayHost.style.zIndex = '2147483645';
    document.body.appendChild(heatmapOverlayHost);
    heatmapOverlayShadow = heatmapOverlayHost.attachShadow({ mode: 'open' });

    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`
      .marker {
        position: absolute;
        transform: translate(-50%, -50%);
        pointer-events: none;
      }
      .marker-glow {
        position: absolute;
        left: 0;
        top: 0;
        transform: translate(-50%, -50%);
        border-radius: 999px;
        pointer-events: none;
        mix-blend-mode: screen;
      }
    `);
    heatmapOverlayShadow.adoptedStyleSheets = [sheet];
    return heatmapOverlayShadow;
  }

  function ensureHeatmapSurfaceOverlay(surfaceEl) {
    const existing = heatmapSurfaceOverlays.get(surfaceEl);
    if (existing && existing._host && existing._host.isConnected) return existing;

    // Ensure the surface is a positioning context so markers placed with
    // position:absolute are relative to the surface's content origin.
    try {
      if (window.getComputedStyle(surfaceEl).position === 'static') {
        surfaceEl.style.position = 'relative';
      }
    } catch (_) { }

    const host = document.createElement('div');
    host.setAttribute('data-cs-demo-overlay', '');
    host.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;overflow:visible;pointer-events:none;z-index:2147483645;';
    surfaceEl.appendChild(host);

    const shadow = host.attachShadow({ mode: 'open' });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`
      .marker {
        position: absolute;
        transform: translate(-50%, -50%);
        pointer-events: none;
      }
      .marker-glow {
        position: absolute;
        left: 0;
        top: 0;
        transform: translate(-50%, -50%);
        border-radius: 999px;
        pointer-events: none;
        mix-blend-mode: screen;
      }
    `);
    shadow.adoptedStyleSheets = [sheet];
    shadow._host = host;
    heatmapSurfaceOverlays.set(surfaceEl, shadow);
    return shadow;
  }

  function getHeatmapLayerVisualProfile(layer) {
    const key = String(layer || 'clicks').toLowerCase();
    if (key === 'clicks') return { spreadMul: 1.28, blurMul: 1.08, alphaMul: 1.14, stretchY: 1.0 };
    if (key === 'moves') return { spreadMul: 0.72, blurMul: 0.45, alphaMul: 1.05, stretchY: 1.0 };
    if (key === 'scrolls') return { spreadMul: 1.42, blurMul: 1.2, alphaMul: 0.82, stretchY: 1.22 };
    if (key === 'attention') return { spreadMul: 1.55, blurMul: 1.3, alphaMul: 0.74, stretchY: 1.35 };
    return { spreadMul: 1.28, blurMul: 1.08, alphaMul: 1.14, stretchY: 1.0 };
  }

  function normalizeHeatmapLayerName(layerRaw, fallback = 'clicks') {
    const layer = String(layerRaw || '').trim().toLowerCase();
    if (HEATMAP_LAYER_KEYS.includes(layer)) return layer;
    return fallback;
  }

  function getHeatmapLayerLabel(layerRaw) {
    const layer = normalizeHeatmapLayerName(layerRaw);
    return layer.charAt(0).toUpperCase() + layer.slice(1);
  }

  function normalizeHeatmapPointRecord(pointRaw) {
    if (!pointRaw || typeof pointRaw !== 'object') return null;
    return {
      ...pointRaw,
      layer: normalizeHeatmapLayerName(pointRaw.layer),
      zoneName: String(pointRaw.zoneName || '').trim()
    };
  }

  function getHeatmapPointFallbackName(point) {
    const metric = String(point?.metric || '').trim();
    const layerLabel = getHeatmapLayerLabel(point?.layer);
    const x = Math.round(Number(point?.xPct || 0) * 100);
    const y = Math.round(Number(point?.yPct || 0) * 100);
    const base = metric || `${layerLabel} Point`;
    return `${base} (${x}%, ${y}%)`;
  }

  function getHeatmapPointDisplayName(point) {
    const layerLabel = getHeatmapLayerLabel(point?.layer);
    const customName = String(point?.zoneName || '').trim();
    const rightSide = customName || getHeatmapPointFallbackName(point);
    return `${layerLabel} -> ${rightSide}`;
  }

  function normalizeHeatmapPointLevel(rawLevel, fallback = 'medium') {
    const level = String(rawLevel || '').trim().toLowerCase();
    if (level === 'low' || level === 'medium' || level === 'high') return level;
    return fallback;
  }

  function getHeatmapPointLevelPreset(levelRaw, layerRaw = 'clicks') {
    const level = normalizeHeatmapPointLevel(levelRaw, 'medium');
    const layer = normalizeHeatmapLayerName(layerRaw);
    const isClicks = layer === 'clicks' || layer === 'moves';

    if (level === 'high') {
      return {
        level,
        label: 'High',
        metric: 'High Clicks',
        value: isClicks ? 98 : 85,
        centerColor: '#ee3a32'
      };
    }

    if (level === 'low') {
      return {
        level,
        label: 'Low',
        metric: 'Low Clicks',
        value: isClicks ? 28 : 40,
        centerColor: '#2668ff'
      };
    }

    return {
      level: 'medium',
      label: 'Medium',
      metric: 'Medium Clicks',
      value: isClicks ? 68 : 62,
      centerColor: '#ebdc3e'
    };
  }

  function inferHeatmapPointLevel(point) {
    const explicit = normalizeHeatmapPointLevel(point?.level || '', '');
    if (explicit) return explicit;

    const numeric = Number(point?.value);
    if (!Number.isFinite(numeric)) return 'medium';
    if (numeric >= 75) return 'high';
    if (numeric <= 45) return 'low';
    return 'medium';
  }

  function toHeatColor(normalized, alpha) {
    const n = Math.min(Math.max(normalized, 0), 1);
    // Approximate CS-style ramp: blue -> cyan -> green -> yellow -> orange -> red
    if (n < 0.18) return `rgba(38, 104, 255, ${alpha})`;
    if (n < 0.35) return `rgba(38, 182, 255, ${alpha})`;
    if (n < 0.56) return `rgba(52, 217, 95, ${alpha})`;
    if (n < 0.74) return `rgba(235, 220, 62, ${alpha})`;
    if (n < 0.88) return `rgba(248, 149, 44, ${alpha})`;
    return `rgba(238, 58, 50, ${alpha})`;
  }

  function hexToRgba(hex, alpha) {
    const value = String(hex || '').trim();
    const match = value.match(/^#?([0-9a-f]{6})$/i);
    if (!match) return `rgba(238, 58, 50, ${alpha})`;
    const raw = match[1];
    const r = Number.parseInt(raw.slice(0, 2), 16);
    const g = Number.parseInt(raw.slice(2, 4), 16);
    const b = Number.parseInt(raw.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function buildHeatmapMarkerVisual(point, bounds, layer) {
    const profile = getHeatmapLayerVisualProfile(layer);
    const layerKey = normalizeHeatmapLayerName(layer, 'clicks');
    const numeric = Number(point?.value);
    const min = Number(bounds?.min);
    const max = Number(bounds?.max);
    const floorMin = Number.isFinite(min) ? Math.max(0, min) : 0;
    const floorMax = Number.isFinite(max) ? Math.max(0, max) : 100;
    const logSpan = Math.log(floorMax + 1) - Math.log(floorMin + 1);
    const normalized = Number.isFinite(numeric)
      ? Math.min(
          Math.max(
            (Math.log(Math.max(0, numeric) + 1) - Math.log(floorMin + 1))
            / (logSpan > 0 ? logSpan : 1),
            0
          ),
          1
        )
      : 0.5;

    // Keep weaker points visible so newly-created points do not look undersized/faded.
    const field = Math.pow(0.32 + normalized * 0.68, 0.76);

    // Moves should share the same High/Medium/Low marker defaults as Clicks.
    const isClicksLayer = layerKey === 'clicks' || layerKey === 'moves';
    const levelPreset = getHeatmapPointLevelPreset(inferHeatmapPointLevel(point), layer);
    const level = levelPreset.level;

    // For Clicks layer, use constant field for sizing so all levels render at same diameter.
    // Only the gradient colors vary by level; size is always consistent.
    const fieldForSize = isClicksLayer ? 0.6 : field;

    const baseRadius = isClicksLayer
      ? (8 + fieldForSize * 8)
      : (9 + field * 10);
    const glowRadius = baseRadius * profile.spreadMul;
    const blur = (isClicksLayer ? (4 + fieldForSize * 6) : (2 + field * 4)) * profile.blurMul;
    const innerSize = isClicksLayer
      ? Math.max(3, 3.2 + fieldForSize * 3.2)
      : Math.max(3, glowRadius * 0.28);

    const outerAlpha = (isClicksLayer ? (0.34 + field * 0.28) : (0.11 + field * 0.22)) * profile.alphaMul;
    const innerAlpha = (isClicksLayer ? (0.74 + field * 0.22) : (0.16 + field * 0.36)) * profile.alphaMul;

    const centerColor = String(point?.centerColor || levelPreset.centerColor || '#ee3a32');
    const outerColor = isClicksLayer
      ? `rgba(38, 104, 255, ${Math.min(0.78, outerAlpha)})`
      : toHeatColor(field * 0.92, outerAlpha);
    const innerColor = isClicksLayer
      ? hexToRgba(centerColor, Math.min(0.98, innerAlpha))
      : toHeatColor(Math.min(1, field + 0.1), innerAlpha);

    if (isClicksLayer) {
      const coreColor = level === 'high' ? '#ee3a32' : (level === 'medium' ? '#ebdc3e' : '#7de8f4');
      const midColor  = level === 'high' ? '#ffc14a' : (level === 'medium' ? '#cfe96d' : '#54a8e0');
      const ringColor = '#5c8ebb';

      // Click markers render as opaque discs.
      const ringDiameter = Math.round((20 + fieldForSize * 10) * 1.05);
      const bullseyeDiameter = Math.max(2, Math.round((7 + fieldForSize * 3) * 0.6));

      return {
        glowW: ringDiameter,
        glowH: Math.round(ringDiameter * profile.stretchY),
        innerW: bullseyeDiameter,
        innerH: Math.round(bullseyeDiameter * profile.stretchY),
        blur: 0,
        innerBlur: 0,
        mixBlendMode: 'normal',
        outerBorder: 'none',
        outerGradient: `radial-gradient(circle at center, ${hexToRgba(coreColor, 1)} 0% 16%, ${hexToRgba(midColor, 1)} 44%, ${hexToRgba(ringColor, 1)} 88%, ${hexToRgba(ringColor, 1)} 100%)`,
        innerGradient: `radial-gradient(circle at center, ${hexToRgba(coreColor, 1)} 0%, ${hexToRgba(coreColor, 1)} 100%)`,
        outerColor,
        innerColor
      };
    }

    return {
      glowW: Math.round(glowRadius * 2),
      glowH: Math.round(glowRadius * 2 * profile.stretchY),
      innerW: Math.round(innerSize * 2),
      innerH: Math.round(innerSize * 2 * profile.stretchY),
      blur: Math.round(blur),
      mixBlendMode: 'normal',
      outerColor,
      innerColor
    };
  }

  function renderHeatmapPointOverlays() {
    // Clear per-surface overlays and remove any whose surface has been disconnected.
    heatmapSurfaceOverlays.forEach((shadow, surface) => {
      if (!surface.isConnected) {
        if (shadow._host?.isConnected) shadow._host.remove();
        heatmapSurfaceOverlays.delete(surface);
      } else {
        shadow.innerHTML = '';
      }
    });

    // Clear the global viewport overlay (used for heatmap:viewport points).
    const viewportShadow = ensureHeatmapOverlayHost();
    if (viewportShadow) viewportShadow.innerHTML = '';

    if (!uiVisible) return;

    // Do not display heatmap point overlays while the UI is in zoning context.
    // We still clear hosts above so stale markers disappear immediately on tab switch.
    const analysisMode = getActiveAnalysisMode();
    const heatmapEditingCtx = isHeatmapEditingContext();
    const heatmapView = isLikelyHeatmapView();
    const showHeatmapOverlays = analysisMode === 'heatmap'
      || heatmapEditingCtx
      || heatmapView;
    if (!showHeatmapOverlays) return;

    const activeLayer = normalizeHeatmapLayerName(getActiveHeatmapLayerName());
    const enforceStrictBounds = activeLayer === 'clicks';
    const layerPoints = Object.values(heatmapPointOverrides).filter(point => {
      if (!point || normalizeHeatmapLayerName(point.layer) !== activeLayer) return false;
      const pointFrame = String(point.frameContextKey || (isTopFrame ? 'top' : ''));
      if (!pointFrame) return false;
      if (pointFrame === frameContextKey) return true;
      // Backward compatibility for points created before frame scoping was persisted.
      return pointFrame === 'top' && isTopFrame;
    });

    const numericValues = layerPoints.map(point => Number(point?.value)).filter(Number.isFinite);
    const bounds = {
      min: numericValues.length ? Math.min(...numericValues) : 0,
      max: numericValues.length ? Math.max(...numericValues) : 100
    };

    // Render all points in viewport space using resolved motion anchors.
    // This avoids pinning when CS scroll is transform-driven rather than native scroll.
    const viewportEntries = [];
    // Detect the CSS transform scroll element for delta-based rendering.
    const heatmapTransformEl = findHeatmapScrollTransformElement([]);
    const heatmapTransformNow = getCSSTranslate(heatmapTransformEl);
    const surfaces = getAllHeatmapSurfaceElements();
    const fallbackScrollContainer = getLikelyPrimaryScrollContainer() || getBestViewportFallbackContainer();
    layerPoints.forEach(point => {
      const surface = point.surfaceKey && point.surfaceKey !== 'heatmap:viewport'
        ? (surfaces.find(el => getHeatmapSurfaceKey(el) === point.surfaceKey) || null)
        : null;
      const trackingElForClip = resolveHeatmapPointTrackingElement(point);
      const clipEl = getHeatmapViewportClipElement(surface, trackingElForClip);
      const clipRect = clipEl ? clipEl.getBoundingClientRect() : null;
      const surfaceRect = surface ? surface.getBoundingClientRect() : null;
      const isInsideSurfaceBounds = pos => {
        if (!surfaceRect) return true;
        return pos.x >= surfaceRect.left
          && pos.x <= surfaceRect.right
          && pos.y >= surfaceRect.top
          && pos.y <= surfaceRect.bottom;
      };
      const isInsideClipBounds = pos => {
        if (!clipRect) return true;
        return pos.x >= clipRect.left
          && pos.x <= clipRect.right
          && pos.y >= clipRect.top
          && pos.y <= clipRect.bottom;
      };
      const isRenderablePosition = pos => {
        if (!enforceStrictBounds) return true;
        return isInsideSurfaceBounds(pos) && isInsideClipBounds(pos);
      };

      const trackingEl = trackingElForClip;
      const trackingOffsetX = Number(point.trackingOffsetX);
      const trackingOffsetY = Number(point.trackingOffsetY);
      if (trackingEl && Number.isFinite(trackingOffsetX) && Number.isFinite(trackingOffsetY)) {
        const trackingRect = trackingEl.getBoundingClientRect();
        const pos = {
          x: trackingRect.left + trackingOffsetX,
          y: trackingRect.top + trackingOffsetY
        };
        if (!isRenderablePosition(pos)) return;
        viewportEntries.push({ point, pos });
        return;
      }

      // CSS transform delta method: most reliable for CS virtual-scroll.
      // When anchorTransformX/Y are present, resolve position as:
      //   markerPos = (pageX - scrollX) + (currentTranslate - creationTranslate)
      // This correctly tracks transform: translateY() scroll without needing scrollTop.
      if (typeof point.anchorTransformX !== 'undefined') {
        const dx = heatmapTransformNow.x - Number(point.anchorTransformX);
        const dy = heatmapTransformNow.y - Number(point.anchorTransformY);
        const px = Number(point.pageX) - Number(window.scrollX || 0);
        const py = Number(point.pageY) - Number(window.scrollY || 0);
        if (Number.isFinite(px) && Number.isFinite(py) && Number.isFinite(dx) && Number.isFinite(dy)) {
          const pos = { x: px + dx, y: py + dy };
          if (!isRenderablePosition(pos)) return;
          viewportEntries.push({ point, pos });
          return;
        }
      }
      let anchor = resolveHeatmapPointAnchorElement(point, surface);
      if (!anchor || !anchor.isConnected) {
        const baseClientX = Number.isFinite(Number(point.pageX))
          ? (Number(point.pageX) - Number(window.scrollX || 0))
          : (window.innerWidth * Number(point.xPct || 0));
        const baseClientY = Number.isFinite(Number(point.pageY))
          ? (Number(point.pageY) - Number(window.scrollY || 0))
          : (window.innerHeight * Number(point.yPct || 0));
        const pointMotionContainer = getHeatmapMotionContainerAtPoint(baseClientX, baseClientY, surface);
        const forcedContainer = (pointMotionContainer && pointMotionContainer.isConnected)
          ? pointMotionContainer
          : ((fallbackScrollContainer && fallbackScrollContainer.isConnected)
            ? fallbackScrollContainer
            : getBestViewportFallbackContainer());
        if (forcedContainer && forcedContainer.isConnected) {
          const forcedRect = forcedContainer.getBoundingClientRect();
          if (!Number.isFinite(Number(point.anchorContentX))) {
            point.anchorContentX = Number(forcedContainer.scrollLeft || 0) + (baseClientX - forcedRect.left);
          }
          if (!Number.isFinite(Number(point.anchorContentY))) {
            point.anchorContentY = Number(forcedContainer.scrollTop || 0) + (baseClientY - forcedRect.top);
          }
          if (!Number.isFinite(Number(point.anchorStartScrollLeft))) {
            point.anchorStartScrollLeft = Number(forcedContainer.scrollLeft || 0);
          }
          if (!Number.isFinite(Number(point.anchorStartScrollTop))) {
            point.anchorStartScrollTop = Number(forcedContainer.scrollTop || 0);
          }
          if (!point.anchorDocPath) {
            point.anchorDocPath = buildAnchorPathFromDocument(forcedContainer);
            point.anchorKey = ensureHeatmapAnchorKey(forcedContainer);
            heatmapNeedsPersist = true;
          }
          if ((point.surfaceKey || '') === 'heatmap:viewport') {
            point.surfaceKey = getHeatmapSurfaceKey(forcedContainer);
            heatmapNeedsPersist = true;
          }
          anchor = forcedContainer;
        } else {
          return;
        }
      }
      const rect = { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
      const pos = getHeatmapPointClientPosition(point, null, rect, anchor);
      if (!pos) return;
      if (!Number.isFinite(Number(pos.x)) || !Number.isFinite(Number(pos.y))) return;
      if (!isRenderablePosition(pos)) return;
      viewportEntries.push({ point, pos });
    });

    if (viewportShadow) {
      viewportEntries.forEach(({ point, pos }) => {

        const marker = document.createElement('div');
        marker.className = 'marker';
        marker.style.left = `${pos.x}px`;
        marker.style.top = `${pos.y}px`;

        const visual = buildHeatmapMarkerVisual(point, bounds, activeLayer);

        const outerGlow = document.createElement('div');
        outerGlow.className = 'marker-glow';
        outerGlow.style.width = `${visual.glowW}px`;
        outerGlow.style.height = `${visual.glowH}px`;
        outerGlow.style.mixBlendMode = visual.mixBlendMode || 'screen';
        outerGlow.style.background = visual.outerGradient
          || `radial-gradient(ellipse at center, ${visual.outerColor} 0%, rgba(255,255,255,0) 72%)`;
        outerGlow.style.filter = `blur(${visual.blur}px)`;
        outerGlow.style.border = visual.outerBorder || 'none';

        const innerGlow = document.createElement('div');
        innerGlow.className = 'marker-glow';
        innerGlow.style.width = `${visual.innerW}px`;
        innerGlow.style.height = `${visual.innerH}px`;
        innerGlow.style.mixBlendMode = visual.mixBlendMode || 'screen';
        innerGlow.style.background = visual.innerGradient
          || `radial-gradient(ellipse at center, ${visual.innerColor} 0%, rgba(255,255,255,0) 74%)`;
        innerGlow.style.filter = `blur(${typeof visual.innerBlur === 'number' ? visual.innerBlur : Math.max(2, Math.round(visual.blur * 0.28))}px)`;

        marker.appendChild(outerGlow);
        marker.appendChild(innerGlow);
        viewportShadow.appendChild(marker);
      });
    }

    if (heatmapNeedsPersist) {
      heatmapNeedsPersist = false;
      persistHeatmapPointOverrides().catch(() => {});
    }
  }

  function clearHeatmapPointOverlaysNow() {
    heatmapSurfaceOverlays.forEach((shadow, surface) => {
      if (!surface.isConnected) {
        if (shadow._host?.isConnected) shadow._host.remove();
        heatmapSurfaceOverlays.delete(surface);
      } else {
        shadow.innerHTML = '';
      }
    });

    const viewportShadow = ensureHeatmapOverlayHost();
    if (viewportShadow) viewportShadow.innerHTML = '';
  }

  let heatmapOverlayRaf = 0;
  let heatmapFollowUntil = 0;
  function scheduleHeatmapOverlayRender() {
    if (heatmapOverlayRaf) return;
    const run = () => {
      heatmapOverlayRaf = 0;
      renderHeatmapPointOverlays();
      if (performance.now() < heatmapFollowUntil) {
        heatmapOverlayRaf = requestAnimationFrame(run);
      }
    };
    heatmapOverlayRaf = requestAnimationFrame(run);
  }



  async function saveHeatmapPointOverride(editorState, metric, value, zoneName, options = {}) {
    const point = editorState?.heatmapPoint;
    if (!point) return;
    heatmapPointOverrides[editorState.zoneKey] = {
      frameContextKey: String(editorState.frameContextKey || point.frameContextKey || frameContextKey),
      pointId: point.pointId,
      surfaceKey: point.surfaceKey,
      layer: normalizeHeatmapLayerName(point.layer),
      xPct: Number(point.xPct),
      yPct: Number(point.yPct),
      anchorKey: String(point.anchorKey || ''),
      anchorPath: String(point.anchorPath || ''),
      anchorDocPath: String(point.anchorDocPath || ''),
      anchorStartScrollLeft: Number(point.anchorStartScrollLeft),
      anchorStartScrollTop: Number(point.anchorStartScrollTop),
      anchorContentX: Number(point.anchorContentX),
      anchorContentY: Number(point.anchorContentY),
      surfaceContentX: Number(point.surfaceContentX),
      surfaceContentY: Number(point.surfaceContentY),
      contentX: Number(point.contentX),
      contentY: Number(point.contentY),
      pageX: Number(point.pageX),
      pageY: Number(point.pageY),
      trackingKey: String(point.trackingKey || ''),
      trackingDocPath: String(point.trackingDocPath || ''),
      ...(Number.isFinite(Number(point.trackingOffsetX))
        ? { trackingOffsetX: Number(point.trackingOffsetX), trackingOffsetY: Number(point.trackingOffsetY) }
        : {}),
      ...(typeof point.anchorTransformX === 'number'
        ? { anchorTransformX: point.anchorTransformX, anchorTransformY: Number(point.anchorTransformY) }
        : {}),
      level: normalizeHeatmapPointLevel(options.level || point.level || inferHeatmapPointLevel(point)),
      centerColor: String(options.centerColor || point.centerColor || '#ee3a32'),
      metric,
      value,
      zoneName: String(zoneName || point.zoneName || '').trim()
    };
    await persistHeatmapPointOverrides();
    renderHeatmapPointOverlays();
    closePopover();
    updateToolbar();
  }

  async function resetHeatmapPointOverride(editorState) {
    if (!editorState?.zoneKey) return;
    delete heatmapPointOverrides[editorState.zoneKey];
    await persistHeatmapPointOverrides();
    renderHeatmapPointOverlays();
    closePopover();
    updateToolbar();
  }

  function getTotalOverrideCount() {
    return Object.keys(overrides).length + Object.keys(heatmapPointOverrides).length;
  }

  function openHeatmapPointEditorAt(clientX, clientY, source = 'unknown', surfaceEl = null, anchorHintEl = null, eventPath = []) {
    if (!CS_ENABLE_HEATMAP_INTERACTIONS) {
      log('Global zone no-match', `heatmap interactions disabled source=${source}`);
      return false;
    }

    if (!isWithinHeatmapInteractionBoundary(clientX, clientY, surfaceEl, eventPath)) {
      log('Global zone no-match', `heatmap editor boundary miss source=${source}`, `xy=${clientX},${clientY}`);
      return false;
    }

    const editorState = buildHeatmapPointEditorState(clientX, clientY, surfaceEl, anchorHintEl, eventPath);
    if (!editorState) {
      log('Global zone no-match', `heatmap editor miss source=${source}`, `xy=${clientX},${clientY}`);
      showHeatmapEditHint('Edit mode is on, but no editable heatmap surface was detected at that point.');

      return false;
    }

    log('Opening top-frame editor for', editorState.zoneKey, `source=${source}`);

    if (!isTopFrame) {
      chrome.runtime.sendMessage({
        type: 'broadcastToTab',
        payload: { type: 'openEditor', editorState }
      }, response => {
        const err = chrome.runtime.lastError;
        if (err) {
          console.warn('[CS Demo Tool][broadcast openEditor failed]', err.message || err);
          showHeatmapEditHint('Editor broadcast failed from subframe. Check console for details.');

          return;
        }
        log('Opening top-frame editor for', editorState.zoneKey, 'broadcast response=', response || {});
      });
      return true;
    }

    openEditPopover(editorState);
    return true;
  }

  function findZoneElementFromEvent(event) {
    const x = Number(event?.clientX);
    const y = Number(event?.clientY);
    const pickBestByPoint = (all, px, py) => {
      if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
      const candidates = all.filter(el => {
        try {
          const r = el.getBoundingClientRect();
          return r.width > 0
            && r.height > 0
            && px >= r.left
            && px <= r.right
            && py >= r.top
            && py <= r.bottom;
        } catch (_) {
          return false;
        }
      });

      if (!candidates.length) return null;
      candidates.sort((a, b) => {
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        const areaDelta = (ra.width * ra.height) - (rb.width * rb.height);
        if (areaDelta !== 0) return areaDelta;
        const da = Math.hypot((ra.left + ra.width / 2) - px, (ra.top + ra.height / 2) - py);
        const db = Math.hypot((rb.left + rb.width / 2) - px, (rb.top + rb.height / 2) - py);
        return da - db;
      });
      return candidates[0] || null;
    };

    const byPoint = pickBestByPoint(getAllZoneElements(), x, y);
    if (byPoint) return byPoint;

    const findClosestZone = node => {
      if (!(node instanceof Element)) return null;
      const tag = node.tagName ? node.tagName.toLowerCase() : '';
      if (tag === 'app-zone-elements' || tag === 'app-zone-element') return node;
      const inTree = node.closest ? node.closest(CS_ZONE_SELECTORS) : null;
      if (inTree) return inTree;
      return closestAcrossShadow(node, CS_ZONE_SELECTORS);
    };

    const path = event.composedPath ? event.composedPath() : [];
    for (const node of path) {
      const closest = findClosestZone(node);
      if (closest) return closest;
    }

    const target = event.target;
    const fromTarget = findClosestZone(target);
    if (fromTarget) return fromTarget;

    // Fallback: resolve by coordinates so replaced/custom subtree targets still map to a zone.
    if (Number.isFinite(x) && Number.isFinite(y)) {
      const pointEl = document.elementFromPoint(x, y);
      const fromPoint = findClosestZone(pointEl);
      if (fromPoint) return fromPoint;

      // Final fallback for CS overlay layers: resolve by zone bounds hit test.
      const fallback = pickBestByPoint(getAllZoneElements(), x, y);
      if (fallback) return fallback;
    }

    return null;
  }

  // ─── ZONE MANIPULATION ───────────────────────────────────────────────────

  function applyOverride(el, override) {
    appliedOverrideFlag = true;
    try {
      // Keep a per-element backup so reset can recover even if key matching changes.
      if (!el.hasAttribute('data-cs-demo-orig-metric')) {
        el.setAttribute('data-cs-demo-orig-metric', String(el.getAttribute('metric') || ''));
        if (el.hasAttribute('value')) el.setAttribute('data-cs-demo-orig-value', String(el.getAttribute('value') || ''));
        if (el.hasAttribute('color')) el.setAttribute('data-cs-demo-orig-color', String(el.getAttribute('color') || ''));
      }

      el.setAttribute('metric', override.metric);
      if (override.value !== undefined && !isNaN(Number(override.value))) {
        el.setAttribute('value', String(override.value));
        const derivedColor = getDerivedZoneColor(el, Number(override.value));
        if (derivedColor) {
          el.setAttribute('color', derivedColor);
        }
      }
      // Visual edited indicator (outline, not blocked by CSP — programmatic CSSOM)
      el.style.outline = '2px dashed rgba(255, 210, 50, 0.9)';
      el.style.outlineOffset = '-2px';
    } finally {
      setTimeout(() => { appliedOverrideFlag = false; }, 0);
    }
  }

  function clearEditedStyle(el) {
    el.style.outline = '';
    el.style.outlineOffset = '';
  }

  function getPaneKey(el) {
    const getElementFrameScope = node => {
      const doc = node?.ownerDocument || document;
      const win = doc.defaultView;
      if (!win || win === window.top) return 'top';

      try {
        const frameEl = win.frameElement;
        const parentDoc = frameEl && frameEl.ownerDocument;
        if (frameEl && parentDoc) {
          const allFrames = Array.from(parentDoc.querySelectorAll('iframe, frame'));
          const idx = allFrames.indexOf(frameEl);
          if (idx >= 0) return `frame:${idx}`;

          const fr = frameEl.getBoundingClientRect();
          const cx = fr.left + fr.width / 2;
          const side = cx >= (window.top?.innerWidth || window.innerWidth) / 2 ? 'right' : 'left';
          return `frame-geom:${Math.round(fr.left)}:${Math.round(fr.top)}:${Math.round(fr.width)}:${Math.round(fr.height)}:${side}`;
        }
      } catch (_) {}

      try {
        // CORE FIX: Strip win.location.hash here as well
        return `sub:${win.location.origin}${win.location.pathname}`;
      } catch (_) {
        return frameScopeKey;
      }
    };
    
    const withFrameScope = (base, node) => {
      const scope = getElementFrameScope(node);
      return scope === 'top' ? base : `${base}|${scope}`;
    };
    
    const getHorizontalSide = rect => {
      if (!rect) return 'left';
      const viewportCenter = window.innerWidth / 2;
      const centerX = Number(rect.left) + Number(rect.width) / 2;
      return centerX > viewportCenter ? 'right' : 'left';
    };
    
    const zoneRect = (() => {
      try {
        const snapshotHost = closestAcrossShadow(el, 'zn-snapshot-header');
        if (snapshotHost) return snapshotHost.getBoundingClientRect();
        const zoningsHost = closestAcrossShadow(el, 'app-zonings');
        if (zoningsHost) return zoningsHost.getBoundingClientRect();
        return el.getBoundingClientRect();
      } catch (_) { return null; }
    })();
    
    const zoneSide = getHorizontalSide(zoneRect);
    const withCompareSide = base => `${base}|cmp-side:${zoneSide}`;

    const snapshotHost = closestAcrossShadow(el, 'zn-snapshot-header');
    if (snapshotHost) {
      const snapshotHosts = getAllElementsByTag('zn-snapshot-header')
        .filter(host => {
          if (!(host instanceof Element) || !host.isConnected) return false;
          try {
            const r = host.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          } catch (_) {
            return false;
          }
        });

      if (snapshotHosts.length > 1) {
        const ranked = [...snapshotHosts].sort((a, b) => {
          const ra = a.getBoundingClientRect();
          const rb = b.getBoundingClientRect();
          if (Math.round(ra.left) !== Math.round(rb.left)) return Math.round(ra.left) - Math.round(rb.left);
          if (Math.round(ra.top) !== Math.round(rb.top)) return Math.round(ra.top) - Math.round(rb.top);
          if (Math.round(ra.width) !== Math.round(rb.width)) return Math.round(ra.width) - Math.round(rb.width);
          return Math.round(ra.height) - Math.round(rb.height);
        });
        const paneIndex = ranked.indexOf(snapshotHost);
        if (paneIndex >= 0) {
          return withFrameScope(withCompareSide(`snapshot-pane:${paneIndex}`), snapshotHost);
        }
      }
    }

    const zoningsHost = closestAcrossShadow(el, 'app-zonings');
    if (zoningsHost) {
      const visibleHosts = getAllElementsByTag('app-zonings').filter(host => {
        if (!(host instanceof Element) || !host.isConnected) return false;
        try {
          const r = host.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        } catch (_) {
          return false;
        }
      });

      if (visibleHosts.length > 1) {
        const ranked = [...visibleHosts].sort((a, b) => {
          const ra = a.getBoundingClientRect();
          const rb = b.getBoundingClientRect();
          if (Math.round(ra.left) !== Math.round(rb.left)) return Math.round(ra.left) - Math.round(rb.left);
          if (Math.round(ra.top) !== Math.round(rb.top)) return Math.round(ra.top) - Math.round(rb.top);
          if (Math.round(ra.width) !== Math.round(rb.width)) return Math.round(ra.width) - Math.round(rb.width);
          return Math.round(ra.height) - Math.round(rb.height);
        });
        const paneIndex = ranked.indexOf(zoningsHost);
        if (paneIndex >= 0) {
          return withFrameScope(withCompareSide(`zoning-pane:${paneIndex}`), zoningsHost);
        }
      }
    }

    const scrollContainer = closestAcrossShadow(el, 'app-heatmap-scroll-element');
    if (scrollContainer) {
      const fullpath = scrollContainer.getAttribute('fullpath');
      const allScrollContainers = getAllElementsByTag('app-heatmap-scroll-element');
      if (fullpath) {
        const sameFullpath = allScrollContainers.filter(c => c.getAttribute('fullpath') === fullpath);
        if (sameFullpath.length > 1) {
          const idx = sameFullpath.indexOf(scrollContainer);
          return withFrameScope(withCompareSide(`fullpath:${fullpath}:${idx}`), scrollContainer);
        }
        const rect = scrollContainer.getBoundingClientRect();
        const isLikelySplitPane = rect.width > 0 && rect.width <= window.innerWidth * 0.75;
        if (isLikelySplitPane) {
          const side = getHorizontalSide(rect);
          return withFrameScope(withCompareSide(`fullpath:${fullpath}:side:${side}`), scrollContainer);
        }
        return withFrameScope(withCompareSide(`fullpath:${fullpath}`), scrollContainer);
      }
      const idx = allScrollContainers.indexOf(scrollContainer);
      if (idx >= 0) return withFrameScope(withCompareSide(`scroll:${idx}`), scrollContainer);
    }

    const rect = el.getBoundingClientRect();
    const side = getHorizontalSide(rect);
    return withFrameScope(withCompareSide(`side:${side}`), el);
  }

  function getZoneKey(el) {
    const zoneId = el.getAttribute('id');
    if (!zoneId) return null;
    const paneKey = getPaneKey(el);
    if (!paneKey) return null;

    // Hard disambiguation for compare layouts where the same zone id can appear
    // in multiple panes/hosts. Use global duplicate indexing so separation does
    // not depend on pane-key heuristics.
    const duplicates = getAllZoneElements().filter(zoneEl => {
      return (zoneEl.getAttribute('id') || '') === zoneId;
    });

    if (duplicates.length <= 1) {
      return `${paneKey}::${zoneId}`;
    }

    const rank = node => {
      const doc = node.ownerDocument || document;
      const href = (() => {
        try { return doc.defaultView?.location?.href || ''; } catch (_) { return ''; }
      })();
      const r = node.getBoundingClientRect();
      return {
        href,
        left: Math.round(r.left),
        top: Math.round(r.top),
        width: Math.round(r.width),
        height: Math.round(r.height)
      };
    };

    const sorted = [...duplicates].sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      if (ra.href !== rb.href) return ra.href < rb.href ? -1 : 1;
      if (ra.left !== rb.left) return ra.left - rb.left;
      if (ra.top !== rb.top) return ra.top - rb.top;
      if (ra.width !== rb.width) return ra.width - rb.width;
      return ra.height - rb.height;
    });

    const duplicateIndex = Math.max(0, sorted.indexOf(el));
    return `${paneKey}::${zoneId}::dup:${duplicateIndex}`;
  }

  function getZoneDebugSnapshot(el) {
    if (!el) return null;
    const zoneId = el.getAttribute('id') || '';
    const paneKey = getPaneKey(el);
    const zoneKey = zoneId ? `${paneKey}::${zoneId}` : '';
    const scrollContainer = closestAcrossShadow(el, 'app-heatmap-scroll-element');
    const fullpath = scrollContainer?.getAttribute('fullpath') || '';
    const doc = el.ownerDocument || document;
    const win = doc.defaultView;
    const href = (() => {
      try { return win?.location?.href || ''; } catch (_) { return ''; }
    })();
    const rect = (() => {
      try {
        const r = el.getBoundingClientRect();
        return { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
      } catch (_) {
        return null;
      }
    })();

    return {
      zoneId,
      paneKey,
      zoneKey,
      fullpath,
      metric: el.getAttribute('metric') || '',
      frameContextKey,
      ownerHref: href,
      rect
    };
  }

  function dumpZoneDebugRows(limit = 200) {
    const rows = getZoneDebugRows(limit);
    console.table(rows);
    return rows;
  }

  function getZoneDebugRows(limit = 200) {
    return getAllZoneElements().slice(0, Math.max(1, Number(limit) || 200)).map((el, idx) => {
      const snap = getZoneDebugSnapshot(el) || {};
      return {
        idx,
        zoneId: snap.zoneId || '',
        paneKey: snap.paneKey || '',
        zoneKey: snap.zoneKey || '',
        fullpath: snap.fullpath || '',
        metric: snap.metric || '',
        frameContextKey: snap.frameContextKey || '',
        ownerHref: snap.ownerHref || '',
        left: snap.rect?.left,
        top: snap.rect?.top,
        width: snap.rect?.width,
        height: snap.rect?.height
      };
    });
  }

  function describeElementForDebug(el) {
    if (!el || !(el instanceof Element)) return null;
    const rect = (() => {
      try {
        const r = el.getBoundingClientRect();
        return {
          left: Math.round(r.left),
          top: Math.round(r.top),
          width: Math.round(r.width),
          height: Math.round(r.height)
        };
      } catch (_) {
        return null;
      }
    })();

    return {
      tag: (el.tagName || '').toLowerCase(),
      id: el.id || '',
      className: typeof el.className === 'string' ? el.className : '',
      dataTestId: el.getAttribute('data-testid') || '',
      fullpath: el.getAttribute('fullpath') || '',
      scrollLeft: Number(el.scrollLeft || 0),
      scrollTop: Number(el.scrollTop || 0),
      scrollWidth: Number(el.scrollWidth || 0),
      scrollHeight: Number(el.scrollHeight || 0),
      clientWidth: Number(el.clientWidth || 0),
      clientHeight: Number(el.clientHeight || 0),
      rect
    };
  }

  function collectHeatmapDebugSnapshot() {
    const activeLayer = getActiveHeatmapLayerName();
    const surfaces = getAllHeatmapSurfaceElements();
    const primaryScrollContainer = getLikelyPrimaryScrollContainer();
    const surfaceRows = surfaces.map(surface => ({
      surfaceKey: getHeatmapSurfaceKey(surface),
      ...describeElementForDebug(surface)
    }));

    const pointRows = Object.entries(heatmapPointOverrides).map(([zoneKey, point]) => {
      const surface = surfaces.find(el => getHeatmapSurfaceKey(el) === point.surfaceKey) || null;
      const anchor = resolveHeatmapPointAnchorElement(point, surface);
      const renderContainer = (anchor && anchor.isConnected) ? anchor : surface;
      const surfaceRect = surface
        ? surface.getBoundingClientRect()
        : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
      const clientPos = getHeatmapPointClientPosition(point, surface, surfaceRect);

      return {
        zoneKey,
        frameContextKey: point.frameContextKey || '',
        pointId: point.pointId || '',
        layer: point.layer || '',
        metric: point.metric || '',
        value: Number(point.value),
        surfaceKey: point.surfaceKey || '',
        anchorKey: point.anchorKey || '',
        anchorPath: point.anchorPath || '',
        anchorDocPath: point.anchorDocPath || '',
        trackingKey: point.trackingKey || '',
        trackingDocPath: point.trackingDocPath || '',
        trackingOffsetX: Number(point.trackingOffsetX),
        trackingOffsetY: Number(point.trackingOffsetY),
        anchorStartScrollLeft: Number(point.anchorStartScrollLeft),
        anchorStartScrollTop: Number(point.anchorStartScrollTop),
        anchorContentX: Number(point.anchorContentX),
        anchorContentY: Number(point.anchorContentY),
        surfaceContentX: Number(point.surfaceContentX),
        surfaceContentY: Number(point.surfaceContentY),
        pageX: Number(point.pageX),
        pageY: Number(point.pageY),
        resolvedTracking: describeElementForDebug(resolveHeatmapPointTrackingElement(point)),
        resolvedSurface: describeElementForDebug(surface),
        resolvedAnchor: describeElementForDebug(anchor),
        resolvedContainer: describeElementForDebug(renderContainer),
        resolvedViaDocPath: !anchor && !!point.anchorDocPath,
        clientX: clientPos ? Math.round(clientPos.x) : null,
        clientY: clientPos ? Math.round(clientPos.y) : null
      };
    });

    return {
      loaded: true,
      mode: 'heatmap',
      frameContextKey,
      frameScopeKey,
      frameInstanceKey,
      isTopFrame,
      href: location.href,
      activeLayer,
      pointCount: pointRows.length,
      surfaceCount: surfaceRows.length,
      primaryScrollContainer: describeElementForDebug(primaryScrollContainer),
      surfaces: surfaceRows,
      points: pointRows
    };
  }

  function installPageWorldDebugBridge() {
    try {
      if (document.documentElement?.hasAttribute('data-cs-demo-page-bridge-installed')) {
        return;
      }

      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('content/page-bridge.js');
      script.async = false;
      script.dataset.csDemoPageBridge = '1';
      script.addEventListener('load', () => {
        script.remove();
        document.documentElement?.setAttribute('data-cs-demo-page-bridge-installed', '1');
        syncPageWorldState();
      }, { once: true });
      script.addEventListener('error', () => {
        script.remove();
        log('Global zone no-match', 'page-bridge injection failed');
      }, { once: true });

      (document.head || document.documentElement || document.body)?.appendChild(script);
    } catch (_) {
      log('Global zone no-match', 'page-bridge injection threw');
    }
  }

  function syncPageWorldState() {
    try {
      window.dispatchEvent(new CustomEvent('cs-demo-set-state', {
        detail: {
          editMode: !!editMode,
          uiVisible: uiVisible !== false
        }
      }));
    } catch (_) {
      // Ignore page-world sync issues.
    }
  }

  // Encodes a per-metric override key — scopes each override to its originating metric context.
  function getMetricBasedKey(zoneKey, origMetric) {
    return `${zoneKey}@${origMetric}`;
  }

  // Maps a formatted metric value to a human-readable label used in auto-generated zone names.
  // Used only as a fallback when the actual CS metric type name cannot be read from the DOM/URL.
  function inferMetricLabel(metric) {
    const m = String(metric || '').trim();
    if (!m || m === '—' || m === '-') return 'Zone';
    if (/^[$€£¥][\d.,\s]/.test(m) || /[\d.,\s][$€£¥]$/.test(m)) return `Revenue ${m}`;
    if (m.endsWith('%')) return `Rate ${m}`;
    if (/^\d[\d.,]*\s*s$/.test(m)) return `Duration ${m}`;
    if (/^\d[\d.,]*k$/i.test(m)) return `Volume ${m}`;
    if (/^[\d.,]+$/.test(m)) return `Score ${m}`;
    return m;
  }

  function normalizeMetricTypeName(raw) {
    const text = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';

    // Drop detail qualifiers like "(pageview level)".
    const withoutQualifier = text.replace(/\s*\([^)]*level[^)]*\)\s*/gi, ' ').trim();
    if (!withoutQualifier) return '';

    return withoutQualifier
      .split(' ')
      .map(part => part ? part[0].toUpperCase() + part.slice(1).toLowerCase() : part)
      .join(' ')
      .trim();
  }

  // Attempts to read the current CS metric type name (e.g. "Click Rate", "Attractiveness Rate")
  // from the top-frame page. Tries three strategies in order:
  //  1. URL hash query param  (?metric=click_rate  or  ?indicator=click_rate)
  //  2. Known CS DOM selectors for the active metric pill / dropdown button
  //  3. Text-scan of the page for known CS metric names
  // Returns an empty string when nothing can be found.
  function readCsMetricTypeName() {
    if (!isTopFrame) return csMetricTypeName; // subframes reuse whatever top-frame cached

    // ── Strategy 1: URL hash query param ────────────────────────────────────
    try {
      const hash = location.hash || '';
      const qIdx = hash.indexOf('?');
      if (qIdx !== -1) {
        const params = new URLSearchParams(hash.slice(qIdx + 1));
        const raw = params.get('metric') || params.get('indicator') || params.get('kpi') || '';
        if (raw) {
          // Convert snake_case / kebab-case to Title Case
          const titled = raw.replace(/[-_]+/g, ' ')
            .replace(/\b\w/g, c => c.toUpperCase());
          log('CS metric from URL param:', titled);
          return titled;
        }
      }
    } catch (_) {}

    // ── Strategy 2: CS DOM selectors ─────────────────────────────────────────
    const domSelectors = [
      // Direct metric selector trigger (from CS dropdown itself)
      'div.metric-selector-trigger span',
      'div[class*="metric-selector-trigger"] span',
      'csm-universal-select[class*="metric-selector"] span',
      '[class*="metric-selector"] [class*="active"]',
      '[class*="metric-selector"] [aria-selected="true"]',
      '[class*="kpi-selector"] [class*="selected"]',
      '[class*="kpi-selector"] [aria-selected="true"]',
      '[class*="metric-dropdown"] [class*="trigger"]',
      '[class*="metric-dropdown"] button',
      '[class*="metrics"] [class*="active"]',
      '[class*="indicators"] [class*="active"]',
      'cq-metric-selector [selected]',
      'cq-metric-selector [active]',
      '[role="option"][aria-selected="true"]',
      '[role="tab"][aria-selected="true"]',
    ];

    const knownMetricNames = [
      'Click Rate', 'Attractiveness Rate', 'Engagement Rate',
      'Exposure Rate', 'Activity Rate', 'Conversion Rate',
      'Revenue', 'Transactions', 'Revenue per Session',
      'Time on Page', 'Scroll Depth', 'Bounce Rate',
      'Page Views', 'Sessions', 'Unique Visitors',
      'Add to Cart Rate', 'Product Detail Views',
    ];
    const knownLower = knownMetricNames.map(n => n.toLowerCase());

    function normalizeCandidate(text) {
      const raw = normalizeMetricTypeName(text);
      if (!raw) return '';

      // Prefer canonical known labels if they appear in a noisy string.
      const lower = raw.toLowerCase();
      const known = knownMetricNames.find(name => lower.includes(name.toLowerCase()));
      if (known) return known;

      // Heuristic fallback for unseen metric labels.
      // Reject obvious value strings (numbers, %, currency-heavy).
      if (/^[\d\s.,%$€£¥-]+$/.test(raw)) return '';
      if (/\d/.test(raw) && /[%$€£¥]/.test(raw)) return '';
      if (raw.length > 64) return '';

      // Keep likely metric-like labels.
      if (/(rate|revenue|transaction|session|page view|visitor|bounce|scroll|engagement|attractiveness|activity|exposure|conversion|cart|time)/i.test(raw)) {
        return raw;
      }
      return '';
    }

    // Deep query that walks open shadow roots.
    function queryAllDeep(selector, root = document, out = []) {
      if (!root || !root.querySelectorAll) return out;
      root.querySelectorAll(selector).forEach(el => out.push(el));
      root.querySelectorAll('*').forEach(el => {
        if (el.shadowRoot) queryAllDeep(selector, el.shadowRoot, out);
      });
      return out;
    }

    // ── Strategy 1.5: read the selected metric name directly from dropdown trigger ──
    try {
      const triggerCandidates = queryAllDeep('div.metric-selector-trigger, div[class*="metric-selector-trigger"]');
      for (const trigger of triggerCandidates) {
        const text = trigger.textContent || '';
        const label = normalizeCandidate(text);
        if (label) {
          log('CS metric from trigger text:', label);
          return label;
        }
      }
    } catch (_) {}

    // ── Strategy 2: selector-based scan across normal DOM + shadow DOM ─────
    for (const sel of domSelectors) {
      try {
        const candidates = queryAllDeep(sel);
        for (const el of candidates) {
          const text = [
            el.textContent,
            el.getAttribute && el.getAttribute('aria-label'),
            el.getAttribute && el.getAttribute('title')
          ].filter(Boolean).join(' ');
          const label = normalizeCandidate(text);
          if (label) {
            log('CS metric from DOM selector:', sel, '->', label);
            return label;
          }
        }
      } catch (_) {}
    }

    // ── Strategy 2.5: score known metric labels by "selected/active" signals ──
    // This helps disambiguate cases where multiple metrics are visible (e.g. Click vs Attractiveness)
    // and only one is currently selected.
    try {
      const allEls = queryAllDeep('*');
      let best = null;

      function isVisible(el) {
        const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
        return !!rect && rect.width > 0 && rect.height > 0;
      }

      function scoreElement(el, metricName) {
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (!text) return -Infinity;
        const lowText = text.toLowerCase();
        const lowMetric = metricName.toLowerCase();
        if (!lowText.includes(lowMetric)) return -Infinity;

        let score = 0;
        if (lowText === lowMetric) score += 4;
        if (isVisible(el)) score += 2;

        const ariaSelected = (el.getAttribute && el.getAttribute('aria-selected')) || '';
        const ariaCurrent = (el.getAttribute && el.getAttribute('aria-current')) || '';
        const dataSelected = (el.getAttribute && el.getAttribute('data-selected')) || '';
        if (ariaSelected === 'true') score += 8;
        if (ariaCurrent && ariaCurrent !== 'false') score += 6;
        if (dataSelected === 'true') score += 6;
        if (el.hasAttribute && el.hasAttribute('selected')) score += 6;

        const role = ((el.getAttribute && el.getAttribute('role')) || '').toLowerCase();
        if (/^(tab|option|radio|menuitemradio)$/.test(role)) score += 3;

        const className = String(el.className || '').toLowerCase();
        if (/(active|selected|current|checked)/.test(className)) score += 4;

        // Penalize long blobs of text where metric appears incidentally.
        if (text.length > metricName.length + 40) score -= 3;

        return score;
      }

      for (const metricName of knownMetricNames) {
        for (const el of allEls) {
          const s = scoreElement(el, metricName);
          if (!Number.isFinite(s)) continue;
          if (!best || s > best.score) {
            best = { score: s, metricName };
          }
        }
      }

      if (best && best.score >= 8) {
        log('CS metric from scored label scan:', best.metricName, 'score=', best.score);
        return best.metricName;
      }
    } catch (_) {}

    // ── Strategy 3: broad text scan in shadow-inclusive content ─────────────
    function collectTextFromNode(node, parts) {
      if (!node) return;
      if (node.nodeType === 3) { parts.push(node.nodeValue || ''); return; }
      if (node.shadowRoot) collectTextFromNode(node.shadowRoot, parts);
      for (const child of (node.childNodes || [])) collectTextFromNode(child, parts);
    }
    try {
      const parts = [];
      collectTextFromNode(document.body, parts);
      const fullText = parts.join(' ');

      // Exact known name match first.
      for (const name of knownMetricNames) {
        if (fullText.includes(name)) {
          log('CS metric from shadow text scan:', name);
          return name;
        }
      }

      // Regex fallback (e.g. unseen "Something Rate").
      const m = fullText.match(/\b([A-Za-z][A-Za-z\s]{1,30}(?:Rate|Revenue|Transactions?|Sessions?|Visitors?|Bounce\s+Rate|Scroll\s+Depth))\b/i);
      if (m && m[1]) {
        const label = normalizeCandidate(m[1]);
        if (label) {
          log('CS metric from regex fallback:', label);
          return label;
        }
      }
    } catch (_) {}

    return '';
  }

  function refreshMetricTypeName() {
    const found = readCsMetricTypeName();
    // Never keep stale labels (e.g. "Revenue") if detection failed on the current view.
    csMetricTypeName = found || '';
  }

  function isMetricTypeCompatible(metricValue, metricTypeName) {
    const value = String(metricValue || '').trim();
    const type = String(metricTypeName || '').trim().toLowerCase();
    if (!type) return false;

    if (/[$€£¥]/.test(value)) {
      return /(revenue|sales|order|transaction|aov|cart)/i.test(type);
    }
    if (/%/.test(value)) {
      return /(rate|ratio|conversion|bounce|engagement|attractiveness|activity|exposure|click)/i.test(type);
    }
    if (/\b\d[\d.,]*\s*s\b/i.test(value)) {
      return /(time|duration|seconds?)/i.test(type);
    }

    // For plain numeric values we can't strongly validate type/value compatibility.
    return true;
  }

  function isExposureRateMetric(metricTypeName) {
    return /(^|\s)exposure\s+rate(\s|$)/i.test(String(metricTypeName || '').trim());
  }

  function formatPercent(value, decimals = 1) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '0.0%';
    return `${n.toFixed(Math.max(0, Number(decimals) || 0))}%`;
  }

  function generateDefaultZoneName(origMetric, csTypeName) {
    const resolvedType = isMetricTypeCompatible(origMetric, csTypeName) ? csTypeName : '';
    const base = resolvedType || inferMetricLabel(origMetric);
    const existingOfBase = Object.values(overrides).filter(ov => {
      const ovType = isMetricTypeCompatible(ov.origMetric || '', ov.csMetricTypeName) ? ov.csMetricTypeName : '';
      const b = ovType || inferMetricLabel(ov.origMetric || '');
      return b === base;
    }).length;
    return `${base} ${existingOfBase + 1}`;
  }

  function hasDuplicateZoneIdAcrossPanes(zoneId) {
    const id = String(zoneId || '').trim();
    if (!id) return false;

    let count = 0;
    getAllZoneElements().forEach(el => {
      if ((el.getAttribute('id') || '') !== id) return;
      count += 1;
    });

    return count > 1;
  }

  // Finds the stored override that matches el's current metric context.
  // A match exists when the zone's current metric equals either ov.metric (override applied)
  // or ov.origMetric (override cleared / not yet applied). This means overrides from a
  // different metric mode (e.g. Revenue overrides on a Click Rate view) are invisible here,
  // which naturally prevents cross-metric bleed in the MutationObserver as well.
  function getOverrideForElement(el) {
    const zoneKey = getZoneKey(el);
    if (!zoneKey) return null;

    const curMetric = (el.getAttribute('metric') || '').trim();
    const prefix = zoneKey + '@';

    for (const [key, ov] of Object.entries(overrides)) {
      if (key.startsWith(prefix)) {
        // Match even if the metric is currently loading/empty
        if (ov.origMetric === curMetric || ov.metric === curMetric || curMetric === '—' || curMetric === '') {
          return { key, override: ov };
        }
      }
    }
    
    // CORE FIX: This legacy check MUST be outside the for-loop!
    if (overrides[zoneKey]) return { key: zoneKey, override: overrides[zoneKey] };
    
    return null;
  }

  function buildEditorState(zoneEl) {
    const zoneId = zoneEl.getAttribute('id') || '';
    const paneKey = getPaneKey(zoneEl) || '';
    const zoneKey = getZoneKey(zoneEl) || (zoneId && paneKey ? `${paneKey}::${zoneId}` : zoneId);
    const currentMetric = zoneEl.getAttribute('metric') || '';
    const currentValue = zoneEl.getAttribute('value') || String(parseFloat(currentMetric) || 0);
    const existing = getOverrideForElement(zoneEl);
    const zoneName = existing?.override?.zoneName || '';
    const origMetric = existing?.override?.origMetric || currentMetric;
    // Capture the current CS metric type name so subframes carry it in editorState
    refreshMetricTypeName();
    const csTypeNameForState = csMetricTypeName;

    let limitMin = 0;
    let limitMax = 100;
    try {
      const cl = JSON.parse(zoneEl.getAttribute('color-limits') || '{}');
      if (cl.limitMin !== undefined) limitMin = cl.limitMin;
      if (cl.limitMax !== undefined) limitMax = cl.limitMax;
    } catch (_) {}

    return {
      frameContextKey,
      zoneId,
      zoneKey,
      currentMetric,
      currentValue,
      hasOverride: !!existing,
      limitMin,
      limitMax,
      zoneName,
      origMetric,
      csMetricTypeName: csTypeNameForState
    };
  }

  function getColorLimitsForElement(el) {
    const rawCandidates = [
      el.getAttribute('color-limits'),
      el.getAttribute('colorlimits'),
      el.getAttribute('data-color-limits')
    ].filter(Boolean);

    for (const raw of rawCandidates) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.limitMin !== undefined && parsed.limitMax !== undefined) {
          return { limitMin: Number(parsed.limitMin), limitMax: Number(parsed.limitMax) };
        }
      } catch (_) {
        // Ignore malformed color-limits payloads.
      }
    }

    const paneKey = getPaneKey(el);
    const paneValues = getAllZoneElements()
      .filter(zoneEl => getPaneKey(zoneEl) === paneKey)
      .map(zoneEl => {
        const attrValue = parseNumericMetric(zoneEl.getAttribute('value'));
        return Number.isFinite(attrValue)
          ? attrValue
          : parseNumericMetric(zoneEl.getAttribute('metric'));
      })
      .filter(Number.isFinite);

    if (paneValues.length === 0) {
      return { limitMin: 0, limitMax: 100 };
    }

    const limitMin = Math.min(...paneValues);
    let limitMax = Math.max(...paneValues);
    if (limitMax === limitMin) limitMax = limitMin + 1;
    return { limitMin, limitMax };
  }

  function getDerivedZoneColor(el, numericValue) {
    if (!Number.isFinite(numericValue)) return null;
    const { limitMin, limitMax } = getColorLimitsForElement(el);
    return csHslaColor(numericValue, limitMin, limitMax);
  }

  function findZoneElementForState(editorState) {
    const allZones = getAllZoneElements();

    if (editorState.zoneKey) {
      const exact = allZones.find(el => getZoneKey(el) === editorState.zoneKey) || null;
      if (!exact && CS_DEBUG) {
        const sameId = allZones
          .filter(el => (el.getAttribute('id') || '') === (editorState.zoneId || ''))
          .slice(0, 12)
          .map(el => getZoneDebugSnapshot(el));
        log('Zone lookup miss for key', editorState.zoneKey, 'zoneId=', editorState.zoneId, 'candidates=', sameId);
      }
      return exact;
    }

    return allZones.find(el => {
      const zoneKey = getZoneKey(el);
      const zoneId = el.getAttribute('id') || '';
      return (editorState.zoneKey && zoneKey === editorState.zoneKey)
        || (editorState.zoneId && zoneId === editorState.zoneId);
    }) || null;
  }

  function upsertZoneOverride(el, zoneKey, zoneId, metric, value, zoneName, csTypeName) {
    const fallbackPaneKey = getPaneKey(el) || '';
    const resolvedZoneKey = (zoneKey && zoneKey !== zoneId)
      ? zoneKey
      : ((zoneId && fallbackPaneKey) ? `${fallbackPaneKey}::${zoneId}` : zoneKey);
    if (!resolvedZoneKey) return false;

    const existing = getOverrideForElement(el);
    const existingOv = existing?.override || null;
    const origMetric = existingOv?.origMetric ?? (el.getAttribute('metric') || '');
    const rawOrigValue = existingOv?.origValue ?? el.getAttribute('value');
    const origValue = rawOrigValue === null ? undefined : rawOrigValue;
    const rawOrigColor = existingOv?.origColor ?? el.getAttribute('color');
    const origColor = rawOrigColor === null ? undefined : rawOrigColor;

    // Remove any old-format keys for this zone.
    if (existing && existing.key !== getMetricBasedKey(resolvedZoneKey, origMetric)) {
      delete overrides[existing.key];
    }
    if (overrides[resolvedZoneKey]) delete overrides[resolvedZoneKey]; // legacy no-metric key
    if (zoneId && zoneId !== resolvedZoneKey && overrides[zoneId]) delete overrides[zoneId];

    const resolvedTypeName = csTypeName || csMetricTypeName || '';
    const finalName = zoneName || existingOv?.zoneName || generateDefaultZoneName(origMetric, resolvedTypeName);
    const newKey = getMetricBasedKey(resolvedZoneKey, origMetric);
    overrides[newKey] = { metric, value, origMetric, origValue, origColor, zoneName: finalName, csMetricTypeName: resolvedTypeName };
    log('Persisting override', {
      requestedZoneKey: zoneKey,
      resolvedZoneKey,
      savedKey: newKey,
      zoneId,
      metric,
      value,
      debug: getZoneDebugSnapshot(el)
    });

    applyOverride(el, { metric, value });
    return true;
  }

  function migrateLegacyOverrideIfNeeded(el) {
    const zoneId = el.getAttribute('id');
    const zoneKey = getZoneKey(el);
    if (!zoneId || !zoneKey) return;
    if (!overrides[zoneId] || overrides[zoneKey]) return;

    overrides[zoneKey] = overrides[zoneId];
    delete overrides[zoneId];
    persistOverrides();
  }

  // function watchZone(el) {
  //   const zoneKey = getZoneKey(el);
  //   if (!zoneKey) return;

  //   const existingWatcher = zoneObservers.get(zoneKey);
  //   if (existingWatcher && existingWatcher.element === el) {
  //     return;
  //   }

  //   // If key is reused for a replacement DOM node, tear down old watcher first.
  //   if (existingWatcher && existingWatcher.element !== el) {
  //     existingWatcher.observer.disconnect();
  //     existingWatcher.element.removeEventListener('click', onZoneElementClick, true);
  //     zoneObservers.delete(zoneKey);
  //   }

  //   migrateLegacyOverrideIfNeeded(el);

  //   // Apply any stored override immediately
  //   const existingOverride = getOverrideForElement(el);
  //   if (existingOverride) {
  //     applyOverride(el, existingOverride.override);
  //   }

  //   // Watch for the CS app overwriting our changes (e.g. on metric switch)
  //   const mo = new MutationObserver(() => {
  //     if (appliedOverrideFlag) return;
  //     const existing = getOverrideForElement(el);
  //     if (!existing) return;
  //     const ov = existing.override;
  //     const curMetric = el.getAttribute('metric');
  //     if (curMetric !== ov.metric) {
  //       // CS reset our value — reapply
  //       requestAnimationFrame(() => applyOverride(el, ov));
  //     }
  //   });
  //   mo.observe(el, { attributes: true, attributeFilter: ['metric', 'value', 'status'] });
  //   zoneObservers.set(zoneKey, { observer: mo, element: el });

  //   // Keep element-level capture listeners for iframe/shadow contexts.
  //   ['pointerup', 'mouseup', 'click', 'contextmenu'].forEach(type => {
  //     el.addEventListener(type, onZoneElementClick, true);
  //   });
  // }

  // function unwatchZone(el) {
  //   const zoneKey = getZoneKey(el);
  //   if (!zoneKey) return;
  //   const entry = zoneObservers.get(zoneKey);
  //   if (entry && entry.element === el) {
  //     entry.observer.disconnect();
  //     zoneObservers.delete(zoneKey);
  //   }
  //   ['pointerup', 'mouseup', 'click', 'contextmenu'].forEach(type => {
  //     el.removeEventListener(type, onZoneElementClick, true);
  //   });
  // }

  function watchZone(el) {
    const zoneKey = getZoneKey(el);
    if (!zoneKey) return;

    const existingWatcher = zoneObservers.get(zoneKey);
    if (existingWatcher && existingWatcher.element === el) {
      return;
    }

    // If key is reused for a replacement DOM node, tear down old watcher first.
    if (existingWatcher && existingWatcher.element !== el) {
      existingWatcher.observer.disconnect();
      // Remove listeners from the old element to prevent memory leaks or duplicate triggers
      ['pointerup', 'mouseup', 'click', 'contextmenu'].forEach(type => {
        existingWatcher.element.removeEventListener(type, onZoneElementClick, true);
      });
      zoneObservers.delete(zoneKey);
    }

    migrateLegacyOverrideIfNeeded(el);

    // APPLY IMMEDIATELY: This ensures overrides are persistent on page discovery/reload
    const existingOverride = getOverrideForElement(el);
    if (existingOverride) {
      applyOverride(el, existingOverride.override);
    }

    // Set up MutationObserver to watch for the CS app resetting values (e.g., on metric switch)
    const mo = new MutationObserver(() => {
      if (appliedOverrideFlag) return;
      const existing = getOverrideForElement(el);
      if (!existing) return;
      const ov = existing.override;
      const curMetric = el.getAttribute('metric');
      
      if (curMetric !== ov.metric) {
        // If Contentsquare resets the value, re-apply the override on the next frame
        requestAnimationFrame(() => applyOverride(el, ov));
      }
    });
    
    mo.observe(el, { attributes: true, attributeFilter: ['metric', 'value', 'status'] });
    zoneObservers.set(zoneKey, { observer: mo, element: el });

    // Attach listeners for editing interactions
    ['pointerup', 'mouseup', 'click', 'contextmenu'].forEach(type => {
      el.addEventListener(type, onZoneElementClick, true);
    });
  }

  function onZoneElementClick(e) {
    const zoneEl = e.currentTarget;
    if (!(zoneEl instanceof Element)) return;
    if (!editMode || !uiVisible) return;

    const zoneKey = getZoneKey(zoneEl) || zoneEl.getAttribute('id') || '';
    const now = Date.now();
    if (zoneKey && lastDirectZoneOpenKey === zoneKey && (now - lastDirectZoneOpenAt) < 250) {
      e.stopPropagation();
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }

    lastDirectZoneOpenAt = now;
    lastDirectZoneOpenKey = zoneKey;
    onZoneClick(zoneEl, e);
  }

  function syncZoneWatchers() {
    const zones = getAllZoneElements();
    const activeKeys = new Set();

    zones.forEach(el => {
      const zoneKey = getZoneKey(el);
      if (zoneKey) activeKeys.add(zoneKey);
      watchZone(el);
    });

    Array.from(zoneObservers.keys()).forEach(zoneKey => {
      if (!activeKeys.has(zoneKey)) {
        const entry = zoneObservers.get(zoneKey);
        if (entry) {
          entry.observer.disconnect();
          entry.element.removeEventListener('click', onZoneElementClick, true);
        }
        zoneObservers.delete(zoneKey);
      }
    });

    log('Zone watcher sync complete. zones=', zones.length, 'watchers=', zoneObservers.size);
    // (Removed repeated applyAllOverrides to prevent infinite logging)
  }

  function applyAllOverrides() {
    const zoneElements = getAllZoneElements();
    if (window.__ZONING_DEBUG_LOG__ !== false) {
      console.log('[ZONING-DEBUG][applyAllOverrides] zoneElements.length:', zoneElements.length);
    }
    zoneElements.forEach(el => {
      const key = getZoneKey(el);
      const existing = getOverrideForElement(el);
      if (window.__ZONING_DEBUG_LOG__ !== false) {
        console.log('[ZONING-DEBUG][applyAllOverrides]', {
          el,
          key,
          hasOverride: !!existing,
          override: existing?.override,
          allOverrideKeys: Object.keys(overrides)
        });
      }
      if (existing) applyOverride(el, existing.override);
    });
  }

  // ─── DOCUMENT OBSERVER ───────────────────────────────────────────────────

  function startDocObserver() {
    if (docObserver) return;
    docObserver = new MutationObserver(mutations => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.matches && node.matches(CS_ZONE_SELECTORS)) {
            watchZone(node);
          } else {
            node.querySelectorAll?.(CS_ZONE_SELECTORS).forEach(watchZone);
          }
        }
      }

      // Catch zone updates not visible via a single root observer (shadow roots, SPA swaps).
      syncZoneWatchers();
    });
    docObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  // ─── EDIT MODE ───────────────────────────────────────────────────────────

  function setEditMode(enabled, syncGlobal = true) {
    const prev = editMode;
    editMode = enabled;
    log('Edit mode changed:', prev, '->', editMode, 'syncGlobal=', syncGlobal);

    if (isTopFrame) {
      if (enabled) {
        chrome.runtime.sendMessage({ type: 'insertEditCSS' });
      } else {
        chrome.runtime.sendMessage({ type: 'removeEditCSS' });
      }
    }

    if (!enabled) {
      closePopover();
    }

    syncPageWorldState();

    if (syncGlobal) {
      chrome.storage.local.set({ csZoningEditMode: !!enabled, csZoningEditModeUpdatedAt: Date.now() });
      if (isTopFrame) {
        chrome.runtime.sendMessage({
          type: 'broadcastToTab',
          payload: { type: 'setEditModeFrame', enabled: !!enabled }
        }, () => {
          void chrome.runtime.lastError;
        });
      }
    }

    updateToolbar();
  }

  function onZoneClick(zoneEl, e) {
    if (!editMode || !zoneEl || !uiVisible) return;
    const editorState = buildEditorState(zoneEl);

    log('Intercepted zone click. id=', editorState.zoneId, 'key=', editorState.zoneKey, 'frame=', editorState.frameContextKey, 'debug=', getZoneDebugSnapshot(zoneEl));
    e.stopPropagation();
    e.preventDefault();
    e.stopImmediatePropagation();

    if (!isTopFrame) {
      // Subframe: send to background for fan-out; top frame will open the popup.
      chrome.runtime.sendMessage({
        type: 'broadcastToTab',
        payload: { type: 'openEditor', editorState }
      }, response => {
        const err = chrome.runtime.lastError;
        if (err) {
          console.warn('[CS Demo Tool][broadcast openEditor failed]', err.message || err);
        } else {
          log('Opening top-frame editor for', editorState.zoneKey, 'broadcast response=', response || {});
        }
      });
      return;
    }

    openEditPopover(editorState, zoneEl);
  }

  function isEventInsidePopover(path) {
    if (!path) return false;
    return (popoverHost && path.includes(popoverHost))
      || (popoverShadow && path.includes(popoverShadow))
      || (popoverElement && path.includes(popoverElement));
  }

  // ─── EDIT POPOVER ────────────────────────────────────────────────────────

  function openEditPopover(editorState, zoneEl = null) {
    closePopover();
    popoverOpenedAt = Date.now();

    const isHeatmapPointEditor = editorState.kind === 'heatmap-point';
    const zoneId = editorState.zoneId || '';
    const zoneKey = editorState.zoneKey || zoneId;
    const currentMetric = editorState.currentMetric || '';
    const currentValue = editorState.currentValue || String(parseFloat(currentMetric) || 0);
    const hasOverride = !!editorState.hasOverride;
    const existingZoneName = editorState.zoneName || '';
    const heatmapLayer = String(editorState.heatmapPoint?.layer || 'clicks');
    const heatmapPointX = Math.round(Number(editorState.heatmapPoint?.xPct || 0) * 100);
    const heatmapPointY = Math.round(Number(editorState.heatmapPoint?.yPct || 0) * 100);
    const editorTitle = isHeatmapPointEditor ? 'Edit Heatmap Point' : 'Edit Zone';
    const objectLabel = isHeatmapPointEditor ? 'Point Name' : 'Zone Name';
    const objectHint = isHeatmapPointEditor ? '(label for heatmap point list)' : '(label for overrides list)';
    const displayValueHint = isHeatmapPointEditor
      ? 'Use any format: 52.8%, 1,240, 3.2s. This is the marker text shown on the heatmap.'
      : 'Use any format: 52.8%, $1,240, 3.2s. This does not change the color target.';
    const colorTargetLabel = isHeatmapPointEditor ? 'Color Intensity Target' : 'Color Target';
    const numericLabel = isHeatmapPointEditor
      ? (heatmapLayer === 'clicks' ? 'Click Volume' : 'Numeric Intensity')
      : 'Numeric Value';
    const numericHint = isHeatmapPointEditor
      ? (heatmapLayer === 'clicks'
          ? 'Used as click volume input for heat intensity mapping (log-scaled).'
          : 'Drives the layer intensity mapping for this point.')
      : 'Low = blue, high = red. Manual edits update the target slider.';
    const showCenterColorInput = isHeatmapPointEditor && heatmapLayer === 'clicks';
    const defaultCenterColor = String(editorState.heatmapPoint?.centerColor || '#ee3a32');
    const initialPointLevel = normalizeHeatmapPointLevel(inferHeatmapPointLevel(editorState.heatmapPoint), 'medium');
    // Re-evaluate in top frame at click-time in case CS UI loaded after init.
    if (isTopFrame) refreshMetricTypeName();

    // Use the CS metric type name from editorState (if provided) or the latest top-frame cache.
    const candidateCsTypeName = editorState.csMetricTypeName || csMetricTypeName || '';
    const csTypeName = isMetricTypeCompatible(currentMetric, candidateCsTypeName) ? candidateCsTypeName : '';
    const defaultNameHint = csTypeName ? `e.g. ${csTypeName} 1` : 'e.g. Click Rate 1';

    popoverHost = document.createElement('div');
    popoverHost.id = 'cs-demo-popover-host';
    popoverHost.style.position = 'fixed';
    popoverHost.style.inset = '0';
    popoverHost.style.zIndex = '2147483647';
    popoverHost.style.pointerEvents = 'auto';
    document.body.appendChild(popoverHost);
    const shadow = popoverHost.attachShadow({ mode: 'open' });
    popoverShadow = shadow;

    // Use adoptedStyleSheets to avoid page CSP blocking <style> inside shadow
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`
      .backdrop {
        position: fixed;
        inset: 0;
        background: transparent;
        pointer-events: auto;
      }
      .popover {
        position: fixed;
        background: #fff;
        border-radius: 10px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.22), 0 2px 8px rgba(0,0,0,0.1);
        padding: 18px;
        width: min(320px, calc(100vw - 16px));
        max-height: min(80vh, 620px);
        overflow: auto;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
        font-size: 13px;
        color: #1a1a2e;
        border: 1px solid #e0e0f0;
        z-index: 2147483647;
        pointer-events: auto;
      }
      .pop-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 14px;
        cursor: move;
        user-select: none;
      }
      .pop-title {
        font-weight: 700;
        font-size: 14px;
        color: #2c2c8c;
      }
      .pop-close {
        cursor: pointer;
        background: none;
        border: none;
        font-size: 18px;
        color: #999;
        padding: 0;
        line-height: 1;
      }
      .pop-close:hover { color: #333; }
      .zone-id {
        font-size: 10px;
        color: #aaa;
        margin-bottom: 14px;
        font-family: monospace;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .field { margin-bottom: 12px; }
      .field label {
        display: block;
        margin-bottom: 5px;
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.6px;
        color: #888;
      }
      .field input {
        width: 100%;
        box-sizing: border-box;
        padding: 7px 10px;
        border: 1.5px solid #d0d0e0;
        border-radius: 6px;
        font-size: 14px;
        font-family: inherit;
        color: #1a1a2e;
        outline: none;
        transition: border-color 0.15s;
        background: #fafafe;
        pointer-events: auto;
      }
      .field input:focus { border-color: #5959dc; background: #fff; }
      .field input[type="range"] {
        padding: 0;
        border: none;
        background: transparent;
      }
      .preset-grid {
        display: grid;
        grid-template-columns: repeat(5, 1fr);
        gap: 6px;
        margin-bottom: 10px;
      }
      .preset-btn {
        padding: 7px 4px;
        border: 1px solid #d8d8ea;
        border-radius: 6px;
        background: #f7f7fc;
        color: #4a4a64;
        font-size: 10px;
        font-weight: 700;
        cursor: pointer;
        transition: background 0.15s, border-color 0.15s, color 0.15s;
      }
      .preset-btn:hover {
        background: #ececff;
        border-color: #bfc1f2;
      }
      .preset-btn.active {
        background: #2c2c8c;
        border-color: #2c2c8c;
        color: #fff;
      }
      .level-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 8px;
        margin-top: 6px;
      }
      .level-btn {
        padding: 10px 8px;
        border: 1px solid #d8d8ea;
        border-radius: 8px;
        background: #f7f7fc;
        color: #303050;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
        transition: background 0.15s, border-color 0.15s, color 0.15s;
      }
      .level-btn:hover {
        background: #ececff;
        border-color: #bfc1f2;
      }
      .level-btn.active {
        background: #2c2c8c;
        border-color: #2c2c8c;
        color: #fff;
      }
      .range-row {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .range-readout {
        min-width: 40px;
        text-align: right;
        font-size: 11px;
        font-weight: 700;
        color: #555;
      }

      .range-labels {
        display: flex;
        justify-content: space-between;
        margin-top: 4px;
        font-size: 10px;
        color: #9a9ab0;
      }
      .field-advanced label {
        color: #737391;
      }
      .hint {
        font-size: 10px;
        color: #aaa;
        margin-top: 3px;
      }
      .color-preview {
        display: inline-block;
        width: 14px;
        height: 14px;
        border-radius: 3px;
        margin-left: 6px;
        vertical-align: middle;
        border: 1px solid rgba(0,0,0,0.1);
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 16px;
        padding-top: 14px;
        border-top: 1px solid #eeeeee;
      }
      .btn {
        padding: 7px 16px;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        border: none;
        font-family: inherit;
        transition: background 0.15s;
        pointer-events: auto;
      }
      .btn-cancel { background: #f0f0f4; color: #555; }
      .btn-cancel:hover { background: #e4e4ec; }
      .btn-reset { background: #fff0f0; color: #cc3333; border: 1px solid #ffcccc; }
      .btn-reset:hover { background: #ffe4e4; }
      .btn-apply { background: #2c2c8c; color: #fff; }
      .btn-apply:hover { background: #3c3cac; }
      .drag-hint {
        font-size: 10px;
        color: #a0a0b0;
        margin-left: 8px;
        font-weight: 500;
      }
    `);
    shadow.adoptedStyleSheets = [sheet];

    const rect = zoneEl
      ? zoneEl.getBoundingClientRect()
      : (editorState.clickRect || { top: 100, left: 100, right: 400, height: 100, width: 1 });
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const popoverWidth = Math.min(320, Math.max(260, viewportWidth - 16));
    const estimatedHeight = Math.min(520, Math.max(320, viewportHeight - 16));
    const margin = 8;

    function clamp(value, min, max) {
      return Math.min(Math.max(value, min), Math.max(min, max));
    }

    let left = Math.round(rect.right + 12);
    if (left + popoverWidth > viewportWidth - margin) {
      left = Math.round(rect.left - popoverWidth - 12);
    }
    if (left < margin) {
      left = clamp(viewportWidth - popoverWidth - margin, margin, viewportWidth - popoverWidth - margin);
    }

    let top = Math.round(rect.top + rect.height / 2 - estimatedHeight / 2);
    top = clamp(top, margin, viewportHeight - estimatedHeight - margin);

    const div = document.createElement('div');
    const backdrop = document.createElement('div');
    backdrop.className = 'backdrop';
    shadow.appendChild(backdrop);

    backdrop.addEventListener('click', event => {
      // Ignore the first click right after mount; zone interception can open
      // the popover during pointerdown and the subsequent click would
      // otherwise land on the backdrop and close instantly.
      if (Date.now() - popoverOpenedAt < 220) {
        event.stopPropagation();
        event.preventDefault();
        return;
      }
      log('Backdrop click -> closing popover');
      closePopover();
    });

    div.className = 'popover';
    popoverElement = div;
    div.style.top = `${top}px`;
    div.style.left = `${left}px`;
    div.innerHTML = `
      <div class="pop-header">
        <span>
          <span class="pop-title">${editorTitle}</span>
          <span class="drag-hint">Drag</span>
        </span>
        <button class="pop-close" id="btn-close" title="Close">×</button>
      </div>
      ${isHeatmapPointEditor ? `<div class="zone-id">LAYER: ${heatmapLayer}</div>` : ''}
      ${isHeatmapPointEditor ? `<div class="zone-id">POSITION: ${heatmapPointX}% x, ${heatmapPointY}% y</div>` : ''}
      <div class="zone-id">ID: ${zoneId || '(no id)'}</div>
      <div class="zone-id">KEY: ${zoneKey || '(none)'}</div>
      <div class="zone-id">FRAME: ${editorState.frameContextKey || '(unknown)'}</div>
      ${isHeatmapPointEditor ? `
        <div class="field">
          <label>${objectLabel} <span class="hint">${objectHint}</span></label>
          <input id="inp-zone-name" type="text" value="${existingZoneName}" placeholder="e.g. Checkout CTA Click Cluster">
        </div>
        <div class="field">
          <label>Data Point Type <span class="hint">(only setting required)</span></label>
          <div class="level-grid">
            <button class="level-btn" type="button" data-level="low">Low</button>
            <button class="level-btn" type="button" data-level="medium">Medium</button>
            <button class="level-btn" type="button" data-level="high">High</button>
          </div>
        </div>

      ` : `
        <div class="field">
          <label>${objectLabel} <span class="hint">${objectHint}</span></label>
          <input id="inp-zone-name" type="text" value="${existingZoneName}" placeholder="${defaultNameHint}">
        </div>
        <div class="field">
          <label>Display Value <span class="hint">(text shown on zone)</span></label>
          <input id="inp-metric" type="text" value="${currentMetric}" placeholder="e.g. 52.8%">
          <div class="hint">${displayValueHint}</div>
        </div>
        <div class="field">
          <label>${colorTargetLabel} <span class="hint">(exact range positions)</span></label>
          <div class="preset-grid">
            <button class="preset-btn" type="button" data-target-pct="0">Low</button>
            <button class="preset-btn" type="button" data-target-pct="25">Mid-Low</button>
            <button class="preset-btn" type="button" data-target-pct="50">Mid</button>
            <button class="preset-btn" type="button" data-target-pct="75">Mid-High</button>
            <button class="preset-btn" type="button" data-target-pct="100">High</button>
          </div>
          <div class="range-row">
            <input id="inp-target-color" type="range" min="0" max="100" step="1" value="0">
            <span class="range-readout" id="target-readout">0%</span>
          </div>
          <div class="range-labels">
            <span>Low</span>
            <span>Mid</span>
            <span>High</span>
          </div>
          <div class="hint">Maps directly to this pane's min/max range.</div>
        </div>
        <div class="field field-advanced">
          <label>
            ${numericLabel} <span class="hint">(advanced manual override)</span>
            <span class="color-preview" id="color-preview"></span>
          </label>
          <input id="inp-value" type="number" step="0.1" value="${Number(currentValue).toFixed(2)}" placeholder="e.g. 52.8">
          <div class="hint">${numericHint}</div>
        </div>
        ${showCenterColorInput ? `
          <div class="field">
            <label>Center Color <span class="hint">(Clicks only)</span></label>
            <input id="inp-center-color" type="color" value="${defaultCenterColor}">
          </div>
        ` : ''}
      `}
      <div class="actions">
        ${hasOverride ? '<button class="btn btn-reset" id="btn-reset">Reset Original</button>' : ''}
        <button class="btn btn-cancel" id="btn-cancel">Cancel</button>
        <button class="btn btn-apply" id="btn-apply">Apply</button>
      </div>
    `;
    shadow.appendChild(div);

    ['pointerdown', 'click', 'mousedown', 'mouseup'].forEach(eventName => {
      div.addEventListener(eventName, event => {
        log('Popover event', eventName, 'target=', event.target?.id || event.target?.className || event.target?.tagName);
        event.stopPropagation();
      });
    });

    const zoneNameInput = shadow.getElementById('inp-zone-name');
    const metricInput = shadow.getElementById('inp-metric');
    const targetSlider = shadow.getElementById('inp-target-color');
    const targetReadout = shadow.getElementById('target-readout');
    const valueInput = shadow.getElementById('inp-value');
    const centerColorInput = showCenterColorInput ? shadow.getElementById('inp-center-color') : null;
    const presetButtons = Array.from(shadow.querySelectorAll('.preset-btn'));
    const levelButtons = Array.from(shadow.querySelectorAll('.level-btn'));
    const closeButton = shadow.getElementById('btn-close');
    const cancelButton = shadow.getElementById('btn-cancel');
    const applyButton = shadow.getElementById('btn-apply');
    const resetButton = hasOverride ? shadow.getElementById('btn-reset') : null;
    let selectedPointLevel = initialPointLevel;

    if (isHeatmapPointEditor) {
      const paintLevelSelection = () => {
        levelButtons.forEach(button => {
          button.classList.toggle('active', button.dataset.level === selectedPointLevel);
        });
      };

      paintLevelSelection();
      levelButtons.forEach(button => {
        button.addEventListener('click', () => {
          selectedPointLevel = normalizeHeatmapPointLevel(button.dataset.level, selectedPointLevel);
          paintLevelSelection();
        });
      });

    }


    [zoneNameInput, metricInput, valueInput].forEach(input => {
      if (!input) return;
      input.addEventListener('focus', () => log('Input focus', input.id, 'value=', input.value));
      input.addEventListener('click', () => log('Input click', input.id));
      input.addEventListener('input', () => log('Input change', input.id, 'value=', input.value));
      input.addEventListener('keydown', event => log('Input keydown', input.id, 'key=', event.key));
    });

    [closeButton, cancelButton, applyButton, resetButton].forEach(button => {
      if (!button) return;
      button.addEventListener('pointerdown', () => log('Button pointerdown', button.id));
      button.addEventListener('click', () => log('Button click', button.id));
    });

    function clampPopoverPosition(nextLeft, nextTop) {
      const popoverRect = div.getBoundingClientRect();
      const maxLeft = window.innerWidth - popoverRect.width - margin;
      const maxTop = window.innerHeight - popoverRect.height - margin;
      div.style.left = `${clamp(nextLeft, margin, maxLeft)}px`;
      div.style.top = `${clamp(nextTop, margin, maxTop)}px`;
    }

    requestAnimationFrame(() => {
      const popoverRect = div.getBoundingClientRect();
      const maxLeft = window.innerWidth - popoverRect.width - margin;
      const maxTop = window.innerHeight - popoverRect.height - margin;
      div.style.left = `${clamp(left, margin, maxLeft)}px`;
      div.style.top = `${clamp(top, margin, maxTop)}px`;
    });

    const header = shadow.querySelector('.pop-header');
    let dragState = null;

    function onDragMove(event) {
      if (!dragState) return;
      clampPopoverPosition(event.clientX - dragState.offsetX, event.clientY - dragState.offsetY);
    }

    function onDragEnd() {
      dragState = null;
      window.removeEventListener('pointermove', onDragMove, true);
      window.removeEventListener('pointerup', onDragEnd, true);
      window.removeEventListener('pointercancel', onDragEnd, true);
    }

    header.addEventListener('pointerdown', event => {
      if (event.target && event.target.id === 'btn-close') return;
      const popoverRect = div.getBoundingClientRect();
      dragState = {
        offsetX: event.clientX - popoverRect.left,
        offsetY: event.clientY - popoverRect.top
      };
      window.addEventListener('pointermove', onDragMove, true);
      window.addEventListener('pointerup', onDragEnd, true);
      window.addEventListener('pointercancel', onDragEnd, true);
      event.preventDefault();
    });

    if (!isHeatmapPointEditor) {
      const limitMin = Number(editorState.limitMin ?? 0);
      const limitMax = Number(editorState.limitMax ?? 100);
      const rangeSpan = limitMax - limitMin || 1;

      function clamp01(value) {
        return Math.min(Math.max(value, 0), 1);
      }

      function targetPercentFromValue(numVal) {
        if (!Number.isFinite(numVal)) return 0;
        return Math.round(clamp01((numVal - limitMin) / rangeSpan) * 100);
      }

      function valueFromTargetPercent(percent) {
        const t = clamp01(Number(percent) / 100);
        return limitMin + t * rangeSpan;
      }

      function updatePresetSelection(targetPercent) {
        const presetPercents = [0, 25, 50, 75, 100];
        let nearest = presetPercents[0];
        let nearestDistance = Math.abs(targetPercent - nearest);
        presetPercents.forEach(percent => {
          const distance = Math.abs(targetPercent - percent);
          if (distance < nearestDistance) {
            nearest = percent;
            nearestDistance = distance;
          }
        });
        presetButtons.forEach(button => {
          button.classList.toggle('active', Number(button.dataset.targetPct) === nearest);
        });
      }

      function updateColorPreview() {
        const numVal = parseFloat(shadow.getElementById('inp-value').value);
        const preview = shadow.getElementById('color-preview');
        if (preview) preview.style.background = csHslaColor(numVal, limitMin, limitMax);
      }

      function syncTargetUiFromNumeric(numVal) {
        const targetPercent = targetPercentFromValue(numVal);
        if (targetSlider) targetSlider.value = String(targetPercent);
        if (targetReadout) targetReadout.textContent = `${targetPercent}%`;
        updatePresetSelection(targetPercent);
        updateColorPreview();
      }

      function setNumericFromTargetPercent(targetPercent) {
        const nextValue = valueFromTargetPercent(targetPercent);
        valueInput.value = nextValue.toFixed(2);
        syncTargetUiFromNumeric(nextValue);
      }

      syncTargetUiFromNumeric(parseFloat(valueInput.value));

      valueInput.addEventListener('input', () => {
        syncTargetUiFromNumeric(parseFloat(valueInput.value));
      });
      targetSlider.addEventListener('input', () => {
        setNumericFromTargetPercent(Number(targetSlider.value));
      });
      presetButtons.forEach(button => {
        button.addEventListener('click', () => {
          setNumericFromTargetPercent(Number(button.dataset.targetPct));
        });
      });
    }

    closeButton.addEventListener('click', closePopover);
    cancelButton.addEventListener('click', closePopover);

    if (hasOverride) {
      resetButton.addEventListener('click', () => {
        log('Reset override requested', zoneKey);
        if (editorState.kind === 'heatmap-point') {
          resetHeatmapPointOverride(editorState);
        } else if (zoneEl) {
          resetZoneOverride(zoneEl, zoneKey, zoneId);
        } else {
          chrome.runtime.sendMessage({
            type: 'broadcastToTab',
            payload: {
              type: 'resetEditorOverride',
              editorState: { frameContextKey: editorState.frameContextKey, zoneKey, zoneId }
            }
          });
          closePopover();
          updateToolbar();
        }
      });
    }

    applyButton.addEventListener('click', () => {
      if (editorState.kind === 'heatmap-point') {
        const preset = getHeatmapPointLevelPreset(selectedPointLevel, heatmapLayer);
        const zoneName = zoneNameInput?.value?.trim() || '';
        log('Apply override requested', zoneKey, 'level=', preset.level, 'value=', preset.value);
        saveHeatmapPointOverride(editorState, preset.metric, preset.value, zoneName, {
          level: preset.level,
          centerColor: preset.centerColor
        });
        return;
      }

      const metric = metricInput.value.trim();
      const value = parseFloat(valueInput.value);
      const zoneName = zoneNameInput?.value?.trim() || '';
      const centerColor = centerColorInput?.value || defaultCenterColor;
      log('Apply override requested', zoneKey, 'metric=', metric, 'value=', value, 'name=', zoneName);
      if (!metric) return;
      if (zoneEl) {
        saveZoneOverride(zoneEl, zoneKey, zoneId, metric, value, zoneName, csTypeName);
      } else {
        chrome.runtime.sendMessage({
          type: 'broadcastToTab',
          payload: {
            type: 'applyEditorOverride',
            editorState: {
              frameContextKey: editorState.frameContextKey,
              zoneKey,
              zoneId,
              metric,
              value,
              zoneName,
              origMetric: editorState.origMetric,
              csMetricTypeName: csTypeName
            }
          }
        });
        closePopover();
        updateToolbar();
      }
    });

    // Keyboard shortcuts
    [zoneNameInput, metricInput, valueInput].forEach(inp => {
      if (!inp) return;
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          if (editorState.kind === 'heatmap-point') {
            const preset = getHeatmapPointLevelPreset(selectedPointLevel, heatmapLayer);
            const zoneName = zoneNameInput?.value?.trim() || '';
            saveHeatmapPointOverride(editorState, preset.metric, preset.value, zoneName, {
              level: preset.level,
              centerColor: preset.centerColor
            });
            return;
          }

          const metric = metricInput.value.trim();
          const value = parseFloat(valueInput.value);
          const zoneName = zoneNameInput?.value?.trim() || '';
          const centerColor = centerColorInput?.value || defaultCenterColor;
          log('Enter key apply attempt', zoneKey, 'metric=', metric, 'value=', value, 'name=', zoneName);
          if (!metric) return;
          if (zoneEl) {
            saveZoneOverride(zoneEl, zoneKey, zoneId, metric, value, zoneName, csTypeName);
          } else {
            chrome.runtime.sendMessage({
              type: 'broadcastToTab',
              payload: {
                type: 'applyEditorOverride',
                editorState: {
                  frameContextKey: editorState.frameContextKey,
                  zoneKey,
                  zoneId,
                  metric,
                  value,
                  zoneName,
                  origMetric: editorState.origMetric,
                  csMetricTypeName: csTypeName
                }
              }
            });
            closePopover();
            updateToolbar();
          }
        }
        if (e.key === 'Escape') closePopover();
      });
    });

    // Focus metric input
    setTimeout(() => {
      const inp = isHeatmapPointEditor
        ? (levelButtons[0] || applyButton)
        : metricInput;
      log('Attempting initial focus on editor input');
      if (!inp) return;
      inp.focus();
      if (typeof inp.select === 'function') inp.select();
    }, 0);
  }

  function closePopover() {
    if (popoverHost) {
      popoverHost.remove();
      popoverHost = null;
    }
    popoverShadow = null;
    popoverElement = null;
    popoverOpenedAt = 0;
  }

  async function saveZoneOverride(el, zoneKey, zoneId, metric, value, zoneName, csTypeName) {
    const paneKey = getPaneKey(el);
    const frameScope = window.frameElement ? `${window.frameElement.tagName}#${window.frameElement.id || ''}[${window.frameElement.className || ''}]` : 'top';
    // TEMP LOG: capture frameScope, paneKey, zoneKey, value
    if (window.__ZONING_DEBUG_LOG__ !== false) {
      console.log('[ZONING-DEBUG][saveZoneOverride]', {
        frameScope,
        paneKey,
        zoneKey,
        value,
        location: window.location.href
      });
    }
    const wrote = upsertZoneOverride(el, zoneKey, zoneId, metric, value, zoneName, csTypeName);
    if (wrote) await persistOverrides();
    closePopover();
    updateToolbar();
  }

  async function applyExposureGradientOverrides(options = {}) {
    if (!options.selectedMetricType) {
      refreshMetricTypeName();
    }
    const selectedMetricType = String(options.selectedMetricType || csMetricTypeName || '').trim();
    if (!isExposureRateMetric(selectedMetricType)) {
      return {
        ok: false,
        reason: 'Exposure Rate is not the selected metric',
        selectedMetricType
      };
    }

    const topBound = Number.isFinite(Number(options.topBound)) ? Number(options.topBound) : 100;
    const bottomBound = Number.isFinite(Number(options.bottomBound)) ? Number(options.bottomBound) : 20;
    const decimals = Number.isFinite(Number(options.decimals)) ? Math.max(0, Number(options.decimals)) : 1;
    const skipEdited = options.skipEdited !== false;
    const foldMode = options.foldMode === 'fixed' ? 'fixed' : 'viewport';
    const fixedFold = Number(options.foldPositionPx);
    const foldPositionPx = foldMode === 'fixed' && Number.isFinite(fixedFold)
      ? Math.max(0, fixedFold)
      : window.innerHeight;
    const perPaneBounds = options.perPaneBounds && typeof options.perPaneBounds === 'object'
      ? options.perPaneBounds
      : null;

    let zoneElements = getCandidateZoneElements();
    if (zoneElements.length === 0) {
      syncZoneWatchers();
      await new Promise(resolve => requestAnimationFrame(resolve));
      zoneElements = getCandidateZoneElements();
    }

    const paneRows = new Map();
    zoneElements.forEach((el, idx) => {
      const zoneId = el.getAttribute('id') || '';
      const paneKey = getPaneKey(el) || 'pane:unknown';
      const zoneKey = getZoneKey(el) || (zoneId ? `${paneKey}::${zoneId}` : '');
      if (!zoneKey) return;

      const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
      const y = rect && Number.isFinite(rect.top) && Number.isFinite(rect.height)
        ? (rect.top + rect.height / 2)
        : Number.NaN;

      paneRows.set(paneKey, paneRows.get(paneKey) || []);
      paneRows.get(paneKey).push({
        el,
        zoneId,
        zoneKey,
        y,
        order: idx
      });
    });

    let applied = 0;
    let skippedEdited = 0;
    let considered = 0;
    const paneStats = [];

    for (const [paneKey, rows] of paneRows.entries()) {
      if (!rows.length) continue;

      rows.sort((a, b) => {
        const aY = Number.isFinite(a.y) ? a.y : Number.POSITIVE_INFINITY;
        const bY = Number.isFinite(b.y) ? b.y : Number.POSITIVE_INFINITY;
        if (aY !== bY) return aY - bY;
        return a.order - b.order;
      });

      const paneTop = Number.isFinite(Number(perPaneBounds?.[paneKey]?.top))
        ? Number(perPaneBounds[paneKey].top)
        : topBound;
      const paneBottom = Number.isFinite(Number(perPaneBounds?.[paneKey]?.bottom))
        ? Number(perPaneBounds[paneKey].bottom)
        : bottomBound;

      let paneApplied = 0;
      let paneSkippedEdited = 0;

      const hasFoldAnchors = rows.some(row => Number.isFinite(row.y));
      const maxBelowFoldY = rows.reduce((max, row) => {
        if (!Number.isFinite(row.y) || row.y <= foldPositionPx) return max;
        return Math.max(max, row.y);
      }, Number.NEGATIVE_INFINITY);

      rows.forEach((row, index) => {
        considered += 1;
        if (skipEdited && getOverrideForElement(row.el)) {
          skippedEdited += 1;
          paneSkippedEdited += 1;
          return;
        }

        let numericValue = paneTop;
        if (Number.isFinite(row.y) && row.y > foldPositionPx && Number.isFinite(maxBelowFoldY) && maxBelowFoldY > foldPositionPx) {
          const distanceRatio = (row.y - foldPositionPx) / (maxBelowFoldY - foldPositionPx);
          const normalizedDistance = Math.min(Math.max(distanceRatio, 0), 1);
          numericValue = paneTop + normalizedDistance * (paneBottom - paneTop);
        } else if (!hasFoldAnchors) {
          // Fallback for layouts where element geometry is unavailable.
          const denom = Math.max(1, rows.length - 1);
          const normalized = rows.length === 1 ? 0 : index / denom;
          const score = 1 - normalized;
          numericValue = paneBottom + score * (paneTop - paneBottom);
        }

        const displayMetric = formatPercent(numericValue, decimals);

        const wrote = upsertZoneOverride(
          row.el,
          row.zoneKey,
          row.zoneId,
          displayMetric,
          numericValue,
          '',
          selectedMetricType
        );

        if (wrote) {
          applied += 1;
          paneApplied += 1;
        }
      });

      paneStats.push({
        paneKey,
        zones: rows.length,
        applied: paneApplied,
        skippedEdited: paneSkippedEdited,
        foldPositionPx,
        topBound: paneTop,
        bottomBound: paneBottom
      });
    }

    if (applied > 0) {
      if (options.persistMode === 'merge') await persistOverridesMerged();
      else await persistOverrides();
      syncZoneWatchers();
      updateToolbar();
    }

    return {
      ok: true,
      selectedMetricType,
      detectedZones: zoneElements.length,
      panes: paneStats.length,
      considered,
      applied,
      skippedEdited,
      paneStats
    };
  }

  function sendBroadcastToTab(payload) {
    return new Promise(resolve => {
      try {
        chrome.runtime.sendMessage({ type: 'broadcastToTab', payload }, _resp => {
          void chrome.runtime.lastError;
          resolve();
        });
      } catch (_) {
        resolve();
      }
    });
  }

  function readExposureResponses() {
    return new Promise(resolve => {
      chrome.storage.local.get('csZoningExposureResponses', result => {
        resolve(result.csZoningExposureResponses || {});
      });
    });
  }

  function writeExposureResponses(nextMap) {
    return new Promise(resolve => {
      chrome.storage.local.set({ csZoningExposureResponses: nextMap || {} }, resolve);
    });
  }

  async function appendExposureResponse(requestId, response) {
    if (!requestId) return;
    const all = await readExposureResponses();
    const byRequest = all[requestId] && typeof all[requestId] === 'object' ? all[requestId] : {};
    byRequest[frameContextKey] = {
      ...(response || {}),
      frameContextKey,
      at: Date.now()
    };
    all[requestId] = byRequest;
    await writeExposureResponses(all);
  }

  async function clearExposureResponses(requestId) {
    if (!requestId) return;
    const all = await readExposureResponses();
    if (!all[requestId]) return;
    delete all[requestId];
    await writeExposureResponses(all);
  }

  async function getExposureResponsesForRequest(requestId) {
    if (!requestId) return [];
    const all = await readExposureResponses();
    const rows = all[requestId] && typeof all[requestId] === 'object'
      ? Object.values(all[requestId])
      : [];
    return rows.filter(Boolean);
  }

  function dispatchExposureRequestToFrames(options = {}) {
    return new Promise(resolve => {
      const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      const payload = {
        requestId,
        originFrameContextKey: frameContextKey,
        options: {
          ...options,
          persistMode: 'merge'
        }
      };

      chrome.storage.local.set({ csZoningExposureRequest: payload }, () => {
        resolve(payload);
      });
    });
  }

  async function applyExposureGradientAcrossFrames(options = {}) {
    const beforeSnapshot = new Map(
      Object.entries(overrides).map(([key, ov]) => [key, `${ov?.metric || ''}|${ov?.value ?? ''}`])
    );

    const localResult = await applyExposureGradientOverrides(options);
    const debug = {
      requestId: '',
      local: {
        detectedZones: localResult.detectedZones || 0,
        considered: localResult.considered || 0,
        applied: localResult.applied || 0,
        skippedEdited: localResult.skippedEdited || 0
      },
      remote: {
        respondedFrames: 0,
        detectedZones: 0,
        considered: 0,
        applied: 0,
        skippedEdited: 0
      }
    };

    if (isTopFrame) {
      const selectedMetricType = localResult.selectedMetricType || csMetricTypeName || '';
      const dispatch = await dispatchExposureRequestToFrames({
        ...options,
        selectedMetricType
      });
      debug.requestId = dispatch.requestId || '';

      // Give subframes a moment to persist then refresh top-frame view/state.
      await new Promise(resolve => setTimeout(resolve, 260));
      const remoteResponses = await getExposureResponsesForRequest(debug.requestId);
      debug.remote.respondedFrames = remoteResponses.length;
      remoteResponses.forEach(row => {
        debug.remote.detectedZones += Number(row.detectedZones) || 0;
        debug.remote.considered += Number(row.considered) || 0;
        debug.remote.applied += Number(row.applied) || 0;
        debug.remote.skippedEdited += Number(row.skippedEdited) || 0;
      });
      await loadOverrides();
      applyAllOverrides();
      updateToolbar();
      clearExposureResponses(debug.requestId);
    }

    const changed = Object.entries(overrides).reduce((count, [key, ov]) => {
      const sig = `${ov?.metric || ''}|${ov?.value ?? ''}`;
      return count + (beforeSnapshot.get(key) !== sig ? 1 : 0);
    }, 0);

    return {
      ...localResult,
      changed,
      debug
    };
  }

  async function resetZoneOverride(el, zoneKey, zoneId) {
    const existing = getOverrideForElement(el);
    const orig = existing?.override || null;
    if (orig && orig.origMetric !== undefined) {
      // Restore to pre-edit state
      el.setAttribute('metric', orig.origMetric);
      if (orig.origValue !== undefined) el.setAttribute('value', String(orig.origValue));
      else el.removeAttribute('value');
      if (orig.origColor !== undefined) el.setAttribute('color', String(orig.origColor));
      else el.removeAttribute('color');
    } else if (el.hasAttribute('data-cs-demo-orig-metric')) {
      const origMetric = String(el.getAttribute('data-cs-demo-orig-metric') || '');
      const hasOrigValue = el.hasAttribute('data-cs-demo-orig-value');
      const hasOrigColor = el.hasAttribute('data-cs-demo-orig-color');
      el.setAttribute('metric', origMetric);
      if (hasOrigValue) el.setAttribute('value', String(el.getAttribute('data-cs-demo-orig-value') || ''));
      else el.removeAttribute('value');
      if (hasOrigColor) el.setAttribute('color', String(el.getAttribute('data-cs-demo-orig-color') || ''));
      else el.removeAttribute('color');
    }
    el.removeAttribute('data-cs-demo-orig-metric');
    el.removeAttribute('data-cs-demo-orig-value');
    el.removeAttribute('data-cs-demo-orig-color');
    clearEditedStyle(el);
    if (existing) {
      delete overrides[existing.key];
      await persistOverrides();
    } else if (zoneKey) {
      // Legacy cleanup
      delete overrides[zoneKey];
      if (zoneId && zoneId !== zoneKey) delete overrides[zoneId];
      await persistOverrides();
    }
    closePopover();
    updateToolbar();
  }

  function normalizeScenarioState(raw) {
    if (!raw || typeof raw !== 'object') {
      return { overrides: {}, heatmapPoints: {} };
    }

    // Backward compatibility: older callers pass only the zoning override map.
    if (!Object.prototype.hasOwnProperty.call(raw, 'overrides')
      && !Object.prototype.hasOwnProperty.call(raw, 'heatmapPoints')) {
      return { overrides: { ...raw }, heatmapPoints: {} };
    }

    const normalizedHeatmapPoints = {};
    Object.entries(raw.heatmapPoints || {}).forEach(([key, point]) => {
      const nextPoint = normalizeHeatmapPointRecord(point);
      if (!nextPoint) return;
      normalizedHeatmapPoints[key] = nextPoint;
    });

    return {
      overrides: { ...(raw.overrides || {}) },
      heatmapPoints: normalizedHeatmapPoints
    };
  }

  function buildScenarioStateSnapshot() {
    return {
      overrides: { ...overrides },
      heatmapPoints: { ...heatmapPointOverrides }
    };
  }

  async function loadScenarioOverrides(nextScenarioState, broadcastToFrames = true) {
    const scenarioState = normalizeScenarioState(nextScenarioState);
    overrides = { ...scenarioState.overrides };
    heatmapPointOverrides = { ...scenarioState.heatmapPoints };
    await persistOverrides();
    await persistHeatmapPointOverrides();
    syncZoneWatchers();
    applyAllOverrides();
    renderHeatmapPointOverlays();
    updateToolbar();

    if (broadcastToFrames && isTopFrame) {
      chrome.runtime.sendMessage({
        type: 'broadcastToTab',
        payload: {
          type: 'applyScenarioOverrides',
          scenario: buildScenarioStateSnapshot()
        }
      });
    }

    return {
      applied: Object.keys(overrides).length + Object.keys(heatmapPointOverrides).length,
      zoningApplied: Object.keys(overrides).length,
      heatmapApplied: Object.keys(heatmapPointOverrides).length,
      key: getUrlKey()
    };
  }

  function readLayerScenarios() {
    return new Promise(resolve => {
      chrome.storage.local.get('csZoningLayerScenarios', result => {
        resolve(result.csZoningLayerScenarios || {});
      });
    });
  }

  function writeLayerScenarios(nextMap) {
    return new Promise(resolve => {
      chrome.storage.local.set({ csZoningLayerScenarios: nextMap || {} }, resolve);
    });
  }

  function getLayerScenarioNamesForCurrentPage(allScenarios) {
    return Object.entries(allScenarios || {})
      .filter(([, scenario]) => scenario && scenario.url === getUrlKey())
      .sort((a, b) => (Number(b[1]?.updatedAt) || 0) - (Number(a[1]?.updatedAt) || 0))
      .map(([name]) => name);
  }

  function getLayerKeys() {
    return [...HEATMAP_LAYER_KEYS];
  }

  function getLayerScenarioSummary(scenario) {
    const layerKeys = getLayerKeys();
    const layers = scenario?.layers || {};
    const overriddenLayers = layerKeys.filter(layerKey => {
      const count = Object.keys(layers[layerKey]?.overrides || {}).length;
      return count > 0;
    });
    const preservedLayers = layerKeys.filter(layerKey => !overriddenLayers.includes(layerKey));
    return {
      overriddenLayers,
      preservedLayers
    };
  }

  async function saveCurrentOverridesToLayerScenario(name, layerKey) {
    const scenarioName = String(name || '').trim();
    const resolvedLayer = String(layerKey || '').trim().toLowerCase();
    if (!scenarioName || !getLayerKeys().includes(resolvedLayer)) {
      return { ok: false, reason: 'Missing scenario name or layer' };
    }

    const all = await readLayerScenarios();
    const existing = all[scenarioName] && typeof all[scenarioName] === 'object'
      ? all[scenarioName]
      : {};

    const nextScenario = {
      ...existing,
      url: getUrlKey(),
      createdAt: existing.createdAt || Date.now(),
      updatedAt: Date.now(),
      layers: {
        ...(existing.layers || {}),
        [resolvedLayer]: {
          updatedAt: Date.now(),
          overrides: { ...overrides }
        }
      }
    };

    all[scenarioName] = nextScenario;
    await writeLayerScenarios(all);

    return {
      ok: true,
      scenarioName,
      layerKey: resolvedLayer,
      savedOverrides: Object.keys(overrides).length
    };
  }

  async function applyLayerScenarioBlend(name) {
    const scenarioName = String(name || '').trim();
    if (!scenarioName) return { ok: false, reason: 'Scenario name is required' };

    const all = await readLayerScenarios();
    const scenario = all[scenarioName];
    if (!scenario || scenario.url !== getUrlKey()) {
      return { ok: false, reason: 'Scenario not found for this page' };
    }

    const layerKeys = getLayerKeys();
    const mergedFromLayers = {};
    const activeLayers = [];
    layerKeys.forEach(layerKey => {
      const layerOverrides = scenario.layers?.[layerKey]?.overrides || {};
      if (Object.keys(layerOverrides).length > 0) {
        Object.assign(mergedFromLayers, layerOverrides);
        activeLayers.push(layerKey);
      }
    });

    if (activeLayers.length === 0) {
      return { ok: false, reason: 'Scenario has no layer override data' };
    }

    const beforeCount = Object.keys(overrides).length;
    const nextOverrides = { ...overrides, ...mergedFromLayers };
    overrides = nextOverrides;

    await persistOverrides();
    syncZoneWatchers();
    applyAllOverrides();
    updateToolbar();

    if (isTopFrame) {
      chrome.runtime.sendMessage({
        type: 'broadcastToTab',
        payload: { type: 'applyScenarioOverrides', overrides: { ...overrides } }
      });
    }

    return {
      ok: true,
      scenarioName,
      activeLayers,
      beforeCount,
      afterCount: Object.keys(overrides).length,
      importedOverrides: Object.keys(mergedFromLayers).length
    };
  }

  async function renameLayerScenario(oldName, newName) {
    const fromName = String(oldName || '').trim();
    const toName = String(newName || '').trim();
    if (!fromName || !toName) {
      return { ok: false, reason: 'Both current and new names are required' };
    }
    if (fromName === toName) {
      return { ok: false, reason: 'New name must be different' };
    }

    const all = await readLayerScenarios();
    const source = all[fromName];
    if (!source || source.url !== getUrlKey()) {
      return { ok: false, reason: 'Scenario not found for this page' };
    }
    if (all[toName] && all[toName].url === getUrlKey()) {
      return { ok: false, reason: 'A scenario with that name already exists' };
    }

    all[toName] = {
      ...source,
      updatedAt: Date.now()
    };
    delete all[fromName];
    await writeLayerScenarios(all);

    return { ok: true, oldName: fromName, newName: toName };
  }

  async function deleteLayerScenario(name) {
    const scenarioName = String(name || '').trim();
    if (!scenarioName) {
      return { ok: false, reason: 'Scenario name is required' };
    }

    const all = await readLayerScenarios();
    const source = all[scenarioName];
    if (!source || source.url !== getUrlKey()) {
      return { ok: false, reason: 'Scenario not found for this page' };
    }

    delete all[scenarioName];
    await writeLayerScenarios(all);
    return { ok: true, scenarioName };
  }

  // ─── TOOLBAR ─────────────────────────────────────────────────────────────

  function createToolbar() {
    if (!isTopFrame) return;
    if (toolbarHost) return;

    toolbarHost = document.createElement('div');
    toolbarHost.id = 'cs-demo-toolbar-host';
    document.body.appendChild(toolbarHost);
    toolbarShadow = toolbarHost.attachShadow({ mode: 'open' });

    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`
      .toolbar {
        position: fixed;
        top: 18px;
        right: 20px;
        z-index: 2147483646;
        display: flex;
        align-items: center;
        gap: 6px;
        background: linear-gradient(135deg, #1c1263 0%, #2c2c8c 100%);
        border-radius: 28px;
        padding: 8px 14px 8px 12px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.35), 0 1px 4px rgba(0,0,0,0.2);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
        font-size: 12px;
        color: #fff;
        user-select: none;
        opacity: 0.95;
        transition: opacity 0.2s, transform 0.2s;
        cursor: default;
      }
      .toolbar:hover { opacity: 1; }
      .toolbar-label {
        font-weight: 800;
        font-size: 11px;
        letter-spacing: 0.8px;
        text-transform: uppercase;
        color: rgba(255,255,255,0.65);
        padding-right: 10px;
        border-right: 1px solid rgba(255,255,255,0.2);
        margin-right: 2px;
      }
      .btn {
        padding: 5px 12px;
        border-radius: 20px;
        font-size: 11px;
        font-weight: 700;
        cursor: pointer;
        border: none;
        font-family: inherit;
        transition: background 0.15s, transform 0.1s;
        white-space: nowrap;
        letter-spacing: 0.3px;
      }
      .btn:active { transform: scale(0.96); }
      .btn-edit-off {
        background: rgba(255,255,255,0.12);
        color: rgba(255,255,255,0.7);
      }
      .btn-edit-off:hover { background: rgba(255,255,255,0.22); color: #fff; }
      .btn-edit-on {
        background: #5959dc;
        color: #fff;
        box-shadow: 0 0 0 2px rgba(255,255,255,0.3);
      }
      .btn-edit-on:hover { background: #6a6ae8; }
      .btn-ghost {
        background: rgba(255,255,255,0.08);
        color: rgba(255,255,255,0.6);
      }
      .btn-ghost:hover { background: rgba(255,255,255,0.18); color: #fff; }
      .badge {
        font-size: 10px;
        background: #ff9955;
        border-radius: 10px;
        padding: 2px 7px;
        font-weight: 800;
        color: #fff;
        display: none;
        cursor: pointer;
      }
      .badge.visible { display: inline; }
    `);
    toolbarShadow.adoptedStyleSheets = [sheet];

    const toolbar = document.createElement('div');
    toolbar.className = 'toolbar';
    toolbar.id = 'toolbar';
    toolbar.innerHTML = `
      <span class="toolbar-label">🎭 CS Demo</span>
      <button class="btn btn-edit-off" id="btn-edit">Edit Zones</button>
      <span class="badge" id="badge">0 edits</span>
      <button class="btn btn-ghost" id="btn-scenarios">Scenarios</button>
      <button class="btn btn-ghost" id="btn-reset-all">Reset All</button>
      <button class="btn btn-ghost" id="btn-advanced">Advanced</button>
    `;
    toolbarShadow.appendChild(toolbar);

    toolbarShadow.getElementById('btn-edit').addEventListener('click', () => setEditMode(!editMode));
    toolbarShadow.getElementById('btn-reset-all').addEventListener('click', resetAll);
    toolbarShadow.getElementById('btn-scenarios').addEventListener('click', openScenariosMenu);
    toolbarShadow.getElementById('btn-advanced').addEventListener('click', openExposurePanel);
    toolbarShadow.getElementById('badge').addEventListener('click', openEditsMenu);

    applyUiVisibility();
    updateToolbar();
  }

  function updateToolbar() {
    if (!toolbarShadow) return;
    const btn = toolbarShadow.getElementById('btn-edit');
    const badge = toolbarShadow.getElementById('badge');
    if (!btn || !badge) return;

    if (editMode) {
      btn.textContent = '✏️ Editing ON';
      btn.className = 'btn btn-edit-on';
    } else {
      btn.textContent = 'Edit Zones';
      btn.className = 'btn btn-edit-off';
    }
    const count = getTotalOverrideCount();
    badge.textContent = `${count} edit${count !== 1 ? 's' : ''}`;
    badge.className = `badge${count > 0 ? ' visible' : ''}`;
  }

  // ─── RESET ALL ───────────────────────────────────────────────────────────

  async function resetAllInFrame() {
    // Reset zones and heatmap points in this frame
    const zoneEls = getAllZoneElements();
    zoneEls.forEach(el => {
      const existing = getOverrideForElement(el);
      if (existing) {
        const orig = existing.override;
        if (orig.origMetric !== undefined) {
          el.setAttribute('metric', orig.origMetric);
          if (orig.origValue !== undefined) el.setAttribute('value', String(orig.origValue));
          if (orig.origColor !== undefined) el.setAttribute('color', String(orig.origColor));
          else el.removeAttribute('color');
        }
      } else if (el.hasAttribute('data-cs-demo-orig-metric')) {
        const origMetric = String(el.getAttribute('data-cs-demo-orig-metric') || '');
        const hasOrigValue = el.hasAttribute('data-cs-demo-orig-value');
        const hasOrigColor = el.hasAttribute('data-cs-demo-orig-color');
        el.setAttribute('metric', origMetric);
        if (hasOrigValue) el.setAttribute('value', String(el.getAttribute('data-cs-demo-orig-value') || ''));
        else el.removeAttribute('value');
        if (hasOrigColor) el.setAttribute('color', String(el.getAttribute('data-cs-demo-orig-color') || ''));
        else el.removeAttribute('color');
      }

      el.removeAttribute('data-cs-demo-orig-metric');
      el.removeAttribute('data-cs-demo-orig-value');
      el.removeAttribute('data-cs-demo-orig-color');
      clearEditedStyle(el);
    });

    overrides = {};
    heatmapPointOverrides = {};
    renderHeatmapPointOverlays();

    // Re-initialize zone watchers cleanly
    zoneObservers.forEach(entry => {
      entry.observer.disconnect();
      entry.element.removeEventListener('click', onZoneElementClick, true);
    });
    zoneObservers.clear();
    syncZoneWatchers();
  }

  async function resetAll() {
    const count = getTotalOverrideCount();
    if (count === 0) return;
    if (!confirm(`Reset all ${count} override${count !== 1 ? 's' : ''} on this page?`)) return;

    if (isTopFrame) {
      // Broadcast to all frames (including this one) to reset their zones
      await new Promise(resolve => {
        chrome.runtime.sendMessage({
          type: 'broadcastToTab',
          payload: { type: 'resetAllFrames' }
        }, () => {
          void chrome.runtime.lastError;
          resolve(true);
        });
      });
      // Also reset locally in case this top frame has zones
      await resetAllInFrame();
      await persistOverrides();
      await persistHeatmapPointOverrides();
    } else {
      // Subframe: just reset locally
      await resetAllInFrame();
    }

    updateToolbar();
  }

  function openExposurePanel() {
    if (!uiVisible) return;

    // Close other panels
    const scenariosHost = document.getElementById('cs-demo-scenarios-host');
    const editsHost = document.getElementById('cs-demo-edits-host');
    if (scenariosHost) scenariosHost.remove();
    if (editsHost) editsHost.remove();

    if (document.getElementById('cs-demo-exposure-host')) {
      document.getElementById('cs-demo-exposure-host').remove();
      return;
    }

    const host = document.createElement('div');
    host.id = 'cs-demo-exposure-host';
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });

    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`
      .panel {
        position: fixed;
        top: 64px;
        right: 20px;
        z-index: 2147483645;
        width: 300px;
        background: #fff;
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.2), 0 2px 8px rgba(0,0,0,0.1);
        border: 1px solid #e0e0f0;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
        font-size: 13px;
        color: #1a1a2e;
        overflow: hidden;
      }
      .panel-header {
        background: linear-gradient(135deg, #1c1263, #2c2c8c);
        color: #fff;
        padding: 12px 16px;
        font-weight: 700;
        font-size: 13px;
      }
      .tabs {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0;
        border-bottom: 1px solid #ececf6;
        background: #f8f8ff;
      }
      .tab-btn {
        border: none;
        border-right: 1px solid #ececf6;
        background: transparent;
        color: #63638a;
        padding: 10px 8px;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.4px;
        text-transform: uppercase;
        cursor: pointer;
      }
      .tab-btn:last-child { border-right: none; }
      .tab-btn.active {
        background: #fff;
        color: #2c2c8c;
        box-shadow: inset 0 -2px 0 #2c2c8c;
      }
      .tab-content {
        display: none;
        padding: 14px 16px;
      }
      .tab-content.active { display: block; }
      .section-label {
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.6px;
        color: #888;
        margin-bottom: 8px;
      }
      .row { display: flex; gap: 6px; margin-bottom: 10px; }
      .inp {
        flex: 1;
        padding: 7px 10px;
        border: 1.5px solid #d0d0e0;
        border-radius: 6px;
        font-size: 12px;
        font-family: inherit;
        outline: none;
        color: #1a1a2e;
        background: #fafafe;
      }
      .inp:focus { border-color: #5959dc; }
      .btn {
        padding: 7px 12px;
        border-radius: 6px;
        font-size: 11px;
        font-weight: 700;
        cursor: pointer;
        border: none;
        font-family: inherit;
        transition: background 0.15s;
      }
      .btn-apply { background: #2c2c8c; color: #fff; width: 100%; }
      .btn-apply:hover { background: #3c3cac; }
      .hint { font-size: 11px; color: #666; margin-bottom: 8px; }
      .pane-bounds {
        display: none;
        max-height: 140px;
        overflow: auto;
        border: 1px solid #eee;
        border-radius: 6px;
        padding: 6px;
        margin-bottom: 10px;
      }
      .pane-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 56px 56px;
        gap: 6px;
        align-items: center;
        margin-bottom: 6px;
      }
      .pane-name {
        font-size: 10px;
        color: #666;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .chk-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
        font-size: 11px;
        color: #666;
      }
      .fold-row {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 10px;
      }
      .fold-row .inp {
        width: 88px;
        flex: 0 0 88px;
      }
      .divider {
        border: none;
        border-top: 1px solid #eee;
        margin: 12px 0;
      }
      .tiny {
        font-size: 10px;
        color: #777;
        line-height: 1.35;
      }
    `);
    shadow.adoptedStyleSheets = [sheet];

    const panel = document.createElement('div');
    panel.className = 'panel';

    const paneKeys = Array.from(
      new Set(getCandidateZoneElements().map(el => getPaneKey(el)).filter(Boolean))
    ).sort();
    const defaultFoldPositionPx = Math.max(0, Math.round(window.innerHeight || 0));

    const escHtml = str => String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    panel.innerHTML = `
      <div class="panel-header">⚙️ Advanced</div>
      <div class="tabs">
        <button class="tab-btn active" id="tab-exposure" type="button">Exposure</button>
        <button class="tab-btn" id="tab-heatmaps" type="button">Heatmaps</button>
      </div>
      <div class="tab-content active" id="tab-content-exposure">
        <div class="section-label">Exposure Auto-Seed Bounds</div>
        <div class="row">
          <input id="inp-exp-top" class="inp" type="number" step="0.1" value="100" placeholder="Top %">
          <input id="inp-exp-bottom" class="inp" type="number" step="0.1" value="20" placeholder="Bottom %">
        </div>
        <div class="chk-row">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
            <input type="checkbox" id="chk-exp-fixed-fold">
            Use fixed fold position
          </label>
        </div>
        <div class="fold-row">
          <input id="inp-exp-fixed-fold" class="inp" type="number" step="1" min="0" value="${defaultFoldPositionPx}" placeholder="Fold px" disabled>
          <span id="txt-exp-viewport" class="hint" style="margin:0">Current viewport: ${defaultFoldPositionPx}px</span>
        </div>
        <div class="chk-row">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
            <input type="checkbox" id="chk-exp-skip-edited" checked>
            Skip already edited zones
          </label>
        </div>
        <div class="chk-row">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
            <input type="checkbox" id="chk-exp-per-pane">
            Use per-pane bounds
          </label>
        </div>
        <div id="exp-pane-bounds" class="pane-bounds">
          ${paneKeys.length === 0
            ? '<div class="hint" style="margin-bottom:0">No panes detected</div>'
            : paneKeys.map((paneKey, idx) => `
              <div class="pane-row">
                <div class="pane-name" title="${escHtml(paneKey)}">Pane ${idx + 1}</div>
                <input class="inp exp-pane-top" data-pane="${escHtml(paneKey)}" type="number" step="0.1" value="100" style="padding:4px 6px;font-size:11px;">
                <input class="inp exp-pane-bottom" data-pane="${escHtml(paneKey)}" type="number" step="0.1" value="20" style="padding:4px 6px;font-size:11px;">
              </div>
            `).join('')
          }
        </div>
        <div class="hint">Uses current viewport as fold by default: zones above fold get Top %, then values decrease toward Bottom % below fold.</div>
        <button class="btn btn-apply" id="btn-auto-exposure">Apply Exposure Gradient</button>
      </div>
      <div class="tab-content" id="tab-content-heatmaps">
        <div class="section-label">Heatmap Layer Scenarios</div>
        <div class="hint">Each scenario can override one or more layers. If a layer has no data in the scenario, existing on-page values are preserved.</div>
        <div class="row">
          <input id="inp-hm-scenario-name" class="inp" type="text" maxlength="60" placeholder="Scenario name">
        </div>
        <div class="row">
          <select id="sel-hm-layer" class="inp">
            <option value="clicks">Clicks</option>
            <option value="moves">Moves</option>
            <option value="scrolls">Scrolls</option>
            <option value="attention">Attention</option>
          </select>
        </div>
        <div class="row">
          <button class="btn" id="btn-hm-save-layer" style="width:100%;background:#f1f1ff;color:#2c2c8c;border:1px solid #d9daf5;">Save Current Overrides To Layer</button>
        </div>
        <div class="row">
          <select id="sel-hm-scenario-apply" class="inp"></select>
        </div>
        <div class="row">
          <button class="btn btn-apply" id="btn-hm-apply-blend">Apply Scenario Blend</button>
        </div>
        <div class="row">
          <button class="btn" id="btn-hm-rename" style="flex:1;background:#f7f7fc;color:#4a4a64;border:1px solid #dbdbea;">Rename Selected</button>
          <button class="btn" id="btn-hm-delete" style="flex:1;background:#fff0f0;color:#cc3333;border:1px solid #ffcccc;">Delete Selected</button>
        </div>
        <hr class="divider">
        <div class="tiny" id="txt-hm-summary">Overrides: none | Preserves: Clicks, Moves, Scrolls, Attention</div>
      </div>
    `;

    shadow.innerHTML = '';
    shadow.adoptedStyleSheets = [sheet];
    shadow.appendChild(panel);

    const chkPerPane = shadow.getElementById('chk-exp-per-pane');
    const paneBoundsHost = shadow.getElementById('exp-pane-bounds');
    const chkFixedFold = shadow.getElementById('chk-exp-fixed-fold');
    const inpFixedFold = shadow.getElementById('inp-exp-fixed-fold');
    const viewportHint = shadow.getElementById('txt-exp-viewport');
    const tabExposure = shadow.getElementById('tab-exposure');
    const tabHeatmaps = shadow.getElementById('tab-heatmaps');
    const tabContentExposure = shadow.getElementById('tab-content-exposure');
    const tabContentHeatmaps = shadow.getElementById('tab-content-heatmaps');

    const hmScenarioNameInput = shadow.getElementById('inp-hm-scenario-name');
    const hmLayerSelect = shadow.getElementById('sel-hm-layer');
    const hmSaveLayerButton = shadow.getElementById('btn-hm-save-layer');
    const hmScenarioApplySelect = shadow.getElementById('sel-hm-scenario-apply');
    const hmApplyBlendButton = shadow.getElementById('btn-hm-apply-blend');
    const hmRenameButton = shadow.getElementById('btn-hm-rename');
    const hmDeleteButton = shadow.getElementById('btn-hm-delete');
    const hmSummaryText = shadow.getElementById('txt-hm-summary');

    function setAdvancedTab(tabId) {
      const isExposure = tabId === 'exposure';
      tabExposure?.classList.toggle('active', isExposure);
      tabHeatmaps?.classList.toggle('active', !isExposure);
      tabContentExposure?.classList.toggle('active', isExposure);
      tabContentHeatmaps?.classList.toggle('active', !isExposure);
    }

    tabExposure?.addEventListener('click', () => setAdvancedTab('exposure'));
    tabHeatmaps?.addEventListener('click', () => setAdvancedTab('heatmaps'));

    async function refreshHeatmapScenarioUi(preferredName = '') {
      const all = await readLayerScenarios();
      const names = getLayerScenarioNamesForCurrentPage(all);

      if (hmScenarioApplySelect) {
        hmScenarioApplySelect.innerHTML = names.length
          ? names.map(name => `<option value="${escHtml(name)}">${escHtml(name)}</option>`).join('')
          : '<option value="">No heatmap scenarios yet</option>';
      }

      if (preferredName && names.includes(preferredName)) {
        hmScenarioApplySelect.value = preferredName;
      }

      const selectedName = hmScenarioApplySelect?.value || '';
      const selectedScenario = selectedName ? all[selectedName] : null;
      const summary = getLayerScenarioSummary(selectedScenario || {});

      const pretty = value => value.charAt(0).toUpperCase() + value.slice(1);
      const overridden = summary.overriddenLayers.length
        ? summary.overriddenLayers.map(pretty).join(', ')
        : 'none';
      const preserved = summary.preservedLayers.length
        ? summary.preservedLayers.map(pretty).join(', ')
        : 'none';

      if (hmSummaryText) {
        hmSummaryText.textContent = `Overrides: ${overridden} | Preserves: ${preserved}`;
      }
    }

    hmScenarioApplySelect?.addEventListener('change', () => {
      refreshHeatmapScenarioUi(hmScenarioApplySelect.value);
    });

    hmSaveLayerButton?.addEventListener('click', async () => {
      const scenarioName = String(hmScenarioNameInput?.value || '').trim();
      const layerKey = String(hmLayerSelect?.value || '').trim();
      if (!scenarioName) {
        alert('Enter a heatmap scenario name first.');
        return;
      }

      const result = await saveCurrentOverridesToLayerScenario(scenarioName, layerKey);
      if (!result.ok) {
        alert(`Could not save layer data: ${result.reason}`);
        return;
      }

      await refreshHeatmapScenarioUi(result.scenarioName);
      alert(`Saved ${result.savedOverrides} overrides to ${result.scenarioName} (${result.layerKey}).`);
    });

    hmApplyBlendButton?.addEventListener('click', async () => {
      const scenarioName = String(hmScenarioApplySelect?.value || '').trim();
      if (!scenarioName) {
        alert('Select a heatmap scenario to apply.');
        return;
      }

      const result = await applyLayerScenarioBlend(scenarioName);
      if (!result.ok) {
        alert(`Could not apply scenario blend: ${result.reason}`);
        return;
      }

      await refreshHeatmapScenarioUi(result.scenarioName);
      alert(`Applied heatmap blend from ${result.scenarioName}: ${result.activeLayers.join(', ')}.`);
    });

    hmRenameButton?.addEventListener('click', async () => {
      const selectedName = String(hmScenarioApplySelect?.value || '').trim();
      const nextName = String(hmScenarioNameInput?.value || '').trim();
      if (!selectedName) {
        alert('Select a scenario to rename.');
        return;
      }
      if (!nextName) {
        alert('Enter a new scenario name in the name field.');
        return;
      }

      const result = await renameLayerScenario(selectedName, nextName);
      if (!result.ok) {
        alert(`Could not rename scenario: ${result.reason}`);
        return;
      }

      await refreshHeatmapScenarioUi(result.newName);
      alert(`Renamed scenario: ${result.oldName} → ${result.newName}.`);
    });

    hmDeleteButton?.addEventListener('click', async () => {
      const selectedName = String(hmScenarioApplySelect?.value || '').trim();
      if (!selectedName) {
        alert('Select a scenario to delete.');
        return;
      }
      if (!confirm(`Delete heatmap scenario "${selectedName}"?`)) return;

      const result = await deleteLayerScenario(selectedName);
      if (!result.ok) {
        alert(`Could not delete scenario: ${result.reason}`);
        return;
      }

      await refreshHeatmapScenarioUi();
      alert(`Deleted heatmap scenario: ${result.scenarioName}.`);
    });

    refreshHeatmapScenarioUi();

    function updateViewportHint() {
      const px = Math.max(0, Math.round(window.innerHeight || 0));
      if (viewportHint) viewportHint.textContent = `Current viewport: ${px}px`;
      return px;
    }

    updateViewportHint();

    chkPerPane?.addEventListener('change', () => {
      paneBoundsHost.style.display = chkPerPane.checked ? 'block' : 'none';
    });
    chkFixedFold?.addEventListener('change', () => {
      if (!inpFixedFold) return;
      if (chkFixedFold.checked) {
        inpFixedFold.disabled = false;
        inpFixedFold.value = String(updateViewportHint());
      } else {
        inpFixedFold.disabled = true;
      }
    });

    shadow.getElementById('btn-auto-exposure')?.addEventListener('click', async () => {
      const topInput = shadow.getElementById('inp-exp-top');
      const bottomInput = shadow.getElementById('inp-exp-bottom');
      const skipEdited = !!shadow.getElementById('chk-exp-skip-edited')?.checked;
      const usePerPaneBounds = !!shadow.getElementById('chk-exp-per-pane')?.checked;
      const useFixedFold = !!shadow.getElementById('chk-exp-fixed-fold')?.checked;
      const foldPositionPx = Number.parseFloat(shadow.getElementById('inp-exp-fixed-fold')?.value || '0');

      const topBound = Number.parseFloat(topInput?.value || '100');
      const bottomBound = Number.parseFloat(bottomInput?.value || '20');

      const parseBound = (value, fallback) => {
        const n = Number(value);
        return Number.isFinite(n) ? n : fallback;
      };

      let perPaneBounds = null;
      if (usePerPaneBounds) {
        perPaneBounds = {};
        const topEls = Array.from(shadow.querySelectorAll('.exp-pane-top'));
        topEls.forEach(topEl => {
          const paneKey = topEl.dataset.pane || '';
          if (!paneKey) return;
          const bottomEl = shadow.querySelector(`.exp-pane-bottom[data-pane="${CSS.escape(paneKey)}"]`);
          perPaneBounds[paneKey] = {
            top: parseBound(topEl.value, topBound),
            bottom: parseBound(bottomEl?.value, bottomBound)
          };
        });
      }

      const result = await applyExposureGradientAcrossFrames({
        topBound,
        bottomBound,
        skipEdited,
        foldMode: useFixedFold ? 'fixed' : 'viewport',
        foldPositionPx,
        perPaneBounds,
        decimals: 1
      });

      if (!result.ok) {
        alert(`Exposure auto-seed skipped: ${result.reason}. Current metric: ${result.selectedMetricType || 'Unknown'}`);
        return;
      }

      if ((result.detectedZones === 0 || result.considered === 0) && result.changed === 0) {
        alert('Exposure auto-seed could not find any zone elements on this view yet. Try after the zoning layer fully renders, then run again.');
        return;
      }

      if (result.applied === 0 && result.changed === 0 && result.skippedEdited > 0) {
        alert(`Exposure gradient applied no changes because all ${result.skippedEdited} considered zones are already edited. Uncheck "Skip already edited zones" to overwrite them.`);
        return;
      }

      alert(`Exposure gradient applied to ${result.changed} zones.`);
    });

    document.body.appendChild(host);

    const closeOnOutside = e => {
      if (!host.contains(e.target) && !toolbarHost?.contains(e.target)) {
        host.remove();
        document.removeEventListener('click', closeOnOutside, true);
      }
    };
    setTimeout(() => document.addEventListener('click', closeOnOutside, true), 0);
  }

  function openEditsMenu() {
    if (!uiVisible) return;

    const existing = document.getElementById('cs-demo-edits-host');
    if (existing) {
      existing.remove();
      return;
    }

    // Close other panels when opening edits
    const scenariosHost = document.getElementById('cs-demo-scenarios-host');
    const exposureHost = document.getElementById('cs-demo-exposure-host');
    if (scenariosHost) scenariosHost.remove();
    if (exposureHost) exposureHost.remove();

    const host = document.createElement('div');
    host.id = 'cs-demo-edits-host';
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });

    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`
      .panel {
        position: fixed;
        top: 64px;
        right: 20px;
        z-index: 2147483645;
        width: 360px;
        max-height: min(70vh, 560px);
        overflow: auto;
        background: #fff;
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.2), 0 2px 8px rgba(0,0,0,0.1);
        border: 1px solid #e0e0f0;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
        font-size: 13px;
        color: #1a1a2e;
      }
      .panel-header {
        background: linear-gradient(135deg, #1c1263, #2c2c8c);
        color: #fff;
        padding: 12px 16px;
        font-weight: 700;
        font-size: 13px;
      }
      .panel-body { padding: 14px 16px; }
      .section-label {
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.6px;
        color: #888;
        margin-bottom: 8px;
      }
      .list { max-height: 220px; overflow-y: auto; }
      .item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px;
        border-radius: 7px;
      }
      .item:hover { background: #f0f0fa; }
      .name {
        flex: 1;
        font-weight: 600;
        font-size: 12px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .meta {
        font-size: 10px;
        color: #888;
        white-space: nowrap;
      }
      .btn-del {
        background: #fff0f0;
        color: #cc3333;
        font-size: 10px;
        padding: 4px 8px;
        border: 1px solid #ffcccc;
        border-radius: 6px;
        font-weight: 700;
        cursor: pointer;
      }
      .btn-del:hover { background: #ffe4e4; }
      .empty {
        text-align: center;
        padding: 14px;
        color: #aaa;
        font-size: 12px;
      }
      .section-divider {
        border: none;
        border-top: 1px solid #eee;
        margin: 12px 0;
      }
      .subsection-label {
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: #9a9ab0;
        margin: 8px 0 6px;
      }
    `);
    shadow.adoptedStyleSheets = [sheet];

    function escHtml(str) {
      return String(str || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function getZoningEditName(ov, key) {
      const rawName = String(ov?.zoneName || '').trim();
      return rawName || key.split('::').pop() || key;
    }

    function getHeatmapEditMeta(point) {
      const value = Number(point?.value);
      const valueLabel = Number.isFinite(value) ? value.toFixed(1) : '?';
      const x = Math.round(Number(point?.xPct || 0) * 100);
      const y = Math.round(Number(point?.yPct || 0) * 100);
      return `value ${valueLabel} @ ${x}%, ${y}%`;
    }

    function renderPanel() {
      const zoningEntries = Object.entries(overrides);
      const heatmapEntries = Object.entries(heatmapPointOverrides);
      const heatmapEntriesByLayer = HEATMAP_LAYER_KEYS.map(layer => {
        const points = heatmapEntries.filter(([, point]) => normalizeHeatmapLayerName(point?.layer) === layer);
        return {
          layer,
          label: getHeatmapLayerLabel(layer),
          points
        };
      });
      const total = zoningEntries.length + heatmapEntries.length;

      const panel = document.createElement('div');
      panel.className = 'panel';
      panel.innerHTML = `
        <div class="panel-header">🧩 Active Edits (${total})</div>
        <div class="panel-body">
          <div class="section-label">Zoning (${zoningEntries.length})</div>
          <div class="list" id="zoning-list">
            ${zoningEntries.length === 0
              ? '<div class="empty">No zoning edits</div>'
              : zoningEntries.map(([key, ov]) => `
                <div class="item">
                  <span class="name" title="${escHtml(key)}">${escHtml(getZoningEditName(ov, key))}</span>
                  <span class="meta">${escHtml(ov.origMetric || '')} → ${escHtml(ov.metric || '')}</span>
                  <button class="btn-del" data-kind="zoning" data-key="${escHtml(key)}">Delete</button>
                </div>
              `).join('')}
          </div>
          <hr class="section-divider">
          <div class="section-label">Heatmap (${heatmapEntries.length})</div>
          <div class="list" id="heatmap-list">
            ${heatmapEntries.length === 0
              ? '<div class="empty">No heatmap edits</div>'
              : heatmapEntriesByLayer.map(({ label, points }) => {
                if (points.length === 0) return '';
                return `
                  <div class="subsection-label">${escHtml(label)}</div>
                  ${points.map(([key, point]) => `
                    <div class="item">
                      <span class="name" title="${escHtml(key)}">${escHtml(getHeatmapPointDisplayName(point))}</span>
                      <span class="meta">${escHtml(getHeatmapEditMeta(point))}</span>
                      <button class="btn-del" data-kind="heatmap" data-key="${escHtml(key)}">Delete</button>
                    </div>
                  `).join('')}
                `;
              }).join('')}
          </div>
        </div>
      `;

      shadow.innerHTML = '';
      shadow.adoptedStyleSheets = [sheet];
      shadow.appendChild(panel);

      panel.addEventListener('click', async event => {
        const button = event.target;
        const kind = button?.dataset?.kind;
        const key = button?.dataset?.key;
        if (!kind || !key) return;

        if (kind === 'zoning') {
          const ov = overrides[key];
          if (!ov) return;
          const el = getAllZoneElements().find(zoneEl => {
            const zk = getZoneKey(zoneEl);
            const zi = zoneEl.getAttribute('id');
            return (zk && key.startsWith(zk + '@')) || key === zk || key === zi;
          });

          if (el) {
            await resetZoneOverride(el, getZoneKey(el), el.getAttribute('id'));
          } else {
            delete overrides[key];
            await persistOverrides();
            updateToolbar();
          }
        }

        if (kind === 'heatmap') {
          delete heatmapPointOverrides[key];
          await persistHeatmapPointOverrides();
          renderHeatmapPointOverlays();
          updateToolbar();
        }

        renderPanel();
      });
    }

    renderPanel();

    const closeOnOutside = e => {
      if (!host.contains(e.target) && !toolbarHost?.contains(e.target)) {
        host.remove();
        document.removeEventListener('click', closeOnOutside, true);
      }
    };
    setTimeout(() => document.addEventListener('click', closeOnOutside, true), 0);
  }

  // ─── SCENARIOS ───────────────────────────────────────────────────────────

  function openScenariosMenu() {
    if (!uiVisible) return;
    // Close other panels
    const exposureHost = document.getElementById('cs-demo-exposure-host');
    const editsHost = document.getElementById('cs-demo-edits-host');
    if (exposureHost) exposureHost.remove();
    if (editsHost) editsHost.remove();
    // Simple in-page scenario manager using a shadow DOM panel
    if (document.getElementById('cs-demo-scenarios-host')) {
      document.getElementById('cs-demo-scenarios-host').remove();
      return;
    }

    const host = document.createElement('div');
    host.id = 'cs-demo-scenarios-host';
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });

    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`
      .panel {
        position: fixed;
        top: 64px;
        right: 20px;
        z-index: 2147483645;
        width: 280px;
        background: #fff;
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.2), 0 2px 8px rgba(0,0,0,0.1);
        border: 1px solid #e0e0f0;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
        font-size: 13px;
        color: #1a1a2e;
        overflow: hidden;
      }
      .panel-header {
        background: linear-gradient(135deg, #1c1263, #2c2c8c);
        color: #fff;
        padding: 12px 16px;
        font-weight: 700;
        font-size: 13px;
      }
      .panel-body { padding: 14px 16px; }
      .section-label {
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.6px;
        color: #888;
        margin-bottom: 8px;
      }
      .save-row {
        display: flex;
        gap: 6px;
        margin-bottom: 16px;
      }
      .inp {
        flex: 1;
        padding: 7px 10px;
        border: 1.5px solid #d0d0e0;
        border-radius: 6px;
        font-size: 12px;
        font-family: inherit;
        outline: none;
        color: #1a1a2e;
        background: #fafafe;
      }
      .inp:focus { border-color: #5959dc; }
      .btn {
        padding: 7px 12px;
        border-radius: 6px;
        font-size: 11px;
        font-weight: 700;
        cursor: pointer;
        border: none;
        font-family: inherit;
        transition: background 0.15s;
        white-space: nowrap;
      }
      .btn-save { background: #2c2c8c; color: #fff; }
      .btn-save:hover { background: #3c3cac; }
      .scenario-list { max-height: 220px; overflow-y: auto; }
      .scenario-item {
        display: flex;
        align-items: center;
        padding: 8px 10px;
        border-radius: 7px;
        cursor: pointer;
        transition: background 0.12s;
        gap: 6px;
      }
      .scenario-item:hover { background: #f0f0fa; }
      .scenario-name {
        flex: 1;
        font-weight: 500;
        font-size: 12px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .scenario-meta {
        font-size: 10px;
        color: #aaa;
      }
      .btn-load {
        background: #eeeefa;
        color: #2c2c8c;
        font-size: 10px;
        padding: 4px 8px;
      }
      .btn-load:hover { background: #ddddf5; }
      .btn-del {
        background: #fff0f0;
        color: #cc3333;
        font-size: 10px;
        padding: 4px 8px;
        border: 1px solid #ffcccc;
      }
      .btn-del:hover { background: #ffe4e4; }
      .empty {
        text-align: center;
        padding: 24px;
        color: #aaa;
        font-size: 12px;
      }
      .section-divider {
        border: none;
        border-top: 1px solid #eee;
        margin: 12px 0;
      }
      .override-item {
        display: flex;
        align-items: center;
        padding: 6px 10px;
        border-radius: 7px;
        gap: 6px;
        transition: background 0.12s;
      }
      .override-item:hover { background: #f0f0fa; }
      .override-name {
        flex: 1;
        font-weight: 600;
        font-size: 12px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .override-meta {
        font-size: 10px;
        color: #888;
        white-space: nowrap;
      }
      .btn-reset-ov {
        background: #fff0f0;
        color: #cc3333;
        font-size: 10px;
        padding: 4px 8px;
        border: 1px solid #ffcccc;
      }
      .btn-reset-ov:hover { background: #ffe4e4; }
      .overrides-list { max-height: 160px; overflow-y: auto; }
      .section-header-row {
        display: flex;
        align-items: center;
        margin-bottom: 8px;
      }
      .section-header-row .section-label {
        flex: 1;
        margin-bottom: 0;
      }
      .btn-file { background: #f0f0f8; color: #444; font-size: 10px; padding: 3px 8px; border: 1px solid #d0d0e0; border-radius: 5px; }
      .btn-file:hover { background: #e4e4f4; }
      .btn-file-import { margin-left: 4px; }
    `);
    shadow.adoptedStyleSheets = [sheet];

    const panel = document.createElement('div');
    panel.className = 'panel';

    function escHtml(str) {
      return String(str || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function render(scenarios) {
      const items = Object.entries(scenarios)
        .filter(([, v]) => v.url === getUrlKey())
        .sort((a, b) => (b[1].createdAt || '') - (a[1].createdAt || ''));

      panel.innerHTML = `
        <div class="panel-header">📁 Scenarios</div>
        <div class="panel-body">
          <div class="section-label">Save current overrides</div>
          <div class="save-row">
            <input id="inp-name" class="inp" type="text" placeholder="Scenario name..." maxlength="50">
            <button class="btn btn-save" id="btn-save-sc">Save</button>
          </div>
          <div class="section-label" style="margin-top:-8px;margin-bottom:12px;text-transform:none;letter-spacing:0;font-size:11px;color:#9a9ab0;">Save includes zoning + heatmap edits.</div>
          <div class="section-header-row">
            <span class="section-label">Saved (${items.length})</span>
            <button class="btn btn-file" id="btn-export">⬇ Export</button>
            <button class="btn btn-file btn-file-import" id="btn-import">⬆ Import</button>
          </div>
          <div class="scenario-list" id="sc-list">
            ${items.length === 0 ? '<div class="empty">No scenarios for this page</div>' : items.map(([name, sc]) => `
              <div class="scenario-item">
                <span class="scenario-name" title="${escHtml(name)}">${escHtml(name)}</span>
                <span class="scenario-meta">${Object.keys(sc.overrides || {}).length} zoning + ${Object.keys(sc.heatmapPoints || {}).length} heatmap</span>
                <button class="btn btn-load" data-load="${escHtml(name)}">Load</button>
                <button class="btn btn-del" data-del="${escHtml(name)}">✕</button>
              </div>
            `).join('')}
          </div>
        </div>
      `;

      shadow.innerHTML = '';
      shadow.adoptedStyleSheets = [sheet];
      shadow.appendChild(panel);

      // Export all scenarios for this page to a JSON file
      shadow.getElementById('btn-export')?.addEventListener('click', () => {
        chrome.storage.local.get('csZoningScenarios', result => {
          const allScenarios = result.csZoningScenarios || {};
          const pageItems = Object.fromEntries(
            Object.entries(allScenarios).filter(([, v]) => v.url === getUrlKey())
          );
          const payload = {
            version: 1,
            exportedAt: new Date().toISOString(),
            pageKey: getUrlKey(),
            scenarios: pageItems
          };
          const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          const slug = getUrlKey().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 50);
          a.download = `cs-scenarios-${slug}.json`;
          document.body.appendChild(a);
          a.click();
          setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 5000);
        });
      });

      // Import scenarios from a JSON file
      shadow.getElementById('btn-import')?.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.style.cssText = 'position:fixed;top:-999px;left:-999px;opacity:0;pointer-events:none';
        document.body.appendChild(input);
        input.addEventListener('change', () => {
          const file = input.files?.[0];
          if (!file) { input.remove(); return; }
          const reader = new FileReader();
          reader.onload = () => {
            try {
              const parsed = JSON.parse(reader.result);
              // Accept both {scenarios:{...}} wrapper and bare {name: sc} objects
              const importedMap = parsed.scenarios && typeof parsed.scenarios === 'object'
                ? parsed.scenarios
                : parsed;
              if (typeof importedMap !== 'object' || Array.isArray(importedMap)) {
                throw new Error('Unrecognised file format');
              }
              chrome.storage.local.get('csZoningScenarios', result => {
                const all = result.csZoningScenarios || {};
                let imported = 0;
                Object.entries(importedMap).forEach(([name, sc]) => {
                  if (sc && typeof sc === 'object') {
                    const normalized = {
                      ...sc,
                      url: sc.url || getUrlKey(),
                      createdAt: sc.createdAt || Date.now(),
                      overrides: { ...(sc.overrides || {}) },
                      heatmapPoints: { ...(sc.heatmapPoints || {}) }
                    };
                    all[name] = normalized;
                    imported++;
                  }
                });
                chrome.storage.local.set({ csZoningScenarios: all }, () => {
                  log('Imported', imported, 'scenarios from file');
                  renderPanel();
                });
              });
            } catch (err) {
              alert('Import failed: ' + err.message);
            } finally {
              input.remove();
            }
          };
          reader.onerror = () => { alert('Failed to read file'); input.remove(); };
          reader.readAsText(file);
        });
        input.click();
      });

      shadow.getElementById('btn-save-sc').addEventListener('click', () => {
        const name = shadow.getElementById('inp-name').value.trim();
        if (!name) return;
        const count = Object.keys(overrides).length + Object.keys(heatmapPointOverrides).length;
        if (count === 0 && !confirm('No current edits to save. Save empty scenario?')) return;
        chrome.storage.local.get('csZoningScenarios', result => {
          const all = result.csZoningScenarios || {};
          const existing = all[name] || {};
          all[name] = {
            ...existing,
            url: getUrlKey(),
            createdAt: existing.createdAt || Date.now(),
            updatedAt: Date.now(),
            overrides: { ...overrides },
            heatmapPoints: { ...heatmapPointOverrides }
          };
          chrome.storage.local.set({ csZoningScenarios: all }, () => renderPanel());
        });
      });

      shadow.getElementById('sc-list')?.addEventListener('click', e => {
        const loadName = e.target.dataset.load;
        const delName = e.target.dataset.del;
        if (loadName) {
          chrome.storage.local.get('csZoningScenarios', result => {
            const sc = (result.csZoningScenarios || {})[loadName];
            if (!sc) return;
            loadScenarioOverrides(sc, true).then(() => {
              host.remove();
            });
          });
        }
        if (delName) {
          if (!confirm(`Delete scenario "${delName}"?`)) return;
          chrome.storage.local.get('csZoningScenarios', result => {
            const all = result.csZoningScenarios || {};
            delete all[delName];
            chrome.storage.local.set({ csZoningScenarios: all }, () => renderPanel());
          });
        }
      });
    }

    function renderPanel() {
      chrome.storage.local.get('csZoningScenarios', result => {
        render(result.csZoningScenarios || {});
      });
    }

    renderPanel();
    document.body.appendChild(host);

    // Close when clicking outside
    const closeOnOutside = e => {
      if (!host.contains(e.target) && !toolbarHost?.contains(e.target)) {
        host.remove();
        document.removeEventListener('click', closeOnOutside, true);
      }
    };
    setTimeout(() => document.addEventListener('click', closeOnOutside, true), 0);
  }

  // ─── SPA URL CHANGE DETECTION ────────────────────────────────────────────

  function handleUrlChange() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    log('URL changed:', lastUrl);

    if (isTopFrame && location.hostname === 'app.contentsquare.com') {
      const nextKey = normalizeCsUrlKey(location.href);
      setActivePageKey(nextKey, true);
      log('Updated active page key:', nextKey);
      // Refresh metric type name on every navigation — CS may switch metric in the URL
      refreshMetricTypeName();
    }

    // Clean up zone watchers for old URL
    zoneObservers.forEach(entry => {
      entry.observer.disconnect();
      entry.element.removeEventListener('click', onZoneElementClick, true);
    });
    zoneObservers.clear();

    // Load overrides for new URL
    Promise.all([loadOverrides(), loadHeatmapPointOverrides()]).then(() => {
      syncZoneWatchers();
      renderHeatmapPointOverlays();
      updateToolbar();
    });
  }

  setInterval(handleUrlChange, 800);
  setInterval(syncZoneWatchers, 1200);

  // ─── MESSAGE HANDLER (from popup) ────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'ping') {
      sendResponse({ ok: true, frameContextKey, isTopFrame });
      return true;
    }

    if (msg.type === 'getState') {
      if (!isTopFrame) return;
      const zones = getAllZoneElements();
      const analysisMode = getActiveAnalysisMode();
      log('getState requested. zones=', zones.length, 'routeZoning=', isLikelyZoningRoute(), 'editMode=', editMode);
      sendResponse({
        isZoningPage: zones.length > 0 || isLikelyZoningRoute(),
        analysisMode,
        editMode,
        uiVisible,
        overrideCount: getTotalOverrideCount(),
        url: getUrlKey()
      });
      return true;
    }
    if (msg.type === 'openEditor') {
      if (!isTopFrame) return true; // only the top frame opens the popup
      log('Opening top-frame editor for', msg.editorState?.zoneKey);
      openEditPopover(msg.editorState, null);
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === 'applyEditorOverride') {
      if (msg.editorState?.frameContextKey !== frameContextKey) return;
      log('applyEditorOverride message', {
        incomingFrame: msg.editorState?.frameContextKey,
        localFrame: frameContextKey,
        zoneKey: msg.editorState?.zoneKey,
        zoneId: msg.editorState?.zoneId
      });
      const zoneEl = findZoneElementForState(msg.editorState);
      if (!zoneEl) {
        log('No zone found for applyEditorOverride', msg.editorState);
        return true;
      }
      log('applyEditorOverride matched element', getZoneDebugSnapshot(zoneEl));
      saveZoneOverride(
        zoneEl,
        msg.editorState.zoneKey,
        msg.editorState.zoneId,
        msg.editorState.metric,
        msg.editorState.value,
        msg.editorState.zoneName,
        msg.editorState.csMetricTypeName
      );
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === 'resetEditorOverride') {
      if (msg.editorState?.frameContextKey !== frameContextKey) return;
      log('resetEditorOverride message', {
        incomingFrame: msg.editorState?.frameContextKey,
        localFrame: frameContextKey,
        zoneKey: msg.editorState?.zoneKey,
        zoneId: msg.editorState?.zoneId
      });
      const zoneEl = findZoneElementForState(msg.editorState);
      if (!zoneEl) {
        log('No zone found for resetEditorOverride', msg.editorState);
        return true;
      }
      log('resetEditorOverride matched element', getZoneDebugSnapshot(zoneEl));
      resetZoneOverride(zoneEl, msg.editorState.zoneKey, msg.editorState.zoneId);
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === 'setEditMode') {
      setEditMode(msg.enabled, true);
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === 'setEditModeFrame') {
      setEditMode(msg.enabled, false);
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === 'setUiVisible') {
      setUiVisible(msg.visible, true);
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === 'setUiVisibleFrame') {
      setUiVisible(msg.visible, false);
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === 'loadScenario') {
      loadScenarioOverrides(msg.scenario || msg.overrides, true).then(result => {
        sendResponse({ ok: true, ...result });
      });
      return true;
    }
    if (msg.type === 'applyScenarioOverrides') {
      loadScenarioOverrides(msg.scenario || msg.overrides, false).then(result => {
        sendResponse({ ok: true, frame: frameContextKey, ...result });
      });
      return true;
    }
    if (msg.type === 'applyExposureGradientInFrame') {
      if (msg.originFrameContextKey && msg.originFrameContextKey === frameContextKey) {
        sendResponse({ ok: true, skippedOrigin: true, frame: frameContextKey });
        return true;
      }
      applyExposureGradientOverrides(msg.options || {}).then(result => {
        sendResponse({ ok: true, frame: frameContextKey, ...result });
      });
      return true;
    }
    if (msg.type === 'resetAll') {
      resetAll();
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === 'resetAllFrames') {
      resetAllInFrame().then(() => {
        sendResponse({ ok: true });
      });
      return true;
    }
    if (msg.type === 'collectHeatmapDebugInFrame') {
      sendResponse({
        ok: true,
        requestId: String(msg.requestId || ''),
        payload: collectHeatmapDebugSnapshot()
      });
      return true;
    }

    if (msg.type === 'collectZoneKeysInFrame') {
      const limit = Number(msg.limit) || 200;
      sendResponse({
        ok: true,
        requestId: String(msg.requestId || ''),
        payload: {
          mode: 'zone-keys',
          frameContextKey,
          frameScopeKey,
          frameInstanceKey,
          isTopFrame,
          href: location.href,
          rows: getZoneDebugRows(limit)
        }
      });
      return true;
    }
  });

  // ─── INIT ─────────────────────────────────────────────────────────────────

  // Debug helpers (temporary): callable from DevTools console in any frame context.
  try {
    window.__CS_DEMO_DUMP_KEYS = (limit = 200) => dumpZoneDebugRows(limit);
    window.__CS_DEMO_DUMP_SELECTED = () => ({
      logMode: window.__CS_DEMO_LOG_MODE || CS_DEFAULT_LOG_MODE,
      frameContextKey,
      frameScopeKey,
      frameInstanceKey,
      href: location.href
    });
  } catch (_) {
    // Ignore if window is not writable in this execution context.
  }

  // Bridge debug helpers into the page JS world so DevTools console can call them directly.
  installPageWorldDebugBridge();

  function emitPageDebugResponse(type, payload) {
    const detail = { type, payload };
    try {
      const root = document.documentElement;
      if (root) {
        root.setAttribute('data-cs-demo-last-debug-response', `${Date.now()}:${String(type || '')}`);
        let json = '';
        try {
          json = JSON.stringify(detail);
        } catch (error) {
          json = JSON.stringify({
            type: String(type || ''),
            payload: {
              message: 'Failed to serialize debug payload',
              error: error?.message || String(error)
            }
          });
        }
        root.setAttribute('data-cs-demo-last-debug-json', (json || '').slice(0, 20000));
        if (String(type || '') === 'heatmap') {
          root.setAttribute('data-cs-demo-last-heatmap-response', `${Date.now()}:heatmap`);
          root.setAttribute('data-cs-demo-last-heatmap-json', (json || '').slice(0, 20000));
        }
      }
    } catch (_) {
      // Ignore DOM marker write failures.
    }

    try {
      window.dispatchEvent(new CustomEvent('cs-demo-debug-response', { detail }));
    } catch (_) {
      // Ignore custom-event bridge failures.
    }

    try {
      window.postMessage({
        __csDemoDebugResponse: true,
        detail
      }, '*');
    } catch (_) {
      // Ignore postMessage bridge failures.
    }
  }

  window.addEventListener('message', event => {
    if (event.source !== window) return;
    const data = event?.data;
    if (!data || data.__csDemoDebugRequest !== true) return;

    try {
      window.dispatchEvent(new CustomEvent('cs-demo-debug-request', {
        detail: {
          type: String(data.type || ''),
          limit: data.limit
        }
      }));
    } catch (_) {
      // Ignore bridge dispatch failures.
    }
  });

  // Respond to page-world debug helper requests.
  window.addEventListener('cs-demo-debug-request', event => {
    const detail = event?.detail || {};
    try {
      document.documentElement?.setAttribute('data-cs-demo-last-debug-request', `${Date.now()}:${String(detail.type || '')}`);
    } catch (_) {
      // Ignore marker failures.
    }

    if (detail.type === 'selected') {
      emitPageDebugResponse('selected', {
        loaded: true,
        logMode: window.__CS_DEMO_LOG_MODE || CS_DEFAULT_LOG_MODE,
        frameContextKey,
        frameScopeKey,
        frameInstanceKey,
        href: location.href,
        host: location.hostname,
        isTopFrame
      });
      return;
    }

    if (detail.type === 'keys') {
      const limit = Number(detail.limit) || 200;
      const localPayload = {
        mode: 'zone-keys',
        frameContextKey,
        frameScopeKey,
        frameInstanceKey,
        isTopFrame,
        href: location.href,
        rows: getZoneDebugRows(limit)
      };

      if (!isTopFrame) {
        emitPageDebugResponse('keys', localPayload);
        return;
      }

      chrome.runtime.sendMessage({
        type: 'broadcastToTab',
        payload: {
          type: 'collectZoneKeysInFrame',
          requestId: `zk:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`,
          limit
        }
      }, response => {
        const err = chrome.runtime.lastError;
        if (err || !response?.ok) {
          emitPageDebugResponse('keys', {
            mode: 'zone-keys-aggregate',
            frames: [localPayload],
            totalRows: Number(localPayload.rows?.length || 0),
            warning: err?.message || response?.error || 'broadcast failed'
          });
          return;
        }

        const remoteFrames = (response.results || [])
          .filter(row => row && row.ok && row.frameId !== 0 && row.payload?.ok && row.payload?.payload)
          .map(row => row.payload.payload);

        const frames = [localPayload, ...remoteFrames];
        const rows = frames.flatMap(frame => {
          const frameRows = Array.isArray(frame.rows) ? frame.rows : [];
          return frameRows.map(item => ({
            ...item,
            frameContextKey: frame.frameContextKey,
            frameScopeKey: frame.frameScopeKey,
            href: frame.href,
            isTopFrame: !!frame.isTopFrame
          }));
        });

        emitPageDebugResponse('keys', {
          mode: 'zone-keys-aggregate',
          frames,
          totalRows: rows.length,
          rows
        });
      });
      return;
    }

    if (detail.type === 'heatmap') {
      const requestId = `hm:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;

      emitPageDebugResponse('heatmap-ack', {
        requestId,
        stage: 'received',
        isTopFrame,
        frameContextKey
      });

      let localPayload = null;
      try {
        localPayload = collectHeatmapDebugSnapshot();
      } catch (error) {
        emitPageDebugResponse('heatmap-error', {
          requestId,
          stage: 'collect-local-failed',
          message: error?.message || String(error),
          stack: error?.stack || ''
        });
        return;
      }

      const emit = payload => {
        try {
          console.log('[CS Demo Tool][heatmap-debug]', payload);
          console.table(payload.surfaces || []);
          console.table((payload.points || []).map(row => ({
            zoneKey: row.zoneKey,
            layer: row.layer,
            value: row.value,
            surfaceKey: row.surfaceKey,
            anchorKey: row.anchorKey,
            anchorPath: row.anchorPath,
            containerTag: row.resolvedContainer?.tag || '',
            containerClass: row.resolvedContainer?.className || '',
            containerScrollTop: row.resolvedContainer?.scrollTop,
            containerScrollLeft: row.resolvedContainer?.scrollLeft,
            clientX: row.clientX,
            clientY: row.clientY
          })));
        } catch (_) {
          // Ignore console formatting errors.
        }

        emitPageDebugResponse('heatmap', payload);
      };

      if (!isTopFrame) {
        emit(localPayload);
        return;
      }

      chrome.runtime.sendMessage({
        type: 'broadcastToTab',
        payload: {
          type: 'collectHeatmapDebugInFrame',
          requestId
        }
      }, response => {
        const err = chrome.runtime.lastError;
        if (err || !response?.ok) {
          emit({
            requestId,
            mode: 'heatmap-aggregate',
            frames: [localPayload],
            frameCount: 1,
            pointCount: Number(localPayload.pointCount || 0),
            surfaceCount: Number(localPayload.surfaceCount || 0),
            warning: err?.message || response?.error || 'broadcast failed'
          });
          return;
        }

        const remoteFrames = (response.results || [])
          .filter(row => row && row.ok && row.frameId !== 0 && row.payload?.ok && row.payload?.payload)
          .map(row => row.payload.payload);

        const allFrames = [localPayload, ...remoteFrames];
        const allSurfaces = allFrames.flatMap(frame => frame.surfaces || []);
        const allPoints = allFrames.flatMap(frame => frame.points || []);

        emit({
          requestId,
          mode: 'heatmap-aggregate',
          frames: allFrames,
          frameCount: allFrames.length,
          pointCount: allPoints.length,
          surfaceCount: allSurfaces.length,
          surfaces: allSurfaces,
          points: allPoints
        });
      });
      return;
    }
  });

  if (isTopFrame) {
    window.addEventListener('message', event => {
      const data = event?.data;
      if (!data || data.__csDemoRelay !== true) return;
      const relayedArgs = Array.isArray(data.args) ? data.args : [];
      console.log('[CS Demo Tool]', '[relay]', `[${data.frameTag || 'subframe'}]`, ...(relayedArgs));
    });
  }

  window.addEventListener('cs-demo-page-interaction', event => {
    const detail = event?.detail || {};
    const explicitLayer = normalizeHeatmapLayerName(detail.heatmapLayer || '', '');
    if (explicitLayer && explicitLayer !== lastKnownHeatmapLayer) {
      lastKnownHeatmapLayer = explicitLayer;
      log('Heatmap layer remembered via page-bridge', explicitLayer, `editMode=${editMode}`, `uiVisible=${uiVisible}`);
      // Make layer switches feel immediate by hiding stale markers first,
      // then redraw on the next animation frame.
      clearHeatmapPointOverlaysNow();
      scheduleHeatmapOverlayRender();
    }

    // Layer tab clicks should not go through full zone/heatmap fallback logic.
    if (explicitLayer && !detail.zoneId && !detail.heatmapSurface) {
      return;
    }

    if (!editMode || !uiVisible) return;

    const source = String(detail.source || detail.eventType || 'unknown');
    const zoneId = String(detail.zoneId || '').trim();
    const heatmapSurface = !!detail.heatmapSurface;
    const x = Number(detail.clientX) || 0;
    const y = Number(detail.clientY) || 0;
    const heatmapEditingContext = CS_ENABLE_HEATMAP_INTERACTIONS && isHeatmapEditingContext();
    const zoningInteractionContext = isLikelyZoningInteractionContext();



    log(
      'Global zone interaction',
      `page-bridge source=${source}`,
      `zoneId=${zoneId || '(none)'}`,
      `heatmapSurface=${heatmapSurface}`,
      `xy=${x},${y}`
    );
    if (detail.pathPreview) {
      log('Global zone path preview', detail.pathPreview);
    }

    if (!zoneId) {
      if (zoningInteractionContext && !heatmapEditingContext && !heatmapSurface) {
        log('Global zone no-match', 'page-bridge zoning context: skip heatmap fallback');
        return;
      }
      if (!CS_ENABLE_HEATMAP_INTERACTIONS) {
        log('Global zone no-match', 'page-bridge heatmap interactions disabled');
        return;
      }
      if (heatmapEditingContext || heatmapSurface) {
        const surfaceAtPoint = findHeatmapSurfaceAtPoint(x, y);
        if (!isWithinHeatmapInteractionBoundary(x, y, surfaceAtPoint)) {
          log('Global zone no-match', 'page-bridge outside heatmap boundary: skip heatmap fallback');
          return;
        }
        const motionAtPoint = getHeatmapMotionContainerAtPoint(x, y, surfaceAtPoint);
        openHeatmapPointEditorAt(x, y, `page-bridge:${source}`, surfaceAtPoint, motionAtPoint);
      }
      return;
    }

    const matches = getAllZoneElements().filter(el => (el.getAttribute('id') || '') === zoneId);
    if (!matches.length) {
      log('Global zone no-match', 'page-bridge could not resolve zoneId to element', zoneId);
      return;
    }

    const zoneEl = matches.sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      const da = Math.abs((ra.left + ra.width / 2) - x) + Math.abs((ra.top + ra.height / 2) - y);
      const db = Math.abs((rb.left + rb.width / 2) - x) + Math.abs((rb.top + rb.height / 2) - y);
      return da - db;
    })[0];

    onZoneClick(zoneEl, {
      stopPropagation() {},
      stopImmediatePropagation() {},
      preventDefault() {},
      cancelable: true
    });
  });

  // Intercept zone clicks globally so edit mode works even if zone hosts are replaced dynamically.
  let lastZoneInterceptAt = 0;
  const seenGlobalInteractionEvents = new WeakSet();

  function stopEventCompletely(event) {
    if (!event) return;
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (event.cancelable) event.preventDefault();
  }

  function handleGlobalZoneInteraction(event, source) {
    if (event && typeof event === 'object') {
      if (seenGlobalInteractionEvents.has(event)) return;
      seenGlobalInteractionEvents.add(event);
    }

    if (!editMode || !uiVisible) return;

    const path = event.composedPath ? event.composedPath() : [];
    const zoneEl = findZoneElementFromEvent(event);

    // Heatmap layer tabs are handled by page-bridge; bail out early to avoid
    // running expensive context resolution on every tab pointer/mouse event.
    // Important: do not bail if this interaction actually hit a zoning element.
    const layerFromPath = path
      .map(node => getHeatmapLayerLabelFromNode(node))
      .find(Boolean);
    if (layerFromPath && !zoneEl) {
      if (layerFromPath !== lastKnownHeatmapLayer) {
        lastKnownHeatmapLayer = layerFromPath;
        clearHeatmapPointOverlaysNow();
        scheduleHeatmapOverlayRender();
      }
      return;
    }

    log(
      'Global zone interaction',
      `source=${source}`,
      `type=${event.type}`,
      `editMode=${editMode}`,
      `uiVisible=${uiVisible}`,
      `active=${editMode && uiVisible}`
    );

    const heatmapEditingContext = CS_ENABLE_HEATMAP_INTERACTIONS && isHeatmapEditingContext();
    const zoningInteractionContext = isLikelyZoningInteractionContext(path);
    const pathPreview = path
      .slice(0, 8)
      .map(node => {
        if (!node) return 'null';
        if (node === window) return 'window';
        if (node === document) return 'document';
        if (node.nodeType === 11) return 'shadow-root';
        const tag = node.tagName ? node.tagName.toLowerCase() : '';
        const id = node.id ? `#${node.id}` : '';
        const className = node.className && typeof node.className === 'string'
          ? `.${node.className.trim().split(/\s+/).slice(0, 2).join('.')}`
          : '';
        return `${tag || (node.nodeName || 'node').toLowerCase()}${id}${className}`;
      })
      .join(' > ');

    log(
      'Global zone interaction',
      `source=${source}`,
      `type=${event.type}`,
      `button=${event.button}`,
      `cancelable=${event.cancelable}`,
      `target=${event.target?.tagName?.toLowerCase?.() || typeof event.target}`
    );

    log('Global zone path preview', pathPreview || '(empty path)');

    if (toolbarHost && path.includes(toolbarHost)) return;
    if (isEventInsidePopover(path)) return;

    const clientX = Number(event.clientX) || 0;
    const clientY = Number(event.clientY) || 0;
    const heatmapSurface = getHeatmapInteractionSurfaceAtPoint(clientX, clientY, path);

    const heatmapMotionContainer = path.find(node => {
      if (!(node instanceof Element)) return false;
      if (!node.matches) return false;
      return node.matches('[data-cs-qa-id="heatmap-report-container"], [data-qa-id="heatmap-report-container"], [id*="layers-container"], [class*="layers-container"], [class*="heatmap-layer"], [data-testid*="heatmap-layer"]');
    }) || null;
    if (zoneEl) {
      log(
        'Global zone match',
        `source=${source}`,
        `zoneTag=${zoneEl.tagName?.toLowerCase?.() || '(none)'}`,
        `zoneId=${zoneEl.getAttribute('id') || '(none)'}`,
        `zoneKey=${getZoneKey(zoneEl) || '(none)'}`
      );

      // Always block CS handlers when interaction lands on a zone in edit mode.
      log('Global zone block', `source=${source}`, `type=${event.type}`);
      stopEventCompletely(event);

      // Block early on pointerdown/contextmenu, but only open on click to
      // avoid immediate close from the same gesture hitting the backdrop.
      if (source === 'pointerdown' || source === 'mousedown') {
        lastZoneInterceptAt = Date.now();
        return;
      }

      if (source === 'contextmenu') {
        lastZoneInterceptAt = Date.now();
        if (!popoverHost) onZoneClick(zoneEl, event);
        return;
      }

      if (source === 'click' || source === 'pointerup' || source === 'mouseup') {
        lastZoneInterceptAt = Date.now();
        if (!popoverHost) onZoneClick(zoneEl, event);
        return;
      }

      // Click fallback for browsers/pages where pointerdown interception is bypassed.
      const recentlyHandled = Date.now() - lastZoneInterceptAt < 600;
      if (!recentlyHandled && !popoverHost) {
        log('Global zone click fallback', 'opening popover from click fallback');
        onZoneClick(zoneEl, event);
      }
      return;
    }

    log('Global zone no-match', `source=${source}`, `type=${event.type}`);

    const shouldTreatAsHeatmap = heatmapEditingContext
      || (!!heatmapSurface && getAllZoneElements().length === 0);

    if (zoningInteractionContext && !shouldTreatAsHeatmap) {
      log('Global zone no-match', `source=${source}`, 'zoning context: heatmap fallback disabled');
      return;
    }

    if (!CS_ENABLE_HEATMAP_INTERACTIONS) {
      log('Global zone no-match', `source=${source}`, 'heatmap interactions disabled');
      return;
    }

    if (shouldTreatAsHeatmap
      && (source === 'pointerdown'
        || source === 'mousedown'
        || source === 'contextmenu'
        || source === 'click'
        || source === 'pointerup'
        || source === 'mouseup')) {
      if (!isWithinHeatmapInteractionBoundary(clientX, clientY, heatmapSurface, path)) {
        log('Global zone no-match', `source=${source}`, 'outside heatmap boundary: heatmap fallback disabled');
        return;
      }

      stopEventCompletely(event);

      if (!popoverHost) {
        openHeatmapPointEditorAt(
          clientX,
          clientY,
          `global:${source}`,
          heatmapSurface,
          heatmapMotionContainer,
          path
        );
      }
      return;
    }

    if (source === 'click'
      || source === 'pointerdown'
      || source === 'contextmenu'
      || source === 'mousedown'
      || source === 'pointerup'
      || source === 'mouseup') {
      log(`${source} in edit mode but no zone element found`);
    }
    return;
  }

  // Register on both window and document so we can win even if CS listens at window capture.
  ['pointerdown', 'click', 'contextmenu'].forEach(type => {
    window.addEventListener(type, e => handleGlobalZoneInteraction(e, type), true);
    document.addEventListener(type, e => handleGlobalZoneInteraction(e, type), true);
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes.csZoningEditMode) {
      const next = !!changes.csZoningEditMode.newValue;
      if (next !== editMode) {
        log('Storage edit-mode update received:', next);
        setEditMode(next, false);
      }
    }
    if (changes.csZoningUiVisible) {
      const nextVisible = changes.csZoningUiVisible.newValue !== false;
      if (nextVisible !== uiVisible) {
        log('Storage UI visibility update received:', nextVisible);
        setUiVisible(nextVisible, false);
      }
    }
    if (changes.csZoningActivePageKey) {
      const nextKey = changes.csZoningActivePageKey.newValue || '';
      if (nextKey && nextKey !== activePageKey) {
        activePageKey = nextKey;
        log('Storage active page key update received:', activePageKey);
        Promise.all([loadOverrides(), loadHeatmapPointOverrides()]).then(() => {
          syncZoneWatchers();
          applyAllOverrides();
          renderHeatmapPointOverlays();
          updateToolbar();
        });
      }
    }
    if (changes.csZoningOverrides) {
      const all = changes.csZoningOverrides.newValue || {};
      const nextOverrides = all[getUrlKey()] || {};
      overrides = { ...nextOverrides };
      log('Storage overrides update received. keys=', Object.keys(overrides).length);
      
      // Remove all visual overrides first, but do not trigger storage writes
      getAllZoneElements().forEach(el => {
        
        // CORE FIX: Use the proper lookup function instead of the legacy key lookup
        const hasOverride = getOverrideForElement(el); 
        
        if (!hasOverride) {
          // Visual-only reset: revert attributes and styles, but do NOT update storage
          if (el.hasAttribute('data-cs-demo-orig-metric')) {
            el.setAttribute('metric', String(el.getAttribute('data-cs-demo-orig-metric') || ''));
            if (el.hasAttribute('data-cs-demo-orig-value')) el.setAttribute('value', String(el.getAttribute('data-cs-demo-orig-value') || ''));
            else el.removeAttribute('value');
            if (el.hasAttribute('data-cs-demo-orig-color')) el.setAttribute('color', String(el.getAttribute('data-cs-demo-orig-color') || ''));
            else el.removeAttribute('color');
            el.removeAttribute('data-cs-demo-orig-metric');
            el.removeAttribute('data-cs-demo-orig-value');
            el.removeAttribute('data-cs-demo-orig-color');
          }
          el.style.outline = '';
          el.style.outlineOffset = '';
        }
      });
      syncZoneWatchers();
      applyAllOverrides();
      updateToolbar();
    }
    if (changes.csZoningHeatmapPoints) {
      const all = changes.csZoningHeatmapPoints.newValue || {};
      const nextPoints = all[getUrlKey()] || {};
      const normalized = {};
      Object.entries(nextPoints).forEach(([key, point]) => {
        const nextPoint = normalizeHeatmapPointRecord(point);
        if (!nextPoint) return;
        normalized[key] = nextPoint;
      });
      heatmapPointOverrides = normalized;
      log('Storage heatmap-point update received. keys=', Object.keys(heatmapPointOverrides).length);
      renderHeatmapPointOverlays();
      updateToolbar();
    }
    if (changes.csZoningExposureRequest) {
      const req = changes.csZoningExposureRequest.newValue || null;
      const requestId = req?.requestId || '';
      if (!requestId || requestId === lastHandledExposureRequestId) return;
      lastHandledExposureRequestId = requestId;

      if (req.originFrameContextKey && req.originFrameContextKey === frameContextKey) {
        return;
      }

      applyExposureGradientOverrides(req.options || {}).then(result => {
        appendExposureResponse(requestId, {
          ok: !!result?.ok,
          selectedMetricType: result?.selectedMetricType || '',
          detectedZones: Number(result?.detectedZones) || 0,
          considered: Number(result?.considered) || 0,
          applied: Number(result?.applied) || 0,
          skippedEdited: Number(result?.skippedEdited) || 0
        });
      });
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closePopover();
      if (editMode) setEditMode(false);
    }
  });

  // async function init() {
  //       // MutationObserver: apply overrides when zone elements appear
  //       let observer = null;
  //       function checkAndApplyOverrides() {
  //         const zoneElements = getAllZoneElements();
  //         if (zoneElements.length > 0) {
  //           const domKeys = zoneElements.map(getZoneKey).filter(Boolean);
  //           console.log('[ZONING-DEBUG][observer] DOM zone keys:', domKeys);
  //           console.log('[ZONING-DEBUG][observer] Loaded override keys:', Object.keys(overrides));
  //           applyAllOverrides();
  //           if (observer) observer.disconnect();
  //         }
  //       }
  //       function startObserverWhenBodyReady() {
  //         if (document.body) {
  //           observer = new MutationObserver(() => {
  //             checkAndApplyOverrides();
  //           });
  //           observer.observe(document.body, { childList: true, subtree: true });
  //           // In case elements are already present
  //           checkAndApplyOverrides();
  //         } else {
  //           setTimeout(startObserverWhenBodyReady, 50);
  //         }
  //       }
  //       startObserverWhenBodyReady();
  //   log('Global zone interaction', `init frame=${frameTag}`, `url=${location.href}`);
  //   log('Initializing content script. url=', location.href, 'origin=', location.origin, 'readyState=', document.readyState);
  //   try {
  //     chrome.runtime.sendMessage({ type: 'registerFrame' }, () => {
  //       void chrome.runtime.lastError;
  //     });
  //   } catch (_) {
  //     // Ignore registration failures; feature falls back to local frame behavior.
  //   }
  //   await loadActivePageKey();
  //   if (isTopFrame && location.hostname === 'app.contentsquare.com') {
  //     const initialKey = normalizeCsUrlKey(location.href);
  //     setActivePageKey(initialKey, true);
  //     log('Set initial active page key:', initialKey);
  //     refreshMetricTypeName();
  //     log('Detected CS metric type name:', csMetricTypeName || '(not detected yet)');
  //   }
  //   await loadGlobalEditMode();
  //   await loadUiVisibility();
  //   await loadOverrides();
  //   console.log('[ZONING-DEBUG][init] Loaded overrides:', Object.keys(overrides));
  //   await loadHeatmapPointOverrides();
  //   console.log('[ZONING-DEBUG][init] Loaded heatmapPointOverrides:', Object.keys(heatmapPointOverrides));
  //   startDocObserver();

  //   // Start watching existing zones + create toolbar
  //   syncZoneWatchers();
  //   createToolbar();
  //   applyUiVisibility();
  //   renderHeatmapPointOverlays();
  //   // Debug: log after applying all overrides
  //   applyAllOverrides();
  //   console.log('[ZONING-DEBUG][init] Called applyAllOverrides after page load.');
  //   window.addEventListener('resize', scheduleHeatmapOverlayRender, true);
  //   window.addEventListener('scroll', scheduleHeatmapOverlayRender, true);
  //   document.addEventListener('scroll', scheduleHeatmapOverlayRender, true);
  //   window.addEventListener('scroll', handleHeatmapScrollSignal, true);
  //   document.addEventListener('scroll', handleHeatmapScrollSignal, true);
  //   window.addEventListener('wheel', handleHeatmapScrollSignal, { capture: true, passive: true });
  //   document.addEventListener('wheel', handleHeatmapScrollSignal, { capture: true, passive: true });
  //   window.addEventListener('touchmove', handleHeatmapScrollSignal, { capture: true, passive: true });
  //   document.addEventListener('touchmove', handleHeatmapScrollSignal, { capture: true, passive: true });
  //   syncPageWorldState();

  //   // If no zones yet, poll until they appear (SPA may not have rendered)
  //   if (getAllZoneElements().length === 0) {
  //     const poll = setInterval(() => {
  //       const zones = getAllZoneElements();
  //       if (zones.length > 0) {
  //         zones.forEach(watchZone);
  //         clearInterval(poll);
  //       }
  //     }, 500);
  //     setTimeout(() => clearInterval(poll), 30000); // give up after 30s
  //   }
  // }

// ─── INIT ─────────────────────────────────────────────────────────────────

  async function init() {
    // 1. MutationObserver: apply overrides when zone elements appear
    let observer = null;
    function checkAndApplyOverrides() {
      const zoneElements = getAllZoneElements();
      if (zoneElements.length > 0) {
        const domKeys = zoneElements.map(getZoneKey).filter(Boolean);
        console.log('[ZONING-DEBUG][observer] DOM zone keys:', domKeys);
        console.log('[ZONING-DEBUG][observer] Loaded override keys:', Object.keys(overrides));
        applyAllOverrides();
        // We no longer disconnect the observer here so it catches SPA navigation
      }
    }

    function startObserverWhenBodyReady() {
      if (document.body) {
        observer = new MutationObserver(() => {
          checkAndApplyOverrides();
        });
        observer.observe(document.body, { childList: true, subtree: true });
        checkAndApplyOverrides();
      } else {
        setTimeout(startObserverWhenBodyReady, 50);
      }
    }

    log('Global zone interaction', `init frame=${frameTag}`, `url=${location.href}`);
    log('Initializing content script. url=', location.href, 'origin=', location.origin, 'readyState=', document.readyState);

    try {
      chrome.runtime.sendMessage({ type: 'registerFrame' }, () => {
        void chrome.runtime.lastError;
      });
    } catch (_) {
      // Ignore registration failures; feature falls back to local frame behavior.
    }

    // 2. Load all state from storage
    await loadActivePageKey();
    
    if (isTopFrame && location.hostname === 'app.contentsquare.com') {
      const initialKey = normalizeCsUrlKey(location.href);
      setActivePageKey(initialKey, true);
      log('Set initial active page key:', initialKey);
      refreshMetricTypeName();
      log('Detected CS metric type name:', csMetricTypeName || '(not detected yet)');
    }

    await loadGlobalEditMode();
    await loadUiVisibility();
    await loadOverrides();
    console.log('[ZONING-DEBUG][init] Loaded overrides:', Object.keys(overrides));
    await loadHeatmapPointOverrides();
    console.log('[ZONING-DEBUG][init] Loaded heatmapPointOverrides:', Object.keys(heatmapPointOverrides));

    // 3. Start Document Observer
    startDocObserver();

    // 4. NEW: AGGRESSIVE PERSISTENCE POLLING
    // This solves the reload issue by checking for zones every 500ms for 20 seconds.
    // Contentsquare is a heavy SPA; zones often arrive 2-5 seconds after the script first runs.
    let pollCount = 0;
    const initialApplyPoll = setInterval(() => {
      const zones = getAllZoneElements();
      if (zones.length > 0) {
        applyAllOverrides(); 
        zones.forEach(watchZone); // Ensures MutationObservers attach to new elements
        updateToolbar();
      }
      pollCount++;
      // Stop polling after 20 seconds to save CPU
      if (pollCount > 40) clearInterval(initialApplyPoll); 
    }, 500);

    // 5. Initialize UI and Handlers
    syncZoneWatchers();
    createToolbar();
    applyUiVisibility();
    renderHeatmapPointOverlays();
    
    // Final debug log and interaction listeners
    applyAllOverrides();
    console.log('[ZONING-DEBUG][init] Called applyAllOverrides after page load.');

    window.addEventListener('resize', scheduleHeatmapOverlayRender, true);
    window.addEventListener('scroll', scheduleHeatmapOverlayRender, true);
    document.addEventListener('scroll', scheduleHeatmapOverlayRender, true);
    window.addEventListener('scroll', handleHeatmapScrollSignal, true);
    document.addEventListener('scroll', handleHeatmapScrollSignal, true);
    window.addEventListener('wheel', handleHeatmapScrollSignal, { capture: true, passive: true });
    document.addEventListener('wheel', handleHeatmapScrollSignal, { capture: true, passive: true });
    window.addEventListener('touchmove', handleHeatmapScrollSignal, { capture: true, passive: true });
    document.addEventListener('touchmove', handleHeatmapScrollSignal, { capture: true, passive: true });
    
    syncPageWorldState();
    installPageWorldDebugBridge();
    
    startObserverWhenBodyReady();
  }




  init();
})();
