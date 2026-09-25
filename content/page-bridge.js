(function () {
  'use strict';

  if (window.__csDemoPageBridgeInstalled) {
    return;
  }
  window.__csDemoPageBridgeInstalled = true;

  const state = {
    editMode: false,
    uiVisible: true
  };
  const seenNativeEvents = new WeakSet();

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

  function buildPathPreview(path) {
    return path.slice(0, 8).map(node => {
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
    }).join(' > ');
  }

  function findZoneIdFromPath(path) {
    for (const node of path) {
      if (!(node instanceof Element)) continue;
      const zoneEl = closestAcrossShadow(node, 'app-zone-elements, app-zone-element');
      if (!zoneEl) continue;
      const zoneId = String(zoneEl.getAttribute('id') || '').trim();
      if (zoneId) return zoneId;
    }
    return '';
  }

  function hasHeatmapSurface(path) {
    return path.some(node => {
      if (!(node instanceof Element)) return false;
      const tag = (node.tagName || '').toLowerCase();
      if (tag === 'app-heatmap-scroll-element' || tag === 'hj-heatmaps-report') return true;
      if (node.matches && node.matches('app-heatmap-scroll-element')) return true;
      const className = String(node.className || '').toLowerCase();
      return className.includes('heatmap');
    });
  }

  function findHeatmapLayerFromPath(path) {
    const known = ['clicks', 'moves', 'scrolls', 'attention'];
    for (const node of path) {
      if (!(node instanceof Element)) continue;
      const isControl = !!(node.matches && node.matches('button, [role="tab"], [role="button"]'));
      if (!isControl) continue;
      const text = (node.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const firstWord = text.split(' ')[0];
      if (known.includes(firstWord)) return firstWord;
    }
    return '';
  }

  function emitInteraction(event, source) {
    if (event && typeof event === 'object') {
      if (seenNativeEvents.has(event)) return;
      seenNativeEvents.add(event);
    }
    if (state.uiVisible === false) return;

    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    const heatmapLayer = findHeatmapLayerFromPath(path);

    if (!state.editMode && !heatmapLayer) return;

    const detail = {
      source,
      eventType: event.type,
      zoneId: findZoneIdFromPath(path),
      heatmapSurface: hasHeatmapSurface(path),
      heatmapLayer,
      clientX: Number(event.clientX) || 0,
      clientY: Number(event.clientY) || 0,
      pathPreview: buildPathPreview(path)
    };

    window.dispatchEvent(new CustomEvent('cs-demo-page-interaction', { detail }));
  }

  window.addEventListener('cs-demo-set-state', event => {
    const detail = event && event.detail ? event.detail : {};
    state.editMode = !!detail.editMode;
    state.uiVisible = detail.uiVisible !== false;
  });

  ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'contextmenu'].forEach(type => {
    window.addEventListener(type, event => emitInteraction(event, type), true);
    document.addEventListener(type, event => emitInteraction(event, type), true);
  });
})();

// --- JOURNEY ANALYSIS INTERCEPTOR (Math Only) ---
(function() {
  if (window.__csDemoJourneyDynamicInstalled) return;
  window.__csDemoJourneyDynamicInstalled = true;

  const CS_BRIDGE_DEBUG = false;
  const dbg = (...args) => { if (CS_BRIDGE_DEBUG) console.log(...args); };

  const extractUrl = (args) => {
    try {
      if (typeof args[0] === 'string') return args[0];
      if (args[0] instanceof Request) return args[0].url;
      if (args[0] && args[0].url) return args[0].url;
    } catch(e) {}
    return '';
  };

  // Journey rules are pushed from content.js via a CustomEvent whenever they change,
  // so this script never needs to read localStorage.
  let _journeyRulesCache = [];
  window.addEventListener('cs-demo-journey-rules-updated', event => {
    const rules = event && event.detail && Array.isArray(event.detail.rules) ? event.detail.rules : [];
    _journeyRulesCache = rules;
  });

  const getJourneyRules = () => _journeyRulesCache;

  // --- TEMPORAL ALTERNATOR (For Chart Sizes Only) ---
  let navReqCount = 0;
  let lastReqTime = 0;

  function getJourneyRequestSide(url, bodyStr) {
    if (bodyStr) {
      if (bodyStr.includes('"compareIndex":1')) return 'right';
      if (bodyStr.includes('"compareIndex":0')) return 'left';
    }

    const now = Date.now();
    const timeSinceLast = now - lastReqTime;

    if (timeSinceLast > 2500) {
      dbg(`🕵️ [CS Demo Math] Alternator Timer Reset! (Time since last request: ${timeSinceLast}ms)`);
      navReqCount = 0;
    }
    lastReqTime = now;

    if (url.includes('/navigation-path') && !url.includes('/mappings')) {
      navReqCount++;
      const side = (navReqCount % 2 === 0) ? 'right' : 'left';
      dbg(`🕵️ [CS Demo Math] Chart Request #${navReqCount} fired -> Assigned to ${side.toUpperCase()} PANE.`);
      return side;
    }
    return 'left';
  }

  const getEffectiveName = (rule) => rule.renameTo ? rule.renameTo : (rule.originalName || rule.targetNode);

  // NEW: Helper to detect if the current request is part of a comparison
  const isCompareRequest = (url, body) => {
    try {
      // 1. SHADOW-PIERCING DOM CHECK (Looks for the exact <csm-button> element)
      let isCompView = false;
      const checkCompareState = (root) => {
        if (isCompView || !root) return;
        if (root.querySelector && root.querySelector('[data-qa-id="ja-compare-cancel-button"]')) {
          isCompView = true;
          return;
        }
        if (root.querySelectorAll) {
          root.querySelectorAll('*').forEach(el => {
            if (el.shadowRoot) checkCompareState(el.shadowRoot);
          });
        }
      };
      checkCompareState(document);
      if (isCompView) return true;

      // 2. NETWORK PAYLOAD CHECK: (Reliable fallback)
      if (body && (body.includes('"compareIndex"') || body.includes('compareIndex='))) return true;
      if (url && url.includes('compareIndex=')) return true;

      // 3. TEMPORAL FALLBACK: Trust the Alternator
      if (navReqCount >= 2) return true;
    } catch(e) {}
    return false;
  };

  // ---------------------------------------------------------
  // 1. FIX THE RIGHT PANEL (Strict Decimal Reallocation)
  // ---------------------------------------------------------
  const fixRightPanel = (elementsArray, rules) => {
    if (!Array.isArray(elementsArray) || !rules.length) return false;
    let changed = false;

    const lockedIndices = new Set();
    let lockedPercentSum = 0;
    let unlockedNativeVolume = 0;
    let exitVolume = 0;
    
    const getVol = (el) => {
      if (el.paMetrics && typeof el.paMetrics.sessionRetentionCount === 'number') return el.paMetrics.sessionRetentionCount;
      if (typeof el.value === 'number') return el.value;
      if (typeof el.size === 'number') return el.size;
      return 0;
    };

    const isExit = (el) => el.name && typeof el.name === 'string' && el.name.includes('END_');

    const grossVolume = elementsArray.reduce((sum, el) => sum + getVol(el), 0);
    if (grossVolume === 0) return false; 

    elementsArray.forEach(el => { if (isExit(el)) exitVolume += getVol(el); });

    // PHASE 1: Apply rules and LOCK targets
    elementsArray.forEach((el, idx) => {
      if (isExit(el)) return;

      const elName = String(el.name || '').toLowerCase();
      const matchingRule = rules.find(rule => {
        // NEW: If the rule has no percentage (Rename Only), ignore it for math!
        if (rule.percent === null || rule.percent === undefined) return false;
        
        const targetName = String(rule.renameTo || rule.originalName || rule.targetNode || '').toLowerCase();
        const original = String(rule.originalName || rule.targetNode || '').toLowerCase();
        return elName === targetName || elName === original;
      });

      if (matchingRule) {
        const targetPct = matchingRule.percent / 100; // Strictly 0.20
        const newVolume = Math.round(grossVolume * targetPct); 
        
        if (el.paMetrics && typeof el.paMetrics.sessionRetentionCount === 'number') el.paMetrics.sessionRetentionCount = newVolume;
        if (typeof el.value === 'number') el.value = newVolume;
        if (typeof el.size === 'number') el.size = newVolume;
        
        // FIX: Always pass pure decimal. The UI will multiply by 100.
        if (typeof el.percent !== 'undefined') el.percent = targetPct;

        lockedIndices.add(idx);
        lockedPercentSum += targetPct;
        changed = true;
      } else {
        unlockedNativeVolume += getVol(el);
      }
    });

    if (!changed) return false;

    // PHASE 2: Compress/Inflate unlocked siblings
    let leftoverPct = 1.0 - lockedPercentSum - (exitVolume / grossVolume);
    if (leftoverPct < 0) leftoverPct = 0;
    const leftoverVolume = grossVolume * leftoverPct;

    elementsArray.forEach((el, idx) => {
      if (!lockedIndices.has(idx) && !isExit(el)) {
        const nativeVol = getVol(el);
        const share = unlockedNativeVolume === 0 ? 0 : (nativeVol / unlockedNativeVolume);
        const newVolume = Math.round(leftoverVolume * share);

        if (el.paMetrics && typeof el.paMetrics.sessionRetentionCount === 'number') el.paMetrics.sessionRetentionCount = newVolume;
        if (typeof el.value === 'number') el.value = newVolume;
        if (typeof el.size === 'number') el.size = newVolume;
        
        if (typeof el.percent !== 'undefined') el.percent = leftoverPct * share; // Strictly pure decimal
      }
    });

    return true;
  };

  // ---------------------------------------------------------
  // 2. FIX THE SUNBURST VISUAL (Ring-Based Reallocation with Subtree Scaling)
  // ---------------------------------------------------------
  const stealSiblingTraffic = (node, rules) => {
    if (!node || !node.children || !Array.isArray(node.children) || !rules.length) return false;
    let changed = false;

    const lockedIndices = new Set();
    let lockedPercentSum = 0;
    let unlockedNativeVolume = 0;
    let exitVolume = 0;

    const getNativeVol = (c) => {
      if (c.paMetrics && c.paMetrics.sessionRetentionCount !== undefined) return Number(c.paMetrics.sessionRetentionCount) || 0;
      if (c.size !== undefined) return Number(c.size) || 0;
      if (c.value !== undefined) return Number(c.value) || 0;
      return 0;
    };

    // NEW: Recursive scaler to shrink/inflate the entire downstream path
    const scaleSubtree = (n, factor) => {
      if (!n || !n.children || !Array.isArray(n.children)) return;
      n.children.forEach(child => {
        if (child.paMetrics && typeof child.paMetrics.sessionRetentionCount === 'number') child.paMetrics.sessionRetentionCount *= factor;
        if (typeof child.value === 'number') child.value *= factor;
        if (typeof child.size === 'number') child.size *= factor;
        if (typeof child.absoluteValue === 'number') child.absoluteValue *= factor;
        // Note: child.percent is not scaled because its relative proportion to its parent remains identical!
        scaleSubtree(child, factor);
      });
    };

    const isExit = (c) => c.name && typeof c.name === 'string' && c.name.includes('END_');

    const ringVolume = node.children.reduce((sum, c) => sum + getNativeVol(c), 0);
    
    if (ringVolume === 0) {
      node.children.forEach(child => { if (stealSiblingTraffic(child, rules)) changed = true; });
      return changed;
    }

    node.children.forEach(c => { if (isExit(c)) exitVolume += getNativeVol(c); });

    // PHASE 1: Apply rules
    node.children.forEach((c, idx) => {
      if (isExit(c)) return;

      const cName = String(c.name || '').toLowerCase();
      const matchingRule = rules.find(rule => {
        // NEW: If the rule has no percentage (Rename Only), ignore it for math!
        if (rule.percent === null || rule.percent === undefined) return false;
        
        const targetName = String(rule.renameTo || rule.originalName || rule.targetNode || '').toLowerCase();
        const original = String(rule.originalName || rule.targetNode || '').toLowerCase();
        return cName === targetName || cName === original;
      });

      if (matchingRule) {
        const targetPct = matchingRule.percent / 100;
        const oldSize = getNativeVol(c);
        const newTargetSize = Math.round(ringVolume * targetPct); 
        const scaleFactor = oldSize === 0 ? 0 : (newTargetSize / oldSize);
        
        c.size = newTargetSize;
        c.value = newTargetSize;
        c.absoluteValue = newTargetSize;
        if (c.paMetrics) c.paMetrics.sessionRetentionCount = newTargetSize;
        c.percent = targetPct; 

        // Scale everything downstream so the chart engine accepts our new size
        scaleSubtree(c, scaleFactor);

        lockedIndices.add(idx);
        lockedPercentSum += targetPct;
        changed = true;
      } else {
        unlockedNativeVolume += getNativeVol(c);
      }
    });

    if (changed) {
      // PHASE 2: Distribute leftover
      let leftoverPct = 1.0 - lockedPercentSum - (exitVolume / ringVolume);
      if (leftoverPct < 0) leftoverPct = 0;
      const leftoverVolume = ringVolume * leftoverPct;

      node.children.forEach((c, idx) => {
        if (!lockedIndices.has(idx) && !isExit(c)) {
           const nativeVol = getNativeVol(c);
           const share = unlockedNativeVolume === 0 ? 0 : (nativeVol / unlockedNativeVolume);
           const newSize = Math.round(leftoverVolume * share);
           const scaleFactor = nativeVol === 0 ? 0 : (newSize / nativeVol);
           
           c.size = newSize;
           c.value = newSize;
           c.absoluteValue = newSize;
           if (c.paMetrics) c.paMetrics.sessionRetentionCount = newSize;
           c.percent = leftoverPct * share; 

           // Scale the un-targeted siblings' downstream paths too
           scaleSubtree(c, scaleFactor);
        }
      });
    }

    // Recurse down the tree to apply any deeper rules
    node.children.forEach(child => {
      if (stealSiblingTraffic(child, rules)) changed = true;
    });

    return changed;
  }; 

  // ---------------------------------------------------------
  // 3. THE HARVESTER 
  // ---------------------------------------------------------
  const extractAllNodeNames = (tree, namesSet = new Set()) => {
    if (!tree) return namesSet;
    if (Array.isArray(tree)) {
      tree.forEach(node => extractAllNodeNames(node, namesSet));
    } else if (typeof tree === 'object') {
      if (tree.name && typeof tree.name === 'string') {
        if (!tree.name.includes('END_PATH') && tree.name !== 'root' && tree.name !== 'UNDEFINED_PATH') {
          namesSet.add(tree.name);
        }
      }
      if (tree.children) extractAllNodeNames(tree.children, namesSet);
    }
    return namesSet;
  };

  // ---------------------------------------------------------
  // FETCH INTERCEPTOR
  // ---------------------------------------------------------
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const url = typeof args[0] === 'string' ? args[0] : (args[0] instanceof Request ? args[0].url : '');
    const method = (args[1] && args[1].method) ? args[1].method.toUpperCase() : 'GET';
    
    if (method === 'OPTIONS') return originalFetch.apply(this, args);

    let requestBody = '';
    try {
       if (args[1] && args[1].body && typeof args[1].body === 'string') {
           requestBody = args[1].body;
       }
    } catch(e) {}

    const requestSide = getJourneyRequestSide(url, requestBody);
    const response = await originalFetch.apply(this, args);

    try {
      const allRules = getJourneyRules();
      
      const isComp = isCompareRequest(url, requestBody);
      const sideSpecificRules = allRules.filter(r => {
        if (isComp) {
          // WORLD 1: COMPARE MODE. 
          // Strictly forbid 'all' (Non-Compare) rules.
          return r.paneSide === requestSide && r.paneSide !== 'all';
        } else {
          // WORLD 2: NON-COMPARE MODE.
          // Strictly only allow 'all' rules.
          return r.paneSide === 'all';
        }
      });

      if (isComp && allRules.some(r => r.paneSide === 'all')) {
        dbg(`🚫 [CS Math] Comparison Active. Filtering out Non-Compare rules.`);
      }
      
      // ONLY INTERCEPT SIZES, IGNORE MAPPINGS ENTIRELY
      if (url.includes('/navigation-path') && !url.includes('/mappings')) {
        const clone = response.clone();
        const data = await clone.json();
        let changed = false;

        if (data && data.payload) {
           if (data.payload.tree) {
             const uniqueNames = Array.from(extractAllNodeNames(data.payload.tree));
             window.postMessage({ type: 'CS_JOURNEY_NODES_SCRAPED', nodes: uniqueNames.sort() }, location.origin || '*');
           }
           if (fixRightPanel(data.payload.elements, sideSpecificRules)) changed = true;
           if (stealSiblingTraffic(data.payload.tree, sideSpecificRules)) changed = true;
        }

        if (changed) {
          dbg(`✅ [CS Demo Math] SUCCESS: Applied ${sideSpecificRules.length} rule(s) to the ${requestSide.toUpperCase()} chart payload!`);
          return new Response(JSON.stringify(data), { status: response.status, headers: response.headers });
        }
      }
    } catch (e) {}
    return response;
  };

  // ---------------------------------------------------------
  // XHR INTERCEPTOR
  // ---------------------------------------------------------
  const originalXhrOpen = XMLHttpRequest.prototype.open;
  const originalXhrSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url) {
    this._customDemoUrl = url;
    this._customDemoMethod = method.toUpperCase();
    return originalXhrOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function(body) {
    if (this._customDemoMethod === 'OPTIONS') return originalXhrSend.apply(this, arguments);

    this._customDemoBody = typeof body === 'string' ? body : '';
    this._customDemoRequestSide = getJourneyRequestSide(this._customDemoUrl, this._customDemoBody);
    
    this.addEventListener('readystatechange', function() {
      if (this.readyState === 4 && this._customDemoUrl) {
        try {
          const requestSide = this._customDemoRequestSide;
          const allRules = getJourneyRules();

          // FIX: Use XHR instance variables
          const isComp = isCompareRequest(this._customDemoUrl, this._customDemoBody);
          const sideSpecificRules = allRules.filter(r => {
            if (isComp) {
              // WORLD 1: COMPARE MODE.
              return r.paneSide === requestSide && r.paneSide !== 'all';
            } else {
              // WORLD 2: NON-COMPARE MODE.
              return r.paneSide === 'all';
            }
          });

          if (isComp && allRules.some(r => r.paneSide === 'all')) {
            dbg(`🚫 [CS Math XHR] Comparison Active. Filtering out Non-Compare rules.`);
          }
          
          // ONLY INTERCEPT SIZES, IGNORE MAPPINGS ENTIRELY
          if (this._customDemoUrl.includes('/navigation-path') && !this._customDemoUrl.includes('/mappings')) {
             const data = JSON.parse(this.responseText);
             let changed = false;

             if (data && data.payload) {
                if (data.payload.tree) {
                   const uniqueNames = Array.from(extractAllNodeNames(data.payload.tree));
                   window.postMessage({ type: 'CS_JOURNEY_NODES_SCRAPED', nodes: uniqueNames.sort() }, location.origin || '*');
                }
                
                if (fixRightPanel(data.payload.elements, sideSpecificRules)) changed = true;
                if (stealSiblingTraffic(data.payload.tree, sideSpecificRules)) changed = true;
             }

             if (changed) {
                dbg(`%c✨ Applied Math to ${requestSide.toUpperCase()} Chart`, 'color: #2c2c8c; font-weight: bold;');
                Object.defineProperty(this, 'responseText', { configurable: true, get: () => JSON.stringify(data) });
                Object.defineProperty(this, 'response', { configurable: true, get: () => JSON.stringify(data) });
             }
          }
        } catch(e) { }
      }
    });
    return originalXhrSend.apply(this, arguments);
  };
})();

// --- JOURNEY EXPLORER INTERCEPTOR (new report, separate API shape from the Sunburst above) ---
(function() {
  if (window.__csDemoJourneyExplorerInstalled) return;
  window.__csDemoJourneyExplorerInstalled = true;

  const CS_BRIDGE_DEBUG = false;
  const dbg = (...args) => { if (CS_BRIDGE_DEBUG) console.log('[CS JE]', ...args); };

  function closestAcrossShadowJE(startEl, selector) {
    let node = startEl;
    while (node) {
      if (node.nodeType === 1 && node.matches && node.matches(selector)) return node;
      if (node.parentElement) { node = node.parentElement; continue; }
      const root = node.getRootNode ? node.getRootNode() : null;
      if (root && root.host) { node = root.host; continue; }
      break;
    }
    return null;
  }

  // Rules are pushed from content.js via a CustomEvent whenever they change.
  let _rulesCache = [];
  window.addEventListener('cs-demo-journey-explorer-rules-updated', event => {
    const rules = event && event.detail && Array.isArray(event.detail.rules) ? event.detail.rules : [];
    _rulesCache = rules;
  });
  const getRules = () => _rulesCache;

  // Best-effort dataSourceId -> display name cache, opportunistically filled from
  // the project/data-source name lookup CSQ's own app already fires. Falls back
  // to the raw numeric id if we haven't seen it yet.
  const dataSourceNameCache = {};
  const getDataSourceLabel = id => dataSourceNameCache[id] || `Source ${id}`;
  function cacheDataSourceNames(json) {
    try {
      const list = Array.isArray(json) ? json : (Array.isArray(json?.items) ? json.items : null);
      if (!list) return;
      list.forEach(entry => {
        if (entry && entry.id != null && entry.name) dataSourceNameCache[entry.id] = entry.name;
      });
    } catch (_) {}
  }
  const isDataSourceNameLookup = url => url.includes('/api/projects-composite/v1/projects?') && url.includes('fields=name');

  // ---------------------------------------------------------
  // Tree addressing: nodes are addressed by an array of child-array indices
  // from payload.tree's root, since sibling nodes can share dataSourceId.
  // ---------------------------------------------------------
  function findNodeInTree(tree, path) {
    let nodes = tree;
    let node = null;
    const chain = [];
    for (let i = 0; i < path.length; i++) {
      if (!Array.isArray(nodes) || !nodes[path[i]]) return null;
      node = nodes[path[i]];
      chain.push(node.dataSourceId);
      nodes = node.children;
    }
    return { node, chain };
  }

  function getParentChildrenArray(tree, path) {
    if (!Array.isArray(path) || path.length === 0) return null;
    if (path.length === 1) return tree;
    const found = findNodeInTree(tree, path.slice(0, -1));
    return found && found.node ? (found.node.children || null) : null;
  }

  function chainsMatch(a, b) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);
  }

  // ---------------------------------------------------------
  // Harvester: flatten the tree in the same order it's addressed, for the
  // Advanced-panel node picker AND for click-correlation (see below).
  // ---------------------------------------------------------
  let _lastHarvestedFlatNodes = [];
  function harvestJourneyExplorerNodes(tree) {
    const flat = [];
    const walk = (nodes, parentPath, parentChain) => {
      if (!Array.isArray(nodes)) return;
      nodes.forEach((node, idx) => {
        const path = [...parentPath, idx];
        const chain = [...parentChain, node.dataSourceId];
        const label = chain.map((id, i) => `S${i + 1} ${getDataSourceLabel(id)}`).join(' → ');
        flat.push({ path, dataSourceIdChain: chain, dataSourceId: node.dataSourceId, label });
        if (Array.isArray(node.children)) walk(node.children, path, chain);
      });
    };
    walk(tree, [], []);
    return flat;
  }

  // ---------------------------------------------------------
  // Rebalancer: adapts the old Sunburst's leftover-redistribution math
  // (stealSiblingTraffic above) to this shape's `upsampledSize` field.
  // Locks the changed sibling to the new value, subtracts the delta from
  // the rest proportionally to their existing volume. Best-effort — if the
  // other siblings have zero combined volume there's nothing to take the
  // delta from, so it's left as-is (acceptable for a demo-data tool).
  // ---------------------------------------------------------
  function rebalanceUsersAfterChange(childrenArr, lockedIndex, newUsers) {
    if (!Array.isArray(childrenArr) || lockedIndex < 0 || lockedIndex >= childrenArr.length) return;
    const target = childrenArr[lockedIndex];
    const oldUsers = Number(target.upsampledSize) || 0;
    const nextUsers = Math.max(0, Math.round(newUsers));
    target.upsampledSize = nextUsers;
    const delta = nextUsers - oldUsers;
    if (delta === 0) return;

    const others = childrenArr.filter((_, i) => i !== lockedIndex);
    const othersVolume = others.reduce((sum, c) => sum + (Number(c.upsampledSize) || 0), 0);
    if (othersVolume <= 0) return;

    others.forEach(c => {
      const share = (Number(c.upsampledSize) || 0) / othersVolume;
      c.upsampledSize = Math.max(0, Math.round((Number(c.upsampledSize) || 0) - delta * share));
    });
  }

  const CONVERSION_BREAKDOWN_KEYS = ['convertedReturned', 'convertedNotReturned', 'notConvertedReturned', 'notConvertedNotReturned'];

  // ---------------------------------------------------------
  // Apply all rules to a freshly-fetched tree. Returns true if anything changed
  // (so the caller knows whether to re-serialize the response).
  // ---------------------------------------------------------
  function applyJourneyExplorerRules(tree, rules) {
    if (!Array.isArray(tree) || !rules || !rules.length) return false;
    let changed = false;

    // 'hide' rules are handled in a separate pass below, after override/branch
    // rules — removing a node changes its siblings' array indices, which
    // would corrupt any other rule's stored path if done mid-loop.
    rules.forEach(rule => {
      try {
        if (rule.kind === 'hide') {
          return;
        }
        if (rule.kind === 'override') {
          const found = findNodeInTree(tree, rule.path);
          if (!found || !found.node) return;
          if (!chainsMatch(found.chain, rule.dataSourceIdChainAtCreate)) {
            dbg('skipping override rule, path no longer matches (tree reordered)', rule);
            return;
          }
          const node = found.node;

          if (typeof rule.users === 'number') {
            if (rule.skipRebalance) {
              // Set this node's volume in isolation — no sibling rebalancing.
              // Needed when siblings represent independently-sized outcome
              // buckets of the same parent cohort (e.g. "returned on web" vs
              // "returned on mobile"), rather than one sibling stealing
              // volume from another's existing flow (which IS what the
              // rebalance below is for).
              node.upsampledSize = Math.max(0, Math.round(rule.users));
              changed = true;
            } else {
              const parentChildren = getParentChildrenArray(tree, rule.path);
              const idx = rule.path[rule.path.length - 1];
              if (parentChildren) {
                rebalanceUsersAfterChange(parentChildren, idx, rule.users);
                changed = true;
              }
            }
          }
          // NOTE: this API's percentage fields are plain 0-100 numbers, NOT the
          // 0-1 decimal fraction the old Sunburst shape used (verified live:
          // a rule value of 77 rendered as "77% Conversion", not "0.77%").
          if (typeof rule.conversionPct === 'number') { node.percentageUsersConverted = rule.conversionPct; changed = true; }
          if (typeof rule.churnPct === 'number') { node.percentageUsersChurned = rule.churnPct; changed = true; }
          if (rule.breakdown) {
            node.conversionBreakdown = node.conversionBreakdown || {};
            const totalForBreakdown = Number(node.upsampledSize) || 0;
            CONVERSION_BREAKDOWN_KEYS.forEach(key => {
              const pctField = key + 'Pct';
              if (typeof rule.breakdown[pctField] === 'number') {
                const pct = rule.breakdown[pctField];
                node.conversionBreakdown[key] = node.conversionBreakdown[key] || {};
                node.conversionBreakdown[key].percentage = pct;
                node.conversionBreakdown[key].upsampledSize = Math.round((pct / 100) * totalForBreakdown);
              }
            });
            changed = true;
          }
          if (Array.isArray(rule.channels) && rule.channels.length) {
            const totalForChannels = Number(node.upsampledSize) || 0;
            node.marketingChannels = rule.channels
              .filter(c => c && c.name)
              .map(c => {
                const pct = Number(c.usersPercentage) || 0;
                return { name: c.name, usersPercentage: pct, upsampledSize: Math.round((pct / 100) * totalForChannels) };
              });
            changed = true;
          }
          if (typeof rule.avgSessionDurationMsec === 'number') { node.avgSessionDurationMsec = rule.avgSessionDurationMsec; changed = true; }
          if (typeof rule.avgPagesViewedPerSession === 'number') { node.avgPagesViewedPerSession = rule.avgPagesViewedPerSession; changed = true; }
        } else if (rule.kind === 'branch') {
          const found = findNodeInTree(tree, rule.parentPath);
          if (!found || !found.node) return;
          if (!chainsMatch(found.chain, rule.parentDataSourceIdChainAtCreate)) {
            dbg('skipping branch rule, parent path no longer matches (tree reordered)', rule);
            return;
          }
          const parent = found.node;
          parent.children = Array.isArray(parent.children) ? parent.children : [];
          // Breakdown/channels default to zeroed unless the rule provides them —
          // without this, clicking into a fabricated node's Breakdown dialog
          // would show 0% everywhere while the card shows real numbers.
          const bd = rule.breakdown || {};
          const branchTotalUsers = typeof rule.users === 'number' ? Math.max(0, Math.round(rule.users)) : 0;
          const buildSplit = pct => {
            const p = typeof pct === 'number' ? pct : 0;
            return { percentage: p, upsampledSize: Math.round((p / 100) * branchTotalUsers) };
          };
          const newChild = {
            dataSourceId: rule.newDataSourceId,
            upsampledSize: 0,
            percentageUsersConverted: typeof rule.conversionPct === 'number' ? rule.conversionPct : 0,
            percentageUsersChurned: typeof rule.churnPct === 'number' ? rule.churnPct : 0,
            percentageFromParent: 0,
            conversionBreakdown: {
              convertedReturned: buildSplit(bd.convertedReturnedPct),
              convertedNotReturned: buildSplit(bd.convertedNotReturnedPct),
              notConvertedReturned: buildSplit(bd.notConvertedReturnedPct),
              notConvertedNotReturned: buildSplit(bd.notConvertedNotReturnedPct)
            },
            marketingChannels: Array.isArray(rule.channels)
              ? rule.channels.filter(c => c && c.name).map(c => {
                  const pct = Number(c.usersPercentage) || 0;
                  return { name: c.name, usersPercentage: pct, upsampledSize: Math.round((pct / 100) * branchTotalUsers) };
                })
              : [],
            avgSessionDurationMsec: typeof rule.avgSessionDurationMsec === 'number' ? rule.avgSessionDurationMsec : 0,
            avgPagesViewedPerSession: typeof rule.avgPagesViewedPerSession === 'number' ? rule.avgPagesViewedPerSession : 0,
            children: [],
            __csDemoFabricated: true
          };
          parent.children.push(newChild);
          rebalanceUsersAfterChange(parent.children, parent.children.length - 1, typeof rule.users === 'number' ? rule.users : 0);
          changed = true;
        }
      } catch (e) { dbg('rule apply error', e, rule); }
    });

    // Apply 'hide' rules last, grouped by parent children-array, removing
    // highest index first within each group — otherwise removing an earlier
    // sibling would shift the stored index of a later one still queued for
    // removal in the same array.
    const hideGroups = new Map();
    rules.forEach(rule => {
      if (rule.kind !== 'hide' || !Array.isArray(rule.path) || !rule.path.length) return;
      const key = JSON.stringify(rule.path.slice(0, -1));
      if (!hideGroups.has(key)) hideGroups.set(key, []);
      hideGroups.get(key).push(rule);
    });
    hideGroups.forEach(groupRules => {
      groupRules
        .slice()
        .sort((a, b) => b.path[b.path.length - 1] - a.path[a.path.length - 1])
        .forEach(rule => {
          try {
            const found = findNodeInTree(tree, rule.path);
            if (!found || !found.node) return;
            if (!chainsMatch(found.chain, rule.dataSourceIdChainAtCreate)) {
              dbg('skipping hide rule, path no longer matches (tree reordered)', rule);
              return;
            }
            const parentChildren = getParentChildrenArray(tree, rule.path);
            const idx = rule.path[rule.path.length - 1];
            if (parentChildren && idx >= 0 && idx < parentChildren.length) {
              parentChildren.splice(idx, 1);
              changed = true;
            }
          } catch (e) { dbg('hide rule apply error', e, rule); }
        });
    });

    return changed;
  }


  const isJourneyExplorerUrl = url => url.includes('/api/journey/v1/') && url.includes('navigation-tree');

  function processResponseJson(url, data) {
    let changed = false;
    if (isDataSourceNameLookup(url)) {
      cacheDataSourceNames(data);
      return false;
    }
    if (!isJourneyExplorerUrl(url)) return false;
    if (!data || !data.payload || !Array.isArray(data.payload.tree)) return false;

    // Apply rules BEFORE harvesting, not after — otherwise a fabricated
    // branch never appears in the node picker, since the harvest would only
    // ever see the pre-mutation tree. Applying first means the picker (and
    // its "parent node" dropdown for Add Branch) reflects fabricated nodes
    // too, so a second branch can be chained onto a first one. Verified
    // live: a branch-of-a-branch renders correctly in the real UI, so this
    // was purely a picker limitation, not a data/rendering one.
    if (applyJourneyExplorerRules(data.payload.tree, getRules())) changed = true;

    _lastHarvestedFlatNodes = harvestJourneyExplorerNodes(data.payload.tree);
    window.postMessage({
      type: 'CS_JOURNEY_EXPLORER_NODES_SCRAPED',
      nodes: _lastHarvestedFlatNodes,
      dataSourceNames: { ...dataSourceNameCache }
    }, location.origin || '*');

    return changed;
  }

  // ---------------------------------------------------------
  // FETCH INTERCEPTOR
  // ---------------------------------------------------------
  const originalFetchJE = window.fetch;
  window.fetch = async function(...args) {
    const url = typeof args[0] === 'string' ? args[0] : (args[0] instanceof Request ? args[0].url : (args[0] && args[0].url) || '');
    const method = (args[1] && args[1].method) ? args[1].method.toUpperCase() : 'GET';
    const response = await originalFetchJE.apply(this, args);

    if (method === 'OPTIONS') return response;
    if (!url || (!isJourneyExplorerUrl(url) && !isDataSourceNameLookup(url))) return response;

    try {
      const clone = response.clone();
      const data = await clone.json();
      if (processResponseJson(url, data)) {
        dbg('applied rule(s) to Journey Explorer payload', url);
        return new Response(JSON.stringify(data), { status: response.status, headers: response.headers });
      }
    } catch (e) { dbg('fetch intercept error', e); }
    return response;
  };

  // ---------------------------------------------------------
  // XHR INTERCEPTOR
  // ---------------------------------------------------------
  const originalXhrOpenJE = XMLHttpRequest.prototype.open;
  const originalXhrSendJE = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url) {
    this._csJeUrl = url;
    this._csJeMethod = (method || '').toUpperCase();
    return originalXhrOpenJE.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function(body) {
    if (this._csJeMethod === 'OPTIONS' || !this._csJeUrl || (!isJourneyExplorerUrl(this._csJeUrl) && !isDataSourceNameLookup(this._csJeUrl))) {
      return originalXhrSendJE.apply(this, arguments);
    }
    this.addEventListener('readystatechange', function() {
      if (this.readyState !== 4) return;
      try {
        const data = JSON.parse(this.responseText);
        if (processResponseJson(this._csJeUrl, data)) {
          dbg('applied rule(s) to Journey Explorer payload (XHR)', this._csJeUrl);
          Object.defineProperty(this, 'responseText', { configurable: true, get: () => JSON.stringify(data) });
          Object.defineProperty(this, 'response', { configurable: true, get: () => JSON.stringify(data) });
        }
      } catch (e) { dbg('xhr intercept error', e); }
    });
    return originalXhrSendJE.apply(this, arguments);
  };

  // ---------------------------------------------------------
  // MOCKED REPLAY LINKS: inject a working link next to the native disabled
  // "See replays" button on the Breakdown dialog. Correlates a card click to
  // a tree path by matching its ordinal position among rendered cards
  // against the same ordinal position in the last-harvested flat node list.
  //
  // The whole Journey Explorer UI (cards, edges, the Breakdown dialog) lives
  // inside a shadow-DOM web component (<app-journey-analysis>), confirmed
  // live — a plain document.querySelectorAll from the top-level document
  // finds none of it. A MutationObserver on document.documentElement also
  // can't see into shadow roots. So: (1) shadow-pierce for the ordinal
  // count instead of a plain querySelectorAll, and (2) poll for the dialog
  // instead of observing for it — the existing codebase already polls for
  // similarly shadow-heavy DOM state elsewhere (e.g. content.js's zone
  // polling), so this matches an established pattern here, not a new one.
  // ---------------------------------------------------------
  function queryAllDeep(selector, root) {
    const out = [];
    const walk = node => {
      if (!node || !node.querySelectorAll) return;
      node.querySelectorAll(selector).forEach(el => out.push(el));
      node.querySelectorAll('*').forEach(el => { if (el.shadowRoot) walk(el.shadowRoot); });
    };
    walk(root || document);
    return out;
  }

  let _lastClickedCardEl = null;
  let _lastClickedAt = 0;

  // The session-card elements aren't the only role="group" nodes on this
  // page — the edge/arrow SVGs between cards are ALSO role="group" (visible
  // in the accessibility tree as "Edge from node-X to node-Y"), which threw
  // off an earlier ordinal-counting approach. Cards are reliably the only
  // role="group" elements whose own text includes "Users".
  const isCardGroup = el => !!(el && el.getAttribute && el.getAttribute('role') === 'group' && /users/i.test(el.textContent || ''));

  document.addEventListener('click', event => {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    let cardEl = path.find(node => node instanceof Element && isCardGroup(node));
    if (!cardEl) {
      for (const node of path) {
        if (!(node instanceof Element)) continue;
        const candidate = closestAcrossShadowJE(node, '[role="group"]');
        if (isCardGroup(candidate)) { cardEl = candidate; break; }
      }
    }
    if (!cardEl) return;
    _lastClickedCardEl = cardEl;
    _lastClickedAt = Date.now();
  }, true);

  // Matching the clicked card to a rule by ORDINAL POSITION in a flattened
  // full-tree walk turned out to be fragile in practice: a single native lane
  // that runs 10+ sessions deep (very plausible — this demo project's own web
  // chain does) shifts every ordinal after it, so "the 10th harvested node"
  // and "the 10th rendered card" silently stop being the same node. Instead,
  // read the Users count + Conversion% directly off the clicked card's own
  // text and match that pair against our rules' own `users`/`conversionPct` —
  // both values are already right there on the card, and the pair is unique
  // across this dataset's replay-enabled rules by construction.
  function findRuleForClickedCard(cardEl) {
    if (!cardEl) return null;
    const text = (cardEl.textContent || '').replace(/\s+/g, ' ');
    const usersMatch = text.match(/([\d,]+)\s*Users/i);
    if (!usersMatch) return null;
    const users = parseInt(usersMatch[1].replace(/,/g, ''), 10);
    const pcts = Array.from(text.matchAll(/(\d+(?:\.\d+)?)%/g)).map(m => parseFloat(m[1]));
    return getRules().find(r => {
      if (!Array.isArray(r.replays) || !r.replays.length) return false;
      if (typeof r.users !== 'number' || Math.round(r.users) !== users) return false;
      if (typeof r.conversionPct === 'number') return pcts.some(p => Math.abs(p - r.conversionPct) < 0.5);
      return true;
    });
  }

  function injectReplayLinks(dialogEl, rule) {
    if (queryAllDeep('[data-cs-demo-replay-injected]', dialogEl).length) return;
    const seeReplaysBtn = queryAllDeep('button', dialogEl).find(b => /see replays/i.test(b.textContent || ''));
    if (!seeReplaysBtn || !seeReplaysBtn.parentElement) return;

    const wrap = document.createElement('span');
    wrap.setAttribute('data-cs-demo-replay-injected', '1');
    wrap.style.cssText = 'display:inline-flex;gap:6px;margin-left:8px;';
    rule.replays.slice(0, 3).forEach(replay => {
      const link = document.createElement('button');
      link.textContent = `▶ ${replay.label || 'View replay'}`;
      link.style.cssText = 'background:#2c2c8c;color:#fff;border:none;border-radius:4px;font-size:11px;padding:4px 8px;cursor:pointer;';
      link.addEventListener('click', evt => {
        evt.preventDefault();
        evt.stopPropagation();
        window.open(replay.url, '_blank');
      });
      wrap.appendChild(link);
    });
    seeReplaysBtn.parentElement.insertBefore(wrap, seeReplaysBtn.nextSibling);
  }

  function pollForBreakdownDialog() {
    try {
      if (Date.now() - _lastClickedAt > 4000 || !_lastClickedCardEl) return;
      const dialogs = queryAllDeep('[role="dialog"]');
      dialogs.forEach(dialogEl => {
        const heading = queryAllDeep('h1, h2, h3, [role="heading"]', dialogEl)[0];
        if (!heading || !/breakdown/i.test(heading.textContent || '')) return;
        const rule = findRuleForClickedCard(_lastClickedCardEl);
        if (!rule) return;
        injectReplayLinks(dialogEl, rule);
      });
    } catch (e) { dbg('replay poll error', e); }
  }
  setInterval(pollForBreakdownDialog, 400);
})();