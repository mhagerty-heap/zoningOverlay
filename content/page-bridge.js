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

    if (state.uiVisible === false) {
      return;
    }

    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    const heatmapLayer = findHeatmapLayerFromPath(path);

    if (!state.editMode && !heatmapLayer) {
      return;
    }

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

// --- JOURNEY ANALYSIS INTERCEPTOR (Dynamic Robin Hood + Scraper) ---
(function() {
  // IMPORTANT: We use a different variable name here so we don't accidentally
  // trip over the old script if it's still floating in memory!
  if (window.__csDemoJourneyDynamicInstalled) return;
  window.__csDemoJourneyDynamicInstalled = true;

  console.log('🚀 [CS Demo] Journey API Interceptor Active (Dynamic Engine)');

  const extractUrl = (args) => {
    try {
      if (typeof args[0] === 'string') return args[0];
      if (args[0] instanceof Request) return args[0].url;
      if (args[0] && args[0].url) return args[0].url;
    } catch(e) {}
    return '';
  };

  // ---------------------------------------------------------
  // HELPER: GET RULES FROM STORAGE
  // ---------------------------------------------------------
  const getJourneyRules = () => {
    try {
      return JSON.parse(localStorage.getItem('csDemoJourneyRules') || '[]');
    } catch(e) {
      return [];
    }
  };

  const getEffectiveName = (rule) => rule.renameTo ? rule.renameTo : rule.targetNode;

  // ---------------------------------------------------------
  // 1. RECURSIVE RENAME (Dynamic)
  // ---------------------------------------------------------
  const deepRename = (obj, rules) => {
    if (!obj || !rules.length) return false;
    let changed = false;
    
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        if (deepRename(obj[i], rules)) changed = true;
      }
    } else if (typeof obj === 'object') {
      if (obj.name && typeof obj.name === 'string') {
        const matchingRule = rules.find(r => r.targetNode.toLowerCase() === obj.name.toLowerCase());
        if (matchingRule && matchingRule.renameTo) {
          obj.name = matchingRule.renameTo;
          changed = true;
        }
      }
      for (const key in obj) {
        if (typeof obj[key] === 'object' && deepRename(obj[key], rules)) changed = true;
      }
    }
    return changed;
  };

  // ---------------------------------------------------------
  // 2. FIX THE RIGHT PANEL (Dynamic)
  // ---------------------------------------------------------
  const fixRightPanel = (elementsArray, rules) => {
    if (!Array.isArray(elementsArray) || !rules.length) return false;
    let changed = false;
    
    elementsArray.forEach(el => {
      rules.forEach(rule => {
        const targetName = getEffectiveName(rule);
        if (el.name === targetName || el.name === rule.targetNode) {
          el.percent = (rule.percent / 100); 
          changed = true;
        }
      });
    });
    return changed;
  };

  // ---------------------------------------------------------
  // 3. FIX THE SUNBURST VISUAL (Dynamic Robin Hood)
  // ---------------------------------------------------------
  const stealSiblingTraffic = (node, rules) => {
    if (!node || !node.children || !Array.isArray(node.children) || !rules.length) return false;
    let changed = false;

    rules.forEach(rule => {
      const targetName = getEffectiveName(rule);
      const targetIndex = node.children.findIndex(c => c.name === targetName || c.name === rule.targetNode);

      if (targetIndex !== -1) {
        const totalParentSize = node.size || 0;
        let newTargetSize = Math.round(totalParentSize * (rule.percent / 100));
        
        let siblingSum = 0;
        let exitPathSum = 0;

        node.children.forEach((c, idx) => {
          if (idx !== targetIndex) {
            if (c.name && typeof c.name === 'string' && c.name.includes('END_')) {
              exitPathSum += (c.size || 0);
            } else {
              siblingSum += (c.size || 0);
            }
          }
        });

        // Safety bound to prevent math overflow
        if (newTargetSize + exitPathSum > totalParentSize) {
           newTargetSize = totalParentSize - exitPathSum;
           if (newTargetSize < 0) newTargetSize = 0;
        }

        const leftoverForSiblings = totalParentSize - newTargetSize - exitPathSum;

        node.children.forEach((c, idx) => {
          if (idx === targetIndex) {
            c.size = newTargetSize;
            if (c.paMetrics) c.paMetrics.sessionRetentionCount = newTargetSize;
          } else if (c.name && typeof c.name === 'string' && c.name.includes('END_')) {
            // Keep exits intact
          } else {
            const siblingShare = siblingSum === 0 ? 0 : ((c.size || 0) / siblingSum);
            c.size = Math.round(leftoverForSiblings * siblingShare);
            if (c.size < 0) c.size = 0; 
            if (c.paMetrics) c.paMetrics.sessionRetentionCount = c.size;
          }
        });
        changed = true;
      }
    });

    // Drill down
    node.children.forEach(child => {
      if (stealSiblingTraffic(child, rules)) changed = true;
    });

    return changed;
  };

  // ---------------------------------------------------------
  // 4. THE HARVESTER 
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
    const url = extractUrl(args);
    const response = await originalFetch.apply(this, args);

    try {
      if (url.includes('/pages') && url.includes('mappings')) {
        const clone = response.clone();
        const data = await clone.json();
        const activeRules = getJourneyRules();
        if (deepRename(data, activeRules)) {
          return new Response(JSON.stringify(data), { status: response.status, headers: response.headers });
        }
      }

      if (url.includes('/navigation-path')) {
        const clone = response.clone();
        const data = await clone.json();
        let changed = false;
        const activeRules = getJourneyRules();

        if (data && data.payload) {
           if (data.payload.tree) {
             const uniqueNames = Array.from(extractAllNodeNames(data.payload.tree));
             window.postMessage({ type: 'CS_JOURNEY_NODES_SCRAPED', nodes: uniqueNames.sort() }, '*');
           }

           if (fixRightPanel(data.payload.elements, activeRules)) changed = true;
           if (stealSiblingTraffic(data.payload.tree, activeRules)) changed = true;
        }

        if (changed) {
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
    return originalXhrOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function() {
    this.addEventListener('readystatechange', function() {
      if (this.readyState === 4 && this._customDemoUrl) {
        try {
          if (this._customDemoUrl.includes('/pages') && this._customDemoUrl.includes('mappings')) {
             const data = JSON.parse(this.responseText);
             const activeRules = getJourneyRules();
             if (deepRename(data, activeRules)) {
                Object.defineProperty(this, 'responseText', { get: () => JSON.stringify(data) });
                Object.defineProperty(this, 'response', { get: () => JSON.stringify(data) });
             }
          }
          if (this._customDemoUrl.includes('/navigation-path')) {
             const data = JSON.parse(this.responseText);
             let changed = false;
             const activeRules = getJourneyRules();

             if (data && data.payload) {
                if (data.payload.tree) {
                   const uniqueNames = Array.from(extractAllNodeNames(data.payload.tree));
                   window.postMessage({ type: 'CS_JOURNEY_NODES_SCRAPED', nodes: uniqueNames.sort() }, '*');
                }

                if (fixRightPanel(data.payload.elements, activeRules)) changed = true;
                if (stealSiblingTraffic(data.payload.tree, activeRules)) changed = true;
             }

             if (changed) {
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