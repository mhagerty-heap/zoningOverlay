// content/content.js — CS Zoning Demo Tool
// Runs on app.contentsquare.com
// Uses open-shadow Vue custom elements: <app-zone-elements>
// Editing: setAttribute('metric', displayStr) + setAttribute('value', num)
// Vue's custom element wrapper (_setAttr → _setProp → _update) handles re-render + color

(function () {
  'use strict';

  let metricRegistry = {
    "blank rate": { min: 2, max: 25, type: "percent" },
    "drop rate": { min: 5, max: 45, type: "percent" },
    "refill rate": { min: 3, max: 30, type: "percent" },
    "attractiveness rate": { min: 5, max: 65, type: "percent" },
    "click rate (pageview level)": { min: 0.5, max: 12, type: "percent" },
    "click rate (session level)": { min: 0.8, max: 15, type: "percent" },
    "click distribution": { min: 1, max: 25, type: "percent" },
    "exposure rate": { min: 20, max: 100, type: "percent" },
    "engagement rate": { min: 5, max: 45, type: "percent" },
    "hover rate": { min: 10, max: 55, type: "percent" },
    "conversion rate per click": { min: 0.2, max: 6.5, type: "percent_long" },
    "conversion rate per hover": { min: 0.1, max: 4.5, type: "percent_long" },
    "purchase - cr per click": { min: 0.3, max: 5.5, type: "percent_long" },
    "purchase - cr per hover": { min: 0.1, max: 3.5, type: "percent_long" },
    "time before first click": { min: 3, max: 20, type: "time" },
    "exposure time": { min: 2, max: 35, type: "time" },
    "float time": { min: 1, max: 15, type: "time" },
    "hesitation time": { min: 1.5, max: 12, type: "time" },
    "revenue": { min: 250, max: 5000, type: "currency" },
    "revenue per click": { min: 5, max: 150, type: "currency" },
    "number of clicks": { min: 50, max: 4500, type: "count" },
    "click recurrence": { min: 1.0, max: 2.5, type: "decimal" }
  };

  window.__CS_DEBUG__ = {
    getUrlKey: () => (typeof getUrlKey !== 'undefined' ? getUrlKey() : 'not_loaded'),
    getOverrides: () => (typeof overrides !== 'undefined' ? overrides : {}),
    // This will now report the result of our "Double-Drill"
    readMetric: () => (typeof readCsMetricTypeName !== 'undefined' ? readCsMetricTypeName() : 'not_loaded'),
    applyNow: () => (typeof applyAllOverrides !== 'undefined' ? applyAllOverrides() : null),
    syncNow: () => (typeof syncZoneWatchers !== 'undefined' ? syncZoneWatchers() : null)
  };

  const existingInstance = document.documentElement?.getAttribute('data-cs-demo-instance');
  if (existingInstance) {
    return;
  }
  const bootstrapInstance = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  document.documentElement?.setAttribute('data-cs-demo-instance', bootstrapInstance);

  const CS_DEBUG = false;
  const CS_FORCE_CONTEXT = true;
  const CS_DEFAULT_LOG_MODE = 'off'; // 'trace' | 'all' | 'off'
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

    // CORE FIX: Include stable query params and window.name to differentiate 
    // side-by-side panes without relying on the volatile JWT hash.
    const search = location.search || '';
    const frameName = window.name ? `|name:${window.name}` : '';
    return `sub:${location.origin}${location.pathname}${search}${frameName}`;
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
  let isBulkGenerating = false;

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
    // Priority 1: Use the global activePageKey if set
    if (activePageKey) return activePageKey;

    // Priority 2: Extract Report ID from the URL (The most stable ID)
    const url = window.location.href;
    const reportMatch = url.match(/\/zoning-v2\/(\d+)/) || url.match(/\/report\/(\d+)/);
    if (reportMatch && reportMatch[1]) {
      return `cs-report-${reportMatch[1]}`;
    }

    // Priority 3: Project + Snapshot fallback
    const params = new URLSearchParams(window.location.search || window.top.location.search);
    const pid = params.get('projectId');
    const snid = params.get('snapshot');
    if (pid && snid) return `cs-page-${pid}-${snid}`;

    return normalizeCsUrlKey(url);
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
    if (node && node.isConnected) {
       // Guard against false-positive static UI elements after tab swaps
       const isValid = closestAcrossShadow(node, 'app-heatmap-scroll-element, hj-heatmaps-report, [class*="layers-container"], [data-qa-id*="heatmap"]');
       if (isValid) return node;
    }
    return null;
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

  function getVirtualScrollDeltaState(eventPath = []) {
    // Look for the massive heatmap canvas and track its physical position
    const canvases = getAllElementsByTag('canvas');
    for (let i = 0; i < canvases.length; i++) {
      if (canvases[i].clientHeight > window.innerHeight * 1.05) {
        const rect = canvases[i].getBoundingClientRect();
        return { x: rect.left, y: rect.top };
      }
    }
    // Fallback if canvas is hidden
    const el = findHeatmapScrollTransformElement(eventPath);
    return getCSSTranslate(el);
  }

  // Finds the element CS uses for virtual scroll via CSS transform.
  // CS scrolls its heatmap viewer by applying transform: translateY() to an inner layer element,
  // not via scrollTop. We identify that element so we can track its translate delta.
  function findHeatmapScrollTransformElement(composedPathArr) {
    const boundarySels = 'app-heatmap-scroll-element, hj-heatmaps-report, [data-cs-qa-id="heatmap-report-container"], [data-qa-id="heatmap-report-container"], [id*="layers-container"], [class*="layers-container"]';
    const roots = getAllElementsBySelector(boundarySels);
    
    for (const root of roots) {
       // Look for an element with an explicit inline transform (CS virtual scroll)
       const transformedChild = root.querySelector('[style*="transform"]');
       if (transformedChild) return transformedChild;
       
       // Fallback: check shadow roots
       if (root.shadowRoot) {
          const shadowTransformed = root.shadowRoot.querySelector('[style*="transform"]');
          if (shadowTransformed) return shadowTransformed;
       }
    }
    
    // Secondary fallback: computed style search
    for (const root of roots) {
       const children = root.shadowRoot ? root.shadowRoot.querySelectorAll('*') : root.querySelectorAll('*');
       for (const child of children) {
          try {
             const style = window.getComputedStyle(child);
             if (style.transform && style.transform !== 'none') return child;
             if (style.willChange.includes('transform')) return child;
          } catch(e) {}
       }
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
    // NEW: Use the robust Canvas tracker to record initial state
    const transformTranslate = getVirtualScrollDeltaState(eventPath);
    
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
        left: 0;
        top: 0;
        will-change: transform;
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
      let customGradient = '';
      if (level === 'high') {
        customGradient = 'radial-gradient(circle closest-side, rgba(165, 50, 85, 1) 0%, rgba(225, 115, 80, 1) 20%, rgba(240, 230, 120, 0.9) 45%, rgba(130, 200, 130, 0.75) 65%, rgba(75, 105, 175, 0.5) 85%, rgba(75, 105, 175, 0) 100%)';
      } else if (level === 'medium') {
        customGradient = 'radial-gradient(circle closest-side, rgba(240, 230, 120, 1) 0%, rgba(130, 200, 130, 0.85) 35%, rgba(75, 105, 175, 0.6) 70%, rgba(75, 105, 175, 0) 100%)';
      } else { // low
        customGradient = 'radial-gradient(circle closest-side, rgba(175, 215, 145, 0.9) 0%, rgba(85, 175, 195, 0.7) 40%, rgba(75, 105, 175, 0.4) 75%, rgba(75, 105, 175, 0) 100%)';
      }

      // Retain your exact original sizing logic!
      const ringDiameter = Math.round((20 + fieldForSize * 10) * 1.05);

      return {
        glowW: ringDiameter,
        glowH: Math.round(ringDiameter * profile.stretchY),
        innerW: 0, // Disable the hard inner bullseye
        innerH: 0,
        blur: 0,
        innerBlur: 0,
        mixBlendMode: 'multiply', // Crucial for overlapping heat effect
        outerBorder: 'none',
        outerGradient: customGradient,
        innerGradient: 'none', // Hides the inner div
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
    heatmapSurfaceOverlays.forEach((shadow, surface) => {
      if (!surface.isConnected) {
        if (shadow._host?.isConnected) shadow._host.remove();
        heatmapSurfaceOverlays.delete(surface);
      }
    });

    const viewportShadow = ensureHeatmapOverlayHost();
    if (!viewportShadow) return;

    const analysisMode = getActiveAnalysisMode();
    const heatmapEditingCtx = isHeatmapEditingContext();
    const heatmapView = isLikelyHeatmapView();
    const showHeatmapOverlays = uiVisible && (analysisMode === 'heatmap' || heatmapEditingCtx || heatmapView);

    if (!showHeatmapOverlays) {
      clearHeatmapPointOverlaysNow();
      return;
    }

    const activeLayer = normalizeHeatmapLayerName(getActiveHeatmapLayerName());
    const enforceStrictBounds = activeLayer === 'clicks';
    const layerPoints = Object.values(heatmapPointOverrides).filter(point => {
      if (!point || normalizeHeatmapLayerName(point.layer) !== activeLayer) return false;
      const pointFrame = String(point.frameContextKey || (isTopFrame ? 'top' : ''));
      if (!pointFrame) return false;
      if (pointFrame === frameContextKey) return true;
      return pointFrame === 'top' && isTopFrame;
    });

    const numericValues = layerPoints.map(point => Number(point?.value)).filter(Number.isFinite);
    const bounds = {
      min: numericValues.length ? Math.min(...numericValues) : 0,
      max: numericValues.length ? Math.max(...numericValues) : 100
    };

    const viewportEntries = [];
    
    // NEW: Evaluate the current canvas position
    const heatmapTransformNow = getVirtualScrollDeltaState([]);
    
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
        return pos.x >= surfaceRect.left && pos.x <= surfaceRect.right && pos.y >= surfaceRect.top && pos.y <= surfaceRect.bottom;
      };
      const isInsideClipBounds = pos => {
        if (!clipRect) return true;
        return pos.x >= clipRect.left && pos.x <= clipRect.right && pos.y >= clipRect.top && pos.y <= clipRect.bottom;
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
        const baseClientX = Number.isFinite(Number(point.pageX)) ? (Number(point.pageX) - Number(window.scrollX || 0)) : (window.innerWidth * Number(point.xPct || 0));
        const baseClientY = Number.isFinite(Number(point.pageY)) ? (Number(point.pageY) - Number(window.scrollY || 0)) : (window.innerHeight * Number(point.yPct || 0));
        const pointMotionContainer = getHeatmapMotionContainerAtPoint(baseClientX, baseClientY, surface);
        const forcedContainer = (pointMotionContainer && pointMotionContainer.isConnected) ? pointMotionContainer : ((fallbackScrollContainer && fallbackScrollContainer.isConnected) ? fallbackScrollContainer : getBestViewportFallbackContainer());
        if (forcedContainer && forcedContainer.isConnected) {
          const forcedRect = forcedContainer.getBoundingClientRect();
          if (!Number.isFinite(Number(point.anchorContentX))) point.anchorContentX = Number(forcedContainer.scrollLeft || 0) + (baseClientX - forcedRect.left);
          if (!Number.isFinite(Number(point.anchorContentY))) point.anchorContentY = Number(forcedContainer.scrollTop || 0) + (baseClientY - forcedRect.top);
          if (!Number.isFinite(Number(point.anchorStartScrollLeft))) point.anchorStartScrollLeft = Number(forcedContainer.scrollLeft || 0);
          if (!Number.isFinite(Number(point.anchorStartScrollTop))) point.anchorStartScrollTop = Number(forcedContainer.scrollTop || 0);
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
      if (!pos || !Number.isFinite(Number(pos.x)) || !Number.isFinite(Number(pos.y)) || !isRenderablePosition(pos)) return;
      viewportEntries.push({ point, pos });
    });

    if (viewportShadow) {
      const activeMarkerIds = new Set();

      viewportEntries.forEach(({ point, pos }) => {
        const safePointId = point.pointId.replace(/:/g, '-');
        const markerId = `hm-marker-${safePointId}`;
        activeMarkerIds.add(markerId);

        let marker = viewportShadow.querySelector(`[id="${markerId}"]`);
        const visual = buildHeatmapMarkerVisual(point, bounds, activeLayer);

        if (!marker) {
          marker = document.createElement('div');
          marker.id = markerId;
          marker.className = 'marker';

          const outerGlow = document.createElement('div');
          outerGlow.className = 'marker-glow outer-glow';
          marker.appendChild(outerGlow);

          const innerGlow = document.createElement('div');
          innerGlow.className = 'marker-glow inner-glow';
          marker.appendChild(innerGlow);

          viewportShadow.appendChild(marker);
        }

        marker.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`;

        const outerGlow = marker.querySelector('.outer-glow');
        if (outerGlow) {
          outerGlow.style.width = `${visual.glowW}px`;
          outerGlow.style.height = `${visual.glowH}px`;
          outerGlow.style.mixBlendMode = visual.mixBlendMode || 'screen';
          outerGlow.style.background = visual.outerGradient || `radial-gradient(ellipse at center, ${visual.outerColor} 0%, rgba(255,255,255,0) 72%)`;
          outerGlow.style.filter = `blur(${visual.blur}px)`;
          outerGlow.style.border = visual.outerBorder || 'none';
        }

        const innerGlow = marker.querySelector('.inner-glow');
        if (innerGlow) {
          innerGlow.style.width = `${visual.innerW}px`;
          innerGlow.style.height = `${visual.innerH}px`;
          innerGlow.style.mixBlendMode = visual.mixBlendMode || 'screen';
          innerGlow.style.background = visual.innerGradient || `radial-gradient(ellipse at center, ${visual.innerColor} 0%, rgba(255,255,255,0) 74%)`;
          innerGlow.style.filter = `blur(${typeof visual.innerBlur === 'number' ? visual.innerBlur : Math.max(2, Math.round(visual.blur * 0.28))}px)`;
        }
      });

      Array.from(viewportShadow.children).forEach(child => {
        if (child.classList.contains('marker') && !activeMarkerIds.has(child.id)) {
          child.remove();
        }
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




  let heatmapOverlayLoopRunning = false;
  
  function scheduleHeatmapOverlayRender() {
    if (heatmapOverlayLoopRunning) return;
    heatmapOverlayLoopRunning = true;
    
    const loop = () => {
      const mode = getActiveAnalysisMode();
      // If the heatmap is visible, sync the markers 60 times a second
      if (uiVisible && (mode === 'heatmap' || isHeatmapEditingContext() || isLikelyHeatmapView())) {
        renderHeatmapPointOverlays();
        requestAnimationFrame(loop);
      } else {
        // If we switch to Zoning, kill the loop and hide the markers
        clearHeatmapPointOverlaysNow();
        heatmapOverlayLoopRunning = false;
      }
    };
    requestAnimationFrame(loop);
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
    if (!override) return;
    
    // 1. CAPTURE ORIGINALS (including color!)
    if (!el.hasAttribute('data-cs-demo-orig-metric')) {
      el.setAttribute('data-cs-demo-orig-metric', el.getAttribute('metric') || '');
      
      if (el.hasAttribute('value')) {
        el.setAttribute('data-cs-demo-orig-value', String(el.getAttribute('value') || ''));
      }
      
      if (el.hasAttribute('color')) {
        el.setAttribute('data-cs-demo-orig-color', String(el.getAttribute('color') || ''));
      }
    }

    // 2. APPLY OVERRIDE
    const metricDisplay = typeof override === 'object' ? override.metric : override;
    const valueNum = typeof override === 'object' ? override.value : undefined;

    el.setAttribute('metric', metricDisplay);
    
    if (valueNum !== undefined && !isNaN(Number(valueNum))) {
      el.setAttribute('value', String(valueNum));
      const derivedColor = getDerivedZoneColor(el, Number(valueNum));
      if (derivedColor) el.setAttribute('color', derivedColor);
    }
    
    el.style.outline = '2px dashed rgba(255, 210, 50, 0.9)';
    el.style.outlineOffset = '-2px';
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
      } catch (_) { }

      try {
        // CORE FIX: Removed win.location.search
        const frameName = win.name ? `|name:${win.name}` : '';
        return `sub:${win.location.origin}${win.location.pathname}${frameName}`;
      } catch (_) {
        return frameScopeKey;
      }
    };
    
    const withFrameScope = (base, node) => {
      const scope = getElementFrameScope(node);
      return scope === 'top' ? base : `${base}|${scope}`;
    };
    
    // Always determine side by comparing the pane's bounding rect to the viewport center
    const getHorizontalSide = rect => {
      // PRO FIX: If the Top Frame told us who we are, believe it!
      if (window.__csDemoPaneSide) return window.__csDemoPaneSide;
      
      if (!rect) return 'left';
      // Use only the current window's innerWidth to avoid cross-origin errors
      const viewportCenter = window.innerWidth / 2;
      const centerX = Number(rect.left) + Number(rect.width) / 2;
      return centerX > viewportCenter ? 'right' : 'left';
    };
    
    // Use the closest compare-pane host (zn-snapshot-header or app-zonings) to determine side
    const zoneRect = (() => {
      try {
        // Prefer the bounding rect of the compare-pane host if available
        const snapshotHost = closestAcrossShadow(el, 'zn-snapshot-header');
        if (snapshotHost) return snapshotHost.getBoundingClientRect();
        const zoningsHost = closestAcrossShadow(el, 'app-zonings');
        if (zoningsHost) return zoningsHost.getBoundingClientRect();
        return el.getBoundingClientRect();
      } catch (_) { return null; }
    })();
    const zoneSide = getHorizontalSide(zoneRect);
    const withCompareSide = base => `${base}|cmp-side:${zoneSide}`;

    // Compare pages expose snapshot-pane hosts; use their left/right order as
    // the strongest pane identity signal when available.
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
        // In split-screen comparison mode, both panes share the same fullpath.
        // Append the pane index so overrides are scoped per pane independently.
        const sameFullpath = allScrollContainers.filter(c => c.getAttribute('fullpath') === fullpath);
        if (sameFullpath.length > 1) {
          const idx = sameFullpath.indexOf(scrollContainer);
          return withFrameScope(withCompareSide(`fullpath:${fullpath}:${idx}`), scrollContainer);
        }

        // Shadow-rooted compare panes may hide sibling scroll containers from document.querySelectorAll.
        // Detect a split layout by container width and add a horizontal bucket discriminator.
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

    // Fallback for unexpected DOM layouts: segment by horizontal position.
    const rect = el.getBoundingClientRect();
    const side = getHorizontalSide(rect);
    return withFrameScope(withCompareSide(`side:${side}`), el);
  }

  function getZoneKey(el) {
    const zoneId = el.getAttribute('id');
    if (!zoneId) return null;
    
    const paneKey = getPaneKey(el);
    if (!paneKey) return null;

    // CORE FIX: We rely entirely on paneKey + zoneId. 
    // Stripping the duplicate index prevents the 62-zone Vue transition panic!
    return `${paneKey}::${zoneId}`;
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

  let csActiveMetrics = { left: "", right: "", global: "" };
  let isCompareMode = false;

  function getActiveMetricForZone(zoneKey) {
    if (!isCompareMode) return (csMetricTypeName || "").toLowerCase();
    
    // BULLETPROOF: If the Top Frame whispered our identity, use it!
    if (window.__csDemoPaneSide === 'right') return csActiveMetrics.right;
    if (window.__csDemoPaneSide === 'left') return csActiveMetrics.left;
    
    // Fallback for Top Frame zones
    return (zoneKey && (zoneKey.includes('cmp-side:right') || zoneKey.includes('side:right'))) 
      ? csActiveMetrics.right 
      : csActiveMetrics.left;
  }

  function readCsMetricTypeName(forceShout = false) {
    if (!isTopFrame) return (csMetricTypeName || "").toLowerCase();

    try {
      const triggers = getAllElementsBySelector('.metric-selector-trigger, [data-testid*="metric-selector"], [data-testid="analysis-mode-selector"], .form-analysis-label');
      const visibleTriggers = [];
      
      for (const t of triggers) {
        const span = t.querySelector('span') || t;
        const text = span.textContent?.trim()?.toLowerCase() || "";
        const rect = t.getBoundingClientRect();
        
        if (text && text !== 'select metric' && rect.width > 0 && rect.height > 0) {
          visibleTriggers.push({ text, rect });
        }
      }

      let changed = false;
      let newMetrics = { left: "", right: "", global: "" };
      let newCompareMode = visibleTriggers.length > 1;

      if (newCompareMode) {
        visibleTriggers.sort((a, b) => a.rect.left - b.rect.left);
        newMetrics.left = visibleTriggers[0].text;
        newMetrics.right = visibleTriggers[visibleTriggers.length - 1].text;
        newMetrics.global = newMetrics.left; 

        // BULLETPROOF WHISPER: Pierce the shadow DOM to find the massive compare iframes!
        const iframes = getAllElementsByTag('iframe').filter(f => {
           try { 
             const r = f.getBoundingClientRect();
             // Filter out tiny hidden tracking iframes. Compare iframes are massive.
             return r.width > window.innerWidth * 0.25; 
           } catch(e) { return false; }
        });
        
        iframes.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
        if (iframes.length >= 2) {
           iframes[0].contentWindow?.postMessage({ __csDemoPaneSide: 'left' }, '*');
           iframes[iframes.length - 1].contentWindow?.postMessage({ __csDemoPaneSide: 'right' }, '*');
        }

      } else if (visibleTriggers.length === 1) {
        newMetrics.global = visibleTriggers[0].text;
        newMetrics.left = visibleTriggers[0].text;
        newMetrics.right = visibleTriggers[0].text;
      }

      if (newMetrics.left !== csActiveMetrics.left || 
          newMetrics.right !== csActiveMetrics.right || 
          newMetrics.global !== csActiveMetrics.global || 
          isCompareMode !== newCompareMode) {
          changed = true;
      }

      if (changed || forceShout) {
        csActiveMetrics = newMetrics;
        isCompareMode = newCompareMode;
        csMetricTypeName = newMetrics.global;

        applyAllOverrides();

        chrome.runtime.sendMessage({
          type: 'broadcastToTab',
          payload: { type: 'syncMetricName', metrics: newMetrics, isCompare: newCompareMode }
        }, () => { void chrome.runtime.lastError; }); 
      }
    } catch (e) { }

    return (csMetricTypeName || "").toLowerCase();
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

  function getPaneLabel(el) {
    if (!el) return '';
    let hasLeft = false, hasRight = false;
    const center = window.innerWidth / 2;
    
    getAllZoneElements().forEach(zone => {
       const rect = zone.getBoundingClientRect();
       if (rect.left + rect.width / 2 > center) hasRight = true;
       else hasLeft = true;
    });
    
    // Only append labels if there are actively zones on both sides of the screen
    if (hasLeft && hasRight) {
       const elRect = el.getBoundingClientRect();
       return (elRect.left + elRect.width / 2 > center) ? ' (Right Pane)' : ' (Left Pane)';
    }
    return '';
  }


  function getPaneLabelFromKey(zoneKey) {
    if (!zoneKey) return '';
    // The key already knows which side it's on! Just read it directly.
    if (zoneKey.includes('cmp-side:right') || zoneKey.includes('side:right')) {
      return ' (Right Pane)';
    }
    if (zoneKey.includes('cmp-side:left') || zoneKey.includes('side:left')) {
      return ' (Left Pane)';
    }
    return '';
  }


  function generateDefaultZoneName(origMetric, csTypeName, paneSide = 'left') {
    const resolvedType = isMetricTypeCompatible(origMetric, csTypeName) ? csTypeName : '';
    const base = resolvedType || inferMetricLabel(origMetric);
    const existingOfBase = Object.values(overrides).filter(ov => {
      const ovType = isMetricTypeCompatible(ov.origMetric || '', ov.csMetricTypeName) ? ov.csMetricTypeName : '';
      const b = ovType || inferMetricLabel(ov.origMetric || '');
      return b === base;
    }).length;
    
    // Add "(Right Pane)" dynamically if we are on a split screen
    const isSplitScreen = window.innerWidth > 1200; // rough heuristic for compare mode
    const sideLabel = isSplitScreen && paneSide === 'right' ? ' (Right Pane)' : (isSplitScreen ? ' (Left Pane)' : '');
    
    return `${base} ${existingOfBase + 1}${sideLabel}`;
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
  function getOverrideForElement(el) {
    const zoneKey = getZoneKey(el);
    if (!zoneKey) return null;

    // CRITICAL FIX: Ask the helper which metric side this zone belongs to!
    const activeMetricName = getActiveMetricForZone(zoneKey);

    if (activeMetricName) {
      // 1. EXACT MATCH
      const exactKey = `${zoneKey}@${activeMetricName}`;
      if (overrides[exactKey]) {
        return { key: exactKey, override: overrides[exactKey] };
      }

      // 2. FUZZY MATCH
      const prefix = `${zoneKey}@`;
      const fuzzyKey = Object.keys(overrides).find(k => {
        if (!k.startsWith(prefix)) return false;
        const storedMetric = k.substring(prefix.length).toLowerCase().trim(); 
        const uiMetric = activeMetricName.toLowerCase().trim();
        
        // A. Exact match is always a win
        if (storedMetric === uiMetric) return true;
        
        // B. Form Analysis protection: 
        // If the UI is showing a Form metric, do NOT allow partial "Rate" matches.
        const formMetrics = ['blank rate', 'drop rate', 'refill rate'];
        if (formMetrics.some(m => uiMetric.includes(m))) {
           return storedMetric === uiMetric; // Force exact match for form fields
        }

        // C. Standard Fuzzy Match (Preserves functionality for "Click Rate" vs "Click Rate (pageview level)")
        return storedMetric.includes(uiMetric) || uiMetric.includes(storedMetric);
      });

      if (fuzzyKey) {
        return { key: fuzzyKey, override: overrides[fuzzyKey] };
      }
    }

    // 3. FALLBACK: Catch manual edits
    if (overrides[zoneKey]) {
      return { key: zoneKey, override: overrides[zoneKey] };
    }
    
    return null;
  }

  function onZoneClick(zoneEl, e) {
    if (!editMode || !zoneEl || !uiVisible) return;
    const editorState = buildEditorState(zoneEl, e); // Pass the mouse event!

    log('Intercepted zone click. id=', editorState.zoneId, 'key=', editorState.zoneKey, 'frame=', editorState.frameContextKey, 'debug=', getZoneDebugSnapshot(zoneEl));
    e.stopPropagation();
    e.preventDefault();
    e.stopImmediatePropagation();

    if (!isTopFrame) {
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

  function buildEditorState(zoneEl, event = null) {
    const zoneId = zoneEl.getAttribute('id') || '';
    const paneKey = getPaneKey(zoneEl) || '';
    const zoneKey = getZoneKey(zoneEl) || (zoneId && paneKey ? `${paneKey}::${zoneId}` : zoneId);
    const currentMetric = zoneEl.getAttribute('metric') || '';
    const currentValue = zoneEl.getAttribute('value') || String(parseFloat(currentMetric) || 0);
    const existing = getOverrideForElement(zoneEl);
    const zoneName = existing?.override?.zoneName || '';
    const origMetric = existing?.override?.origMetric || currentMetric;
    refreshMetricTypeName();

    let limitMin = 0;
    let limitMax = 100;
    try {
      const cl = JSON.parse(zoneEl.getAttribute('color-limits') || '{}');
      if (cl.limitMin !== undefined) limitMin = cl.limitMin;
      if (cl.limitMax !== undefined) limitMax = cl.limitMax;
    } catch (_) {}

    return {
      frameContextKey, zoneId, zoneKey, currentMetric, currentValue,
      hasOverride: !!existing, limitMin, limitMax, zoneName, origMetric,
      csMetricTypeName: csMetricTypeName,
      screenX: event ? event.screenX : 0 // CAPTURE THE ABSOLUTE MOUSE POSITION
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
    const origColor = (rawOrigColor === null || rawOrigColor === undefined) ? '' : String(rawOrigColor);

    // CRITICAL FIX: Save using the Metric Name (e.g., "click rate"), NOT the literal string ("12.5%")!
    const resolvedTypeName = getActiveMetricForZone(resolvedZoneKey) || csTypeName || csMetricTypeName || '';
    const metricKeyName = resolvedTypeName || origMetric;
    const newKey = `${resolvedZoneKey}@${metricKeyName}`;

    if (existing && existing.key !== newKey) {
      delete overrides[existing.key];
    }
    if (overrides[resolvedZoneKey]) delete overrides[resolvedZoneKey]; 
    if (zoneId && zoneId !== resolvedZoneKey && overrides[zoneId]) delete overrides[zoneId];

    // SAFE: Pass the resolvedZoneKey into the generator so it can extract the side text
    const finalName = zoneName || existingOv?.zoneName || generateDefaultZoneName(origMetric, resolvedTypeName, resolvedZoneKey);
    
    overrides[newKey] = { metric, value, origMetric, origValue, origColor, zoneName: finalName, csMetricTypeName: resolvedTypeName };

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

  function watchZone(el) {
    const zoneKey = getZoneKey(el);
    if (!zoneKey) return;

    const existingWatcher = zoneObservers.get(zoneKey);
    if (existingWatcher && existingWatcher.element === el) return;

    if (existingWatcher && existingWatcher.element !== el) {
      existingWatcher.observer.disconnect();
      ['pointerup', 'mouseup', 'click', 'contextmenu'].forEach(type => {
        existingWatcher.element.removeEventListener(type, onZoneElementClick, true);
      });
      zoneObservers.delete(zoneKey);
    }

    const match = getOverrideForElement(el);
    if (match) applyOverride(el, match.override);

    const mo = new MutationObserver((mutations) => {
      const match = getOverrideForElement(el);
      if (match) {
        const ov = match.override;
        // If the current metric on screen doesn't match our override, FORCE IT BACK
        if (el.getAttribute('metric') !== ov.metric) {
          applyOverride(el, ov); 
        }
      }
    });
    
    mo.observe(el, { attributes: true, attributeFilter: ['metric', 'value'] });

    zoneObservers.set(zoneKey, { observer: mo, element: el });

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
    // Force the top frame to continuously check if the user switched metrics in the UI
    if (isTopFrame) readCsMetricTypeName();

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
    
    // FIX: Force an immediate evaluation of overlays when the DOM mutates (e.g. switching tabs)
    renderHeatmapPointOverlays();
  }

  function applyAllOverrides() {
    const zoneElements = getAllZoneElements();
    if (window.__ZONING_DEBUG_LOG__ !== false) {
      // console.log('[ZONING-DEBUG][applyAllOverrides] zoneElements.length:', zoneElements.length);
    }
    zoneElements.forEach(el => {
      const key = getZoneKey(el);
      const existing = getOverrideForElement(el);
      if (window.__ZONING_DEBUG_LOG__ !== false) {
        // console.log('[ZONING-DEBUG][applyAllOverrides]', {
        //   el,
        //   key,
        //   hasOverride: !!existing,
        //   override: existing?.override,
        //   allOverrideKeys: Object.keys(overrides)
        // });
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
    const editorState = buildEditorState(zoneEl, e); // Pass the mouse event!

    log('Intercepted zone click. id=', editorState.zoneId, 'key=', editorState.zoneKey, 'frame=', editorState.frameContextKey, 'debug=', getZoneDebugSnapshot(zoneEl));
    e.stopPropagation();
    e.preventDefault();
    e.stopImmediatePropagation();

    if (!isTopFrame) {
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

    // SPATIAL MATH: Calculate side based on absolute monitor position
    let paneSide = 'left';
    if (editorState.screenX) {
      const browserCenter = window.screenX + (window.outerWidth / 2);
      paneSide = editorState.screenX > browserCenter ? 'right' : 'left';
    }

    const isHeatmapPointEditor = editorState.kind === 'heatmap-point';
    const zoneId = editorState.zoneId || '';
    const zoneKey = editorState.zoneKey || zoneId;
    const currentMetric = editorState.currentMetric || '';
    const currentValue = editorState.currentValue || String(parseFloat(currentMetric) || 0);
    const hasOverride = !!editorState.hasOverride;
    
    // FETCH METRIC USING THE NEW AMBIDEXTROUS HELPER
    const activeMetricForPane = getActiveMetricForZone(zoneKey);
    const csTypeNameForState = activeMetricForPane || editorState.csMetricTypeName || '';
    const csTypeName = isMetricTypeCompatible(currentMetric, csTypeNameForState) ? csTypeNameForState : '';
    
    let existingZoneName = editorState.zoneName || '';
    if (!existingZoneName && !hasOverride) {
      existingZoneName = generateDefaultZoneName(editorState.origMetric, csTypeNameForState, paneSide);
    }

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
      // console.log('[ZONING-DEBUG][saveZoneOverride]', {
      //   frameScope,
      //   paneKey,
      //   zoneKey,
      //   value,
      //   location: window.location.href
      // });
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
  const resetAllInFrame = async () => {
    const zoneEls = getAllZoneElements();
    
    zoneEls.forEach(el => {
      // 1. RESTORE ORIGINALS
      // If we captured real data, put it back.
      if (el.hasAttribute('data-cs-demo-orig-metric')) {
        const origMetric = el.getAttribute('data-cs-demo-orig-metric');
        const origValue = el.getAttribute('data-cs-demo-orig-value');
        const origColor = el.getAttribute('data-cs-demo-orig-color');

        // Only set attributes if they weren't empty strings to begin with
        if (origMetric) el.setAttribute('metric', origMetric);
        
        if (origValue !== null && origValue !== "null") {
          el.setAttribute('value', origValue);
        } else {
          el.removeAttribute('value');
        }

        if (origColor && origColor !== "null") {
          el.setAttribute('color', origColor);
        } else {
          // If there was no original color, let CSQ decide
          el.removeAttribute('color');
        }
      }

      // 2. ONLY REMOVE OUR TRACKING MARKERS
      // We STOP removing 'metric', 'value', and 'color' here 
      // unless we specifically put them there ourselves.
      el.removeAttribute('data-cs-demo-orig-metric');
      el.removeAttribute('data-cs-demo-orig-value');
      el.removeAttribute('data-cs-demo-orig-color');
      
      clearEditedStyle(el);
    });

    // 3. INTERNAL CLEANUP
    overrides = {};
    heatmapPointOverrides = {};

    // 4. GENTLE RE-TRIGGER
    // We don't hide/show anymore, just a resize event to tell CSQ to refresh
    window.dispatchEvent(new Event('resize'));
    
    zoneObservers.forEach(entry => entry.observer.disconnect());
    zoneObservers.clear();
    syncZoneWatchers();
    
    //console.log("[CS Debug] 🧼 Safe Reset: Restored originals and cleared markers.");
  };

  const resetAll = async (skipConfirm) => {
    const count = getTotalOverrideCount();
    if (count === 0) return;
    
    if (skipConfirm !== true) {
      if (!confirm(`Reset all ${count} override${count !== 1 ? 's' : ''} on this page?`)) return;
    }

    if (isTopFrame) {
      await new Promise(resolve => {
        chrome.runtime.sendMessage({
          type: 'broadcastToTab',
          payload: { type: 'resetAllFrames' }
        }, () => {
          void chrome.runtime.lastError;
          resolve(true);
        });
      });
      await resetAllInFrame();
      await persistOverrides();
      await persistHeatmapPointOverrides();
    } else {
      await resetAllInFrame();
    }

    updateToolbar();
  };

  async function applyBulkFillToCurrentMetric(maxVal, minVal) {
    isBulkGenerating = true;
    if (isTopFrame) {
      // 1. Force a fresh read immediately when the button is clicked
      const syncName = readCsMetricTypeName(); 
      
      if (!syncName) {
         //console.warn("[CS Debug] Shout aborted: Metric name still empty. Waiting 150ms...");
         // Give the shadow DOM a moment to be reached if it was just rendered
         await new Promise(r => setTimeout(r, 150));
         readCsMetricTypeName(); 
      }

      // 2. Shout the name to the subframes
      chrome.runtime.sendMessage({
        type: 'broadcastToTab',
        payload: { type: 'syncMetricName', name: csMetricTypeName }
      });
    }

    // 3. Tiny delay for the subframe to receive the message and update its local variable
    await new Promise(r => setTimeout(r, 100));

    refreshMetricTypeName();
    const currentMetricName = String(csMetricTypeName || '').trim();

    let zoneElements = getCandidateZoneElements();
    if (zoneElements.length === 0) {
      syncZoneWatchers();
      await new Promise(resolve => setTimeout(resolve, 50));
      zoneElements = getCandidateZoneElements();
    }

    // ... (rest of your logic remains the same below) ...
    let hasPercent = false;
    let hasCurrency = false;
    let hasTime = false;
    let hasDecimal = false;

    const eligibleZones = [];
    zoneElements.forEach(el => {
      const existing = getOverrideForElement(el);
      if (existing) return; 

      const curMetric = (el.getAttribute('metric') || '').trim();
      const curValueAttr = el.getAttribute('value');

      if (curMetric.includes('%')) hasPercent = true;
      if (/[€$£¥]/.test(curMetric)) hasCurrency = true;
      if (/\d\s*s\b/.test(curMetric) || curMetric.endsWith('s')) hasTime = true;
      if (/[\.,]\d/.test(curMetric)) hasDecimal = true;

      let numVal = NaN;
      if (curValueAttr !== null && curValueAttr.trim() !== '') {
        numVal = parseFloat(curValueAttr);
      } else {
        numVal = parseFloat(curMetric.replace(/[^0-9.,-]/g, '').replace(',', '.'));
      }

      // We want to fill everything that doesn't have an override yet, even if it has native data (> 0)
      const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
      const y = rect && Number.isFinite(rect.top) && Number.isFinite(rect.height)
        ? (rect.top + rect.height / 2)
        : Number.NaN;
      eligibleZones.push({ el, y, zoneId: el.getAttribute('id') || '', zoneKey: getZoneKey(el) || '' });

    });

    if (eligibleZones.length === 0) {
      isBulkGenerating = false;
      return { applied: 0, totalZones: zoneElements.length };
    }

    const isCurrency = hasCurrency || /(revenue|sales|order|transaction|aov|cart|price)/i.test(currentMetricName);
    const isPercentage = hasPercent || /(rate|ratio|conversion|bounce|engagement|attractiveness|activity|exposure)/i.test(currentMetricName) || currentMetricName.includes('%');
    const isTime = hasTime || /(time|duration|seconds?)/i.test(currentMetricName);
    const isDecimal = hasDecimal || /(recurrence|average|per session|per user)/i.test(currentMetricName);

    const formatMetricValue = (val) => {
      if (isCurrency) return `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      if (isPercentage) return `${val.toFixed(1)}%`;
      if (isTime) return `${val.toFixed(1)}s`;
      if (isDecimal) return val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return Math.round(val).toLocaleString('en-US');
    };

    // Group eligible zones by pane so Left and Right don't mix their distributions
    const paneGroups = {};
    eligibleZones.forEach(row => {
      const pKey = getPaneKey(row.el) || 'default';
      if (!paneGroups[pKey]) paneGroups[pKey] = [];
      paneGroups[pKey].push(row);
    });

    let applied = 0;
    Object.keys(paneGroups).forEach((pKey) => {
      const group = paneGroups[pKey].sort((a, b) => (Number.isFinite(a.y) ? a.y : 0) - (Number.isFinite(b.y) ? b.y : 0));
      const totalEligible = group.length;

      // Pane-Aware Variance: Identify right pane by key
      const isRightPane = pKey.includes('right');
      const variance = isRightPane ? 0.88 : 1; // 12% drop for the right side
      const pMax = maxVal * variance;
      const pMin = minVal * variance;

      group.forEach((row, index) => {
        if (!row.zoneKey) return;
        const targetMetricName = getActiveMetricForZone(row.zoneKey) || currentMetricName;

        let numericValue = pMax;
        if (totalEligible > 1) {
          const ratio = index / (totalEligible - 1);
          numericValue = pMax - (ratio * (pMax - pMin));
        }
        
        const displayMetric = formatMetricValue(numericValue);
        const metricKey = `${row.zoneKey}@${targetMetricName}`;
        
        overrides[metricKey] = { 
            metric: displayMetric, 
            value: numericValue, 
            origMetric: '—', 
            zoneName: `${targetMetricName} Bulk`, 
            csMetricTypeName: targetMetricName 
        };

        applyOverride(row.el, overrides[metricKey]);
        applied++;
      });
    });

    if (applied > 0) {
      // Anti-Collision Stagger: Right pane waits 400ms before saving
      const isRightPane = Object.keys(paneGroups).some(k => k.includes('right'));
      if (isRightPane && !isTopFrame) {
        await new Promise(resolve => setTimeout(resolve, 400));
      }

      await persistOverridesMerged();
      syncZoneWatchers();
      updateToolbar();
    }
    isBulkGenerating = false;
    return { applied, totalZones: zoneElements.length };
  }

  async function generateAllClientMetrics(shout = true) {
    isBulkGenerating = true;
    const shadow = document.querySelector('#cs-demo-exposure-host')?.shadowRoot;
    if (shadow) {
      shadow.querySelectorAll('.tuner-inp').forEach(inp => {
        const name = inp.dataset.metric;
        const val = parseFloat(inp.value);
        if (name && metricRegistry[name] && !isNaN(val)) {
          if (inp.classList.contains('metric-min')) {
            metricRegistry[name].min = val;
          } else if (inp.classList.contains('metric-max')) {
            metricRegistry[name].max = val;
          }
        }
      });
    }

    if (isTopFrame && shout) {
      readCsMetricTypeName(true); // Force update state
      chrome.runtime.sendMessage({
        type: 'broadcastToTab',
        payload: { 
          type: 'refresh_from_storage', 
          updatedRegistry: JSON.parse(JSON.stringify(metricRegistry)),
          metrics: csActiveMetrics,
          isCompare: isCompareMode
        }
      });
    }

    const metricsLibrary = Object.entries(metricRegistry).map(([name, config]) => ({
      name, ...config
    }));

    let zones = getCandidateZoneElements();
    if (zones.length === 0) {
      isBulkGenerating = false;
      return { ok: true, metricsCount: metricsLibrary.length, zonesCount: 0 };
    }

    // Group zones by pane so Left and Right get independent 360° Data distributions
    // Group zones by pane so Left and Right get independent 360° Data distributions
    const panes = {};
    zones.forEach(el => {
      const pKey = getPaneKey(el) || 'default';
      if (!panes[pKey]) panes[pKey] = [];
      const rect = el.getBoundingClientRect();
      panes[pKey].push({ el, y: rect.top + rect.height / 2, key: getZoneKey(el) || el.getAttribute('id') });
    });

    metricsLibrary.forEach(m => {
      Object.keys(panes).forEach((pKey) => {
        const paneZones = panes[pKey].sort((a, b) => a.y - b.y); 

        // Pane-Aware Variance: Identify right pane by key
        const isRightPane = pKey.includes('right');
        const variance = isRightPane ? 0.88 : 1; // 12% drop for the right side
        const pMax = m.max * variance;
        const pMin = m.min * variance;

        paneZones.forEach((row, index) => {
          let val = pMax;
          if (paneZones.length > 1) {
            const ratio = index / (paneZones.length - 1);
            val = pMax - (ratio * (pMax - pMin));
          }

          let display;
          if (m.type === "currency") {
            display = `$${val.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
          } else if (m.type === "percent" || m.type === "percent_long") {
            display = `${val.toFixed(m.type === "percent" ? 1 : 2)}%`;
          } else if (m.type === "time") {
            display = `${val.toFixed(1)}s`;
          } else if (m.type === "decimal") {
            display = val.toFixed(2);
          } else {
            display = Math.round(val).toLocaleString();
          }

          const overrideKey = `${row.key}@${m.name}`;
          overrides[overrideKey] = { 
              metric: display, 
              value: val, 
              origMetric: '—', 
              zoneName: `${m.name} Data`, 
              csMetricTypeName: m.name 
          };
        });
      });
    });

    // Anti-Collision Stagger: Right pane waits 400ms before merging storage
    const hasRightPane = Object.keys(panes).some(k => k.includes('right'));
    if (hasRightPane && !isTopFrame) {
      await new Promise(resolve => setTimeout(resolve, 400));
    }

    await persistOverridesMerged(); // Safe merge
    applyAllOverrides();
    syncZoneWatchers();

    isBulkGenerating = false;
    return { ok: true, metricsCount: metricsLibrary.length, zonesCount: zones.length };
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
        width: 320px;
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
      .tab-content {
        padding: 14px 16px;
      }
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
        width: 100%;
      }
      .btn-apply { background: #2c2c8c; color: #fff; }
      .btn-apply:hover { background: #3c3cac; }
      .hint { font-size: 10px; color: #666; margin-bottom: 8px; }
      
      /* Metric Tuner Styles */
      .metric-tuner-list {
        max-height: 180px;
        overflow-y: auto;
        border: 1px solid #ececf6;
        border-radius: 8px;
        padding: 4px;
        margin-bottom: 12px;
        background: #fcfcff;
      }
      .tuner-row {
        display: grid;
        grid-template-columns: 1fr 50px 50px;
        gap: 6px;
        align-items: center;
        padding: 4px 6px;
        border-bottom: 1px solid #f0f0f8;
      }
      .tuner-label {
        font-size: 10px;
        font-weight: 600;
        color: #555;
        text-transform: capitalize;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .tuner-inp {
        width: 100%;
        padding: 3px 5px;
        border: 1px solid #d0d0e0;
        border-radius: 4px;
        font-size: 10px;
        text-align: center;
        box-sizing: border-box;
      }

      /* Exposure Logic Styles (Preserved) */
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

    // CHECK STATE: Are we currently editing?
    const isEditing = !!editMode;
    const disabledOverlayStyle = isEditing ? '' : 'opacity: 0.5; pointer-events: none; filter: grayscale(50%);';
    
    // WARNING BANNER: Show if Edit Mode is off
    const editModeWarning = isEditing ? '' : `
      <div style="background: #fff0f0; color: #cc3333; padding: 10px 16px; font-size: 11px; font-weight: 600; border-bottom: 1px solid #ffcccc; display: flex; align-items: center; gap: 8px;">
        <span>⚠️</span> Edit Zones must be turned ON to use these features.
      </div>
    `;

    panel.innerHTML = `
      <div class="panel-header">⚙️ Advanced Tools</div>
      ${editModeWarning}
      
      <div class="tab-content active" style="display: block; ${disabledOverlayStyle}">
        
        <div class="section-label" style="color: #2c2c8c;">1. Bulk Fill Current Metric</div>
        <div class="hint" style="margin-top:-4px; margin-bottom:10px;">Auto-populates zero-value/empty zones for the metric currently on screen.</div>
        <div class="row">
          <input id="inp-bulk-max" class="inp" type="number" step="0.1" placeholder="Max Value (e.g. 15)" ${isEditing ? '' : 'disabled'}>
          <input id="inp-bulk-min" class="inp" type="number" step="0.1" placeholder="Min Value (e.g. 1)" ${isEditing ? '' : 'disabled'}>
        </div>
        <button class="btn btn-apply" id="btn-bulk-fill" style="margin-bottom: 4px;" ${isEditing ? '' : 'disabled'}>Fill Zeros for Current Metric</button>
        
        <hr class="divider">

        <div class="section-label" style="color: #cc3333;">2. Global Metric Library Tuner</div>
        <div class="hint" style="margin-top:-4px; margin-bottom:10px;">Adjust bounds before generating the "Nuclear" data story.</div>
        
        <div class="metric-tuner-list">
          <div class="tuner-row" style="position: sticky; top: 0; background: #fff; z-index: 1; border-bottom: 1px solid #ccc; padding-bottom: 2px;">
            <div class="section-label" style="margin:0">Metric</div>
            <div class="section-label" style="margin:0; text-align:center;">Min</div>
            <div class="section-label" style="margin:0; text-align:center;">Max</div>
          </div>
          ${Object.entries(metricRegistry).map(([name, config]) => `
            <div class="tuner-row">
              <div class="tuner-label" title="${name}">${name}</div>
              <input class="tuner-inp metric-min" data-metric="${name}" type="number" value="${config.min}" ${isEditing ? '' : 'disabled'}>
              <input class="tuner-inp metric-max" data-metric="${name}" type="number" value="${config.max}" ${isEditing ? '' : 'disabled'}>
            </div>
          `).join('')}
        </div>

        <button class="btn btn-apply" id="btn-nuclear-fill" style="background: #cc3333; margin-bottom: 4px;" ${isEditing ? '' : 'disabled'}>🚀 Generate All Data</button>

        <hr class="divider">

        <div class="section-label">3. Exposure Auto-Seed Bounds</div>
        <div class="row">
          <input id="inp-exp-top" class="inp" type="number" step="0.1" value="100" placeholder="Top %" ${isEditing ? '' : 'disabled'}>
          <input id="inp-exp-bottom" class="inp" type="number" step="0.1" value="20" placeholder="Bottom %" ${isEditing ? '' : 'disabled'}>
        </div>
        <div class="chk-row">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
            <input type="checkbox" id="chk-exp-fixed-fold" ${isEditing ? '' : 'disabled'}>
            Use fixed fold position
          </label>
        </div>
        <div class="fold-row">
          <input id="inp-exp-fixed-fold" class="inp" type="number" step="1" min="0" value="${defaultFoldPositionPx}" placeholder="Fold px" disabled>
          <span id="txt-exp-viewport" class="hint" style="margin:0">Current viewport: ${defaultFoldPositionPx}px</span>
        </div>
        <div class="chk-row">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
            <input type="checkbox" id="chk-exp-skip-edited" checked ${isEditing ? '' : 'disabled'}>
            Skip already edited zones
          </label>
        </div>
        <div class="chk-row">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
            <input type="checkbox" id="chk-exp-per-pane" ${isEditing ? '' : 'disabled'}>
            Use per-pane bounds
          </label>
        </div>
        <div id="exp-pane-bounds" class="pane-bounds">
          ${paneKeys.length === 0
            ? '<div class="hint" style="margin-bottom:0">No panes detected</div>'
            : paneKeys.map((paneKey, idx) => `
              <div class="pane-row">
                <div class="pane-name" title="${escHtml(paneKey)}">Pane ${idx + 1}</div>
                <input class="inp exp-pane-top" data-pane="${escHtml(paneKey)}" type="number" step="0.1" value="100" style="padding:4px 6px;font-size:11px;" ${isEditing ? '' : 'disabled'}>
                <input class="inp exp-pane-bottom" data-pane="${escHtml(paneKey)}" type="number" step="0.1" value="20" style="padding:4px 6px;font-size:11px;" ${isEditing ? '' : 'disabled'}>
              </div>
            `).join('')
          }
        </div>
        <div class="hint">Uses current viewport as fold by default: zones above fold get Top %, then values decrease toward Bottom % below fold.</div>
        <button class="btn btn-apply" id="btn-auto-exposure" style="background: #4a4a64;" ${isEditing ? '' : 'disabled'}>Apply Exposure Gradient</button>
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

    shadow.getElementById('btn-bulk-fill')?.addEventListener('click', () => {
      const maxVal = parseFloat(shadow.getElementById('inp-bulk-max')?.value);
      const minVal = parseFloat(shadow.getElementById('inp-bulk-min')?.value);

      if (isNaN(maxVal) || isNaN(minVal)) {
        alert('Please enter valid numbers for the Max and Min values.');
        return;
      }
      if (maxVal < minVal) {
        alert('Max value should be greater than Min value for a descending gradient.');
        return;
      }

      const btn = shadow.getElementById('btn-bulk-fill');
      const originalText = btn.textContent;
      btn.textContent = 'Processing...';
      btn.style.opacity = '0.7';
      btn.disabled = true;

      // BROADCAST TO ALL IFRAMES
      chrome.runtime.sendMessage({
        type: 'broadcastToTab',
        payload: {
          type: 'applyBulkFillInFrame',
          maxVal: maxVal,
          minVal: minVal
        }
      }, (response) => {
        btn.textContent = originalText;
        btn.style.opacity = '1';
        btn.disabled = false;

        let totalApplied = 0;
        let totalFoundZones = 0;

        // Tally up the responses from the iframe(s)
        if (response && response.results) {
          response.results.forEach(res => {
            if (res.payload && res.payload.ok) {
              totalApplied += (res.payload.applied || 0);
              totalFoundZones += (res.payload.totalZones || 0);
            }
          });
        }

        if (totalApplied > 0) {
          alert(`Success! Auto-populated ${totalApplied} zero-value zones.`);
        } else if (totalFoundZones === 0) {
          alert('Found 0 zones. Are you sure the zoning layer is fully loaded?');
        } else {
          alert(`Found ${totalFoundZones} total zones, but none evaluated to zero (or they were already manually edited).`);
        }
      });
    });

    shadow.getElementById('btn-nuclear-fill')?.addEventListener('click', () => {
      const btn = shadow.getElementById('btn-nuclear-fill');
      const originalText = btn.textContent;
      btn.textContent = 'Generating 360° Data...';
      btn.disabled = true;

      chrome.runtime.sendMessage({
        type: 'broadcastToTab',
        payload: { type: 'generateAllInFrame' }
      }, (response) => {
        btn.textContent = originalText;
        btn.disabled = false;
        
        // Simplified success message that doesn't get confused by 0-zone parent frames
        if (response && response.results && response.results.some(r => r.payload && r.payload.ok)) {
            alert(`Success! 360° Data generated and injected into all visible zones.`);
        } else {
            alert("Could not communicate with the zones. Ensure the zoning layer is loaded.");
        }
      });
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
        /* INCREASED WIDTH TO 420px */
        width: 420px;
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
        /* INCREASED WIDTH FOR THE TEXT ITSELF */
        width: 220px;
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

      const reportMatch = getUrlKey().match(/\/zoning-v2\/(\d+)/);
      const reportId = reportMatch ? reportMatch[1] : '';

      const panel = document.createElement('div');
      panel.className = 'panel';
      panel.innerHTML = `
        <div class="panel-header" style="display: flex; justify-content: space-between; align-items: center;">
          <span>🧩 Active Edits (${total})</span>
          ${reportId ? `<span style="font-size: 10px; font-weight: normal; opacity: 0.7; letter-spacing: 0.5px;">Report #${reportId}</span>` : ''}
        </div>
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
    
    // teardown logic
    const exposureHost = document.getElementById('cs-demo-exposure-host');
    const editsHost = document.getElementById('cs-demo-edits-host');
    if (exposureHost) exposureHost.remove();
    if (editsHost) editsHost.remove();
    
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
        /* INCREASED WIDTH TO 380px */
        width: 380px;
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
      /* INDIVIDUAL EXPORT BUTTON STYLES */
      .btn-export-sc {
        background: #e8e8f0;
        color: #444;
        font-size: 10px;
        padding: 4px 8px;
        border: 1px solid #d0d0e0;
      }
      .btn-export-sc:hover { background: #dcdce8; }
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
      return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function render(scenarios) {
      const items = Object.entries(scenarios)
        .filter(([, v]) => v.url === getUrlKey())
        .sort((a, b) => (b[1].createdAt || '') - (a[1].createdAt || ''));

      const reportMatch = getUrlKey().match(/\/zoning-v2\/(\d+)/);
      const reportId = reportMatch ? reportMatch[1] : '';

      panel.innerHTML = `
        <div class="panel-header" style="display: flex; justify-content: space-between; align-items: center;">
          <span>📁 Scenarios</span>
          ${reportId ? `<span style="font-size: 10px; font-weight: normal; opacity: 0.7; letter-spacing: 0.5px;">Report #${reportId}</span>` : ''}
        </div>
        <div class="panel-body">
          <div class="section-label">Save current overrides</div>
          <div class="save-row">
            <input id="inp-name" class="inp" type="text" placeholder="Scenario name..." maxlength="50">
            <button class="btn btn-save" id="btn-save-sc">Save</button>
          </div>
          <div class="section-label" style="margin-top:-8px;margin-bottom:12px;text-transform:none;letter-spacing:0;font-size:11px;color:#9a9ab0;">Save includes zoning + heatmap edits.</div>
          <div class="section-header-row">
            <span class="section-label">Saved (${items.length})</span>
            <button class="btn btn-file" id="btn-export">⬇ Export All</button>
            <button class="btn btn-file btn-file-import" id="btn-import">⬆ Import</button>
          </div>
          <div class="scenario-list" id="sc-list">
            ${items.length === 0 ? '<div class="empty">No scenarios for this page</div>' : items.map(([name, sc]) => `
              <div class="scenario-item">
                <span class="scenario-name" title="${escHtml(name)}">${escHtml(name)}</span>
                <span class="scenario-meta">${Object.keys(sc.overrides || {}).length} zoning + ${Object.keys(sc.heatmapPoints || {}).length} heatmap</span>
                <button class="btn btn-export-sc" data-export="${escHtml(name)}" title="Export this scenario only">⬇</button>
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

      // GLOBAL EXPORT
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
          
          let fileName = 'cs-scenarios';
          const scenarioNames = Object.keys(pageItems);
          const inputName = shadow.getElementById('inp-name')?.value?.trim();
          
          if (scenarioNames.length === 1) {
            fileName = scenarioNames[0]; 
          } else if (inputName) {
            fileName = inputName; 
          } else {
            const slug = getUrlKey().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 50);
            fileName += `-${slug}`;
          }
          
          const safeName = fileName.replace(/[^a-z0-9 _-]/gi, '-').replace(/-+/g, '-').trim();
          a.download = `${safeName}.json`;
          
          document.body.appendChild(a);
          a.click();
          setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 5000);
        });
      });

      // Import scenarios
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

      // SCENARIO ACTION BUTTONS
      shadow.getElementById('sc-list')?.addEventListener('click', e => {
        const loadName = e.target.dataset.load;
        const delName = e.target.dataset.del;
        const exportName = e.target.dataset.export; 

        // Individual Export
        if (exportName) {
          chrome.storage.local.get('csZoningScenarios', result => {
            const sc = (result.csZoningScenarios || {})[exportName];
            if (!sc) return;
            const payload = {
              version: 1,
              exportedAt: new Date().toISOString(),
              pageKey: getUrlKey(),
              scenarios: { [exportName]: sc } // Only export THIS scenario
            };
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            
            const safeName = exportName.replace(/[^a-z0-9 _-]/gi, '-').replace(/-+/g, '-').trim();
            a.download = `${safeName}.json`;
            
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 5000);
          });
        }

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

    const closeOnOutside = e => {
      if (!host.contains(e.target) && !toolbarHost?.contains(e.target)) {
        host.remove();
        document.removeEventListener('click', closeOnOutside, true);
      }
    };
    setTimeout(() => document.addEventListener('click', closeOnOutside, true), 0);
  }

  // --- SPA NAVIGATION POLLER ---
  let spaTransitionPoll = null;

  function startAggressiveZonePolling() {
    if (spaTransitionPoll) clearInterval(spaTransitionPoll);
    let pollCount = 0;

    spaTransitionPoll = setInterval(() => {
      pollCount++;
      
      if (isTopFrame) readCsMetricTypeName(true);
      
      const zones = getAllZoneElements();

      if (zones.length > 0) {
        applyAllOverrides();
        zones.forEach(watchZone);
        updateToolbar();
      }

      // Stop checking after 20 seconds to save CPU
      if (pollCount > 40) {
        clearInterval(spaTransitionPoll); 
      }
    }, 500);
  }

  // ─── SPA URL CHANGE DETECTION ────────────────────────────────────────────
  function handleUrlChange() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;

    if (isTopFrame && location.hostname === 'app.contentsquare.com') {
      const nextKey = normalizeCsUrlKey(location.href);
      setActivePageKey(nextKey, true);
      refreshMetricTypeName();
    }

    zoneObservers.forEach(entry => {
      entry.observer.disconnect();
      entry.element.removeEventListener('click', onZoneElementClick, true);
    });
    zoneObservers.clear();

    Promise.all([loadOverrides(), loadHeatmapPointOverrides()]).then(() => {
      syncZoneWatchers();
      renderHeatmapPointOverlays();
      updateToolbar();
      startAggressiveZonePolling();
    });
  }

  setInterval(handleUrlChange, 800);
  setInterval(syncZoneWatchers, 1200);

  // ─── MESSAGE HANDLER (from popup) ────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {

    if (msg.type === 'findMeTheUI') {
      const uiElement = document.querySelector('csm-universal-select');
      sendResponse({ 
        found: !!uiElement, 
        url: window.location.href,
        frameContext: isTopFrame ? 'top' : 'subframe'
      });
      return true;
    }

    if (msg.type === 'syncMetricName') {
      if (msg.metrics) {
         csActiveMetrics = msg.metrics;
         isCompareMode = msg.isCompare;
         csMetricTypeName = msg.metrics.global;
      } else {
         csMetricTypeName = msg.name;
      }
      applyAllOverrides();
      sendResponse({ok: true});
      return true;
    }

    if (msg.type === 'refresh_from_storage') {
      if (msg.metrics) {
         csActiveMetrics = msg.metrics;
         isCompareMode = msg.isCompare;
         csMetricTypeName = msg.metrics.global;
      } else if (msg.activeMetricName) {
         csMetricTypeName = msg.activeMetricName;
      }
      
      if (msg.updatedRegistry) {
        metricRegistry = msg.updatedRegistry;
        // Subframes DO generate data!
        generateAllClientMetrics(false);
      } else {
        loadOverrides().then(() => {
          applyAllOverrides();
          syncZoneWatchers();
        });
      }
      return true;
    }

    if (msg.type === 'syncZonesNow') {
      loadOverrides().then(() => {
        syncZoneWatchers();
        applyAllOverrides();
      });
      return true;
    }

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

    if (msg.type === 'applyBulkFillInFrame') {
      // Allow all frames to participate, but we will stagger their saves
      applyBulkFillToCurrentMetric(msg.maxVal, msg.minVal).then(result => {
        sendResponse({ ok: true, frame: frameContextKey, ...result });
      });
      return true; // Keep channel open for async
    }

    if (msg.type === 'generateAllInFrame') {
      // ONLY Top Frame runs the initial math. Subframes will wait for the 'refresh_from_storage' shout.
      if (isTopFrame) {
        generateAllClientMetrics(true).then(result => {
          sendResponse({ ...result, frame: frameContextKey });
        });
      } else {
        sendResponse({ ok: true, skipped: true, frame: frameContextKey });
      }
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
      // CORE FIX: Only let the top-level window process the popup's command.
      // This stops 30 iframes from throwing confirm() dialogs at the same time!
      if (isTopFrame) {
        resetAll(msg.skipConfirm);
      }
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
    // NEW: Catch the Top Frame's whisper about our identity!
    if (event.data && event.data.__csDemoPaneSide) {
       window.__csDemoPaneSide = event.data.__csDemoPaneSide;
       // We know who we are now! Force an immediate repaint!
       if (typeof applyAllOverrides === 'function') applyAllOverrides();
       return;
    }
    
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
  }, true); // Add capture: true to ensure CSQ doesn't block this!

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
      // BUG FIX: Shield local memory from being wiped while the right pane is sleeping!
      if (isBulkGenerating) return;
      
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
        //console.log('[ZONING-DEBUG][observer] DOM zone keys:', domKeys);
        //console.log('[ZONING-DEBUG][observer] Loaded override keys:', Object.keys(overrides));
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
    //console.log('[ZONING-DEBUG][init] Loaded overrides:', Object.keys(overrides));
    await loadHeatmapPointOverrides();
    //console.log('[ZONING-DEBUG][init] Loaded heatmapPointOverrides:', Object.keys(heatmapPointOverrides));

    // 3. Start Document Observer
    startDocObserver();

    // 4. AGGRESSIVE PERSISTENCE POLLING
    // Checks for zones every 500ms for 20 seconds during initial load or refresh
    startAggressiveZonePolling();

    // 5. Initialize UI and Handlers
    syncZoneWatchers();
    createToolbar();
    applyUiVisibility();
    renderHeatmapPointOverlays();
    
    // Final debug log and interaction listeners
    applyAllOverrides();
    //console.log('[ZONING-DEBUG][init] Called applyAllOverrides after page load.');

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
