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
      // Use the first whitespace-delimited token so counts/icons don't break matching
      // (e.g. "clicks 4,521" or "moves ↑" still resolve to the correct layer).
      const firstWord = text.split(' ')[0];
      console.debug('[CS page-bridge] layer tab candidate:', JSON.stringify(text), '→ firstWord:', firstWord);
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

    // Outside edit mode, only forward explicit heatmap layer tab interactions.
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