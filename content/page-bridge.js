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

  console.log('🚀 [CS Demo] Journey API Interceptor Active (Math Engine Only)');

  const extractUrl = (args) => {
    try {
      if (typeof args[0] === 'string') return args[0];
      if (args[0] instanceof Request) return args[0].url;
      if (args[0] && args[0].url) return args[0].url;
    } catch(e) {}
    return '';
  };

  const getJourneyRules = () => {
    try {
      return JSON.parse(localStorage.getItem('csDemoJourneyRules') || '[]');
    } catch(e) {
      return [];
    }
  };

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
      console.log(`🕵️ [CS Demo Math] Alternator Timer Reset! (Time since last request: ${timeSinceLast}ms)`);
      navReqCount = 0;
    }
    lastReqTime = now;

    if (url.includes('/navigation-path') && !url.includes('/mappings')) {
      navReqCount++;
      const side = (navReqCount % 2 === 0) ? 'right' : 'left';
      console.log(`🕵️ [CS Demo Math] Chart Request #${navReqCount} fired -> Assigned to ${side.toUpperCase()} PANE.`);
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
        console.log(`🚫 [CS Math] Comparison Active. Filtering out Non-Compare rules.`);
      }
      
      // ONLY INTERCEPT SIZES, IGNORE MAPPINGS ENTIRELY
      if (url.includes('/navigation-path') && !url.includes('/mappings')) {
        const clone = response.clone();
        const data = await clone.json();
        let changed = false;

        if (data && data.payload) {
           if (data.payload.tree) {
             const uniqueNames = Array.from(extractAllNodeNames(data.payload.tree));
             window.postMessage({ type: 'CS_JOURNEY_NODES_SCRAPED', nodes: uniqueNames.sort() }, '*');
           }
           if (fixRightPanel(data.payload.elements, sideSpecificRules)) changed = true;
           if (stealSiblingTraffic(data.payload.tree, sideSpecificRules)) changed = true;
        }

        if (changed) {
          console.log(`✅ [CS Demo Math] SUCCESS: Applied ${sideSpecificRules.length} rule(s) to the ${requestSide.toUpperCase()} chart payload!`);
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
            console.log(`🚫 [CS Math XHR] Comparison Active. Filtering out Non-Compare rules.`);
          }
          
          // ONLY INTERCEPT SIZES, IGNORE MAPPINGS ENTIRELY
          if (this._customDemoUrl.includes('/navigation-path') && !this._customDemoUrl.includes('/mappings')) {
             const data = JSON.parse(this.responseText);
             let changed = false;

             if (data && data.payload) {
                if (data.payload.tree) {
                   const uniqueNames = Array.from(extractAllNodeNames(data.payload.tree));
                   window.postMessage({ type: 'CS_JOURNEY_NODES_SCRAPED', nodes: uniqueNames.sort() }, '*');
                }
                
                if (fixRightPanel(data.payload.elements, sideSpecificRules)) changed = true;
                if (stealSiblingTraffic(data.payload.tree, sideSpecificRules)) changed = true;
             }

             if (changed) {
                console.log(`%c✨ Applied Math to ${requestSide.toUpperCase()} Chart`, 'color: #2c2c8c; font-weight: bold;');
                Object.defineProperty(this, 'responseText', { get: () => JSON.stringify(data) });
                Object.defineProperty(this, 'response', { get: () => JSON.stringify(data) });
             }
          }
        } catch(e) { } 
      }
    });
    return originalXhrSend.apply(this, arguments);
  };
})();