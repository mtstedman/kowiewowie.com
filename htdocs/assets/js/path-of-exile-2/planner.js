import { loadTree, buildAllocationModel } from './tree-data.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MIN_SCALE = 0.025;
const MAX_SCALE = 2.5;

const elements = {
  status: document.querySelector('#poe2-status'),
  classSelect: document.querySelector('#poe2-class'),
  ascendancySelect: document.querySelector('#poe2-ascendancy'),
  buildControls: document.querySelector('#poe2-build-controls'),
  searchForm: document.querySelector('#poe2-search'),
  searchInput: document.querySelector('#poe2-node-query'),
  searchButton: document.querySelector('#poe2-search button'),
  passiveTotal: document.querySelector('#poe2-passive-total'),
  ascendancyTotal: document.querySelector('#poe2-ascendancy-total'),
  fitButton: document.querySelector('#poe2-fit'),
  resetButton: document.querySelector('#poe2-reset'),
  retryButton: document.querySelector('#poe2-retry'),
  zoomOut: document.querySelector('#poe2-zoom-out'),
  zoomIn: document.querySelector('#poe2-zoom-in'),
  treePanel: document.querySelector('.poe2-tree-panel'),
  tree: document.querySelector('#poe2-tree'),
  viewport: document.querySelector('#poe2-viewport'),
  edgeLayer: document.querySelector('#poe2-edges'),
  nodeLayer: document.querySelector('#poe2-nodes'),
  detailsTitle: document.querySelector('#poe2-details-title'),
  nodeMeta: document.querySelector('#poe2-node-meta'),
  nodeStats: document.querySelector('#poe2-node-stats'),
  toggleNode: document.querySelector('#poe2-toggle-node'),
  version: document.querySelector('#poe2-version'),
};

const state = {
  data: null,
  model: null,
  nodeById: new Map(),
  nodeElements: new Map(),
  edgeElements: [],
  allocated: new Set(),
  // Node IDs that are a legal next allocation for `allocated` under `model`;
  // null means it must be recomputed (see currentAvailability).
  available: null,
  rootIds: new Set(),
  selectedId: null,
  classId: null,
  ascendancyId: null,
  view: { x: 0, y: 0, scale: 1 },
  bounds: null,
  drag: null,
};

function setStatus(message, error = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle('poe2-notice--error', error);
}

function setEnabled(enabled) {
  elements.buildControls.disabled = !enabled;
  elements.searchInput.disabled = !enabled;
  elements.searchButton.disabled = !enabled;
  elements.fitButton.disabled = !enabled;
  elements.resetButton.disabled = !enabled;
  elements.zoomIn.disabled = !enabled;
  elements.zoomOut.disabled = !enabled;
}

function replaceOptions(select, options) {
  select.replaceChildren();
  for (const optionData of options) {
    const option = document.createElement('option');
    option.value = optionData.id;
    option.textContent = optionData.name;
    select.append(option);
  }
}

function selectedClass() {
  return state.data?.classes.find((option) => option.id === elements.classSelect.value) || null;
}

function populateAscendancies(preferredId = '') {
  const classOption = selectedClass();
  const options = [{ id: '', name: 'No ascendancy' }];
  if (classOption) options.push(...classOption.ascendancies);
  replaceOptions(elements.ascendancySelect, options);
  elements.ascendancySelect.value = options.some((option) => option.id === preferredId) ? preferredId : '';
}

function applyTransform() {
  const { x, y, scale } = state.view;
  elements.viewport.setAttribute('transform', `translate(${x} ${y}) scale(${scale})`);
}

function svgSize() {
  const rect = elements.tree.getBoundingClientRect();
  return { width: Math.max(rect.width, 1), height: Math.max(rect.height, 1) };
}

function fitTree() {
  if (!state.bounds) return;
  const { width, height } = svgSize();
  const padding = 80;
  const worldWidth = Math.max(state.bounds.maxX - state.bounds.minX, 1);
  const worldHeight = Math.max(state.bounds.maxY - state.bounds.minY, 1);
  const scale = Math.min((width - padding) / worldWidth, (height - padding) / worldHeight);
  state.view.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
  state.view.x = width / 2 - ((state.bounds.minX + state.bounds.maxX) / 2) * state.view.scale;
  state.view.y = height / 2 - ((state.bounds.minY + state.bounds.maxY) / 2) * state.view.scale;
  applyTransform();
}

function zoomAt(factor, screenX, screenY) {
  if (!state.model) return;
  const oldScale = state.view.scale;
  const nextScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, oldScale * factor));
  if (nextScale === oldScale) return;
  const worldX = (screenX - state.view.x) / oldScale;
  const worldY = (screenY - state.view.y) / oldScale;
  state.view.scale = nextScale;
  state.view.x = screenX - worldX * nextScale;
  state.view.y = screenY - worldY * nextScale;
  applyTransform();
}

function nodeRadius(node) {
  if (node.kind === 'classStart' || node.kind === 'ascendancyStart') return 46;
  if (node.kind === 'keystone') return 38;
  if (node.kind === 'notable' || node.kind === 'jewelSocket') return 30;
  return 21;
}

function buildGraph() {
  elements.edgeLayer.replaceChildren();
  elements.nodeLayer.replaceChildren();
  state.nodeElements.clear();
  state.edgeElements = [];
  state.nodeById = new Map(state.model.nodes.map((node) => [node.id, node]));

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of state.model.nodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x);
    maxY = Math.max(maxY, node.y);
  }
  state.bounds = { minX, minY, maxX, maxY };

  const edgeFragment = document.createDocumentFragment();
  for (const [fromId, toId] of state.model.edges) {
    const from = state.nodeById.get(fromId);
    const to = state.nodeById.get(toId);
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('class', 'poe2-edge');
    line.setAttribute('x1', String(from.x));
    line.setAttribute('y1', String(from.y));
    line.setAttribute('x2', String(to.x));
    line.setAttribute('y2', String(to.y));
    edgeFragment.append(line);
    state.edgeElements.push({ element: line, fromId, toId });
  }
  elements.edgeLayer.append(edgeFragment);

  // Root and ascendancy membership never change within a model, so those
  // classes are written once here. Selection is delegated to the tree element.
  const nodeFragment = document.createDocumentFragment();
  for (const node of state.model.nodes) {
    const isRoot = state.rootIds.has(node.id);
    const radius = nodeRadius(node);
    const group = document.createElementNS(SVG_NS, 'g');
    group.setAttribute('class', `poe2-node${isRoot ? ' is-root' : ''}${node.domain === 'ascendancy' ? ' is-ascendancy' : ''}`);
    group.setAttribute('transform', `translate(${node.x} ${node.y})`);
    group.setAttribute('role', 'button');
    group.setAttribute('tabindex', isRoot ? '0' : '-1');
    group.setAttribute('aria-label', `${node.name || `Node ${node.id}`}, ${node.domain} node`);
    group.dataset.nodeId = node.id;

    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('r', String(radius));
    group.append(circle);

    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('y', String(-radius - 14));
    if (isRoot) label.textContent = node.name;
    group.append(label);

    nodeFragment.append(group);
    state.nodeElements.set(node.id, { group, label });
  }
  elements.nodeLayer.append(nodeFragment);
  updateGraphState();
  requestAnimationFrame(fitTree);
}

// Every change to the allocation goes through here so the availability derived
// from it can never outlive it.
function setAllocation(allocated) {
  state.allocated = allocated;
  state.available = null;
}

// The nodes that are a legal next allocation, as decided by the model. Computed
// once per allocation (one parse and one replay) and reused by every node, the
// details panel and selection-only updates until the allocation or model changes.
function currentAvailability() {
  if (state.available === null) state.available = state.model.availableNodeIds([...state.allocated]);
  return state.available;
}

function setAttributeIfChanged(element, name, value) {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}

function paintNode(id, parts, available) {
  const isRoot = state.rootIds.has(id);
  const allocated = state.allocated.has(id);
  const selected = state.selectedId === id;
  const labelText = selected || isRoot ? state.nodeById.get(id).name : '';
  parts.group.classList.toggle('is-allocated', allocated);
  parts.group.classList.toggle('is-available', available.has(id));
  parts.group.classList.toggle('is-selected', selected);
  setAttributeIfChanged(parts.group, 'aria-pressed', String(allocated || isRoot));
  setAttributeIfChanged(parts.group, 'tabindex', selected || isRoot ? '0' : '-1');
  if (parts.label.textContent !== labelText) parts.label.textContent = labelText;
}

// Full refresh, for a new model or a changed allocation.
function updateGraphState() {
  if (!state.model) return;
  const available = currentAvailability();
  for (const [id, parts] of state.nodeElements) paintNode(id, parts, available);
  const active = new Set([...state.allocated, ...state.rootIds]);
  for (const edge of state.edgeElements) {
    edge.element.classList.toggle('is-allocated', active.has(edge.fromId) && active.has(edge.toId));
  }
  const totals = state.model.pointCost([...state.allocated]);
  elements.passiveTotal.textContent = String(totals.passive);
  elements.ascendancyTotal.textContent = String(totals.ascendancy);
  elements.resetButton.disabled = state.allocated.size === 0;
  updateDetails();
}

// Selection-only refresh: the allocation is unchanged, so only the previously
// and newly selected nodes and the details panel can differ.
function updateSelectionState(previousId) {
  if (!state.model) return;
  const available = currentAvailability();
  for (const id of new Set([previousId, state.selectedId])) {
    const parts = id ? state.nodeElements.get(id) : null;
    if (parts) paintNode(id, parts, available);
  }
  updateDetails();
}

function updateDetails() {
  const node = state.selectedId ? state.nodeById.get(state.selectedId) : null;
  elements.nodeStats.replaceChildren();
  if (!node) {
    elements.detailsTitle.textContent = 'Select a node';
    elements.nodeMeta.textContent = 'Choose any visible node to see its stats and allocation state.';
    elements.toggleNode.textContent = 'Allocate node';
    elements.toggleNode.disabled = true;
    return;
  }

  const isRoot = state.rootIds.has(node.id);
  const isAllocated = state.allocated.has(node.id);
  const canAllocate = currentAvailability().has(node.id);
  elements.detailsTitle.textContent = node.name || `Node ${node.id}`;
  elements.nodeMeta.textContent = `${node.domain === 'ascendancy' ? 'Ascendancy' : 'Passive'} · ${node.kind} · ID ${node.id}${isRoot ? ' · implicit free start' : isAllocated ? ' · allocated' : canAllocate ? ' · available next' : ' · not currently available'}`;
  for (const stat of node.stats) {
    const item = document.createElement('li');
    item.textContent = stat;
    elements.nodeStats.append(item);
  }
  if (node.stats.length === 0) {
    const item = document.createElement('li');
    item.textContent = 'No stat text in this export.';
    elements.nodeStats.append(item);
  }
  elements.toggleNode.textContent = isRoot ? 'Starting node' : isAllocated ? 'Remove node' : 'Allocate node';
  elements.toggleNode.disabled = isRoot;
}

function nodeIdFromEvent(event) {
  const group = event.target instanceof Element ? event.target.closest('[data-node-id]') : null;
  return group ? group.dataset.nodeId : null;
}

function selectNode(nodeId, focus = false) {
  if (!state.nodeById.has(nodeId)) return;
  const previousId = state.selectedId;
  state.selectedId = nodeId;
  updateSelectionState(previousId);
  const parts = state.nodeElements.get(nodeId);
  if (focus && parts) parts.group.focus({ preventScroll: true });
}

function centerNode(nodeId) {
  const node = state.nodeById.get(nodeId);
  if (!node) return;
  const { width, height } = svgSize();
  state.view.scale = Math.max(state.view.scale, 0.22);
  state.view.x = width / 2 - node.x * state.view.scale;
  state.view.y = height / 2 - node.y * state.view.scale;
  applyTransform();
  selectNode(nodeId, true);
}

function tryAllocationChange() {
  const nodeId = state.selectedId;
  if (!state.model || !nodeId || state.rootIds.has(nodeId)) return;
  const candidate = new Set(state.allocated);
  const removing = candidate.delete(nodeId);
  if (!removing) candidate.add(nodeId);
  const validation = state.model.validateAllocation([...candidate]);
  if (!validation.valid) {
    setStatus(validation.reason || 'That allocation is not legal.', true);
    return;
  }
  setAllocation(candidate);
  updateGraphState();
  const node = state.nodeById.get(nodeId);
  setStatus(`${node.name || `Node ${nodeId}`} ${removing ? 'removed' : 'allocated'}.`);
}

function rebuildModel(classId, ascendancyId, announce = true) {
  const nextAscendancyId = ascendancyId || null;
  let nextModel;
  try {
    nextModel = buildAllocationModel(state.data, classId, nextAscendancyId);
  } catch (error) {
    elements.classSelect.value = state.classId || elements.classSelect.value;
    populateAscendancies(state.ascendancyId || '');
    setStatus(error instanceof Error ? error.message : 'The selected build could not be created.', true);
    return false;
  }

  state.model = nextModel;
  state.classId = classId;
  state.ascendancyId = nextAscendancyId;
  state.rootIds = new Set(nextModel.rootIds);
  setAllocation(new Set());
  state.selectedId = nextModel.rootIds[0] || null;
  setEnabled(true);
  elements.retryButton.hidden = true;
  buildGraph();
  elements.treePanel.setAttribute('aria-busy', 'false');
  if (announce) {
    const className = selectedClass()?.name || classId;
    const ascendancyName = elements.ascendancySelect.selectedOptions[0]?.textContent || 'No ascendancy';
    setStatus(`${className}, ${ascendancyName}: ${nextModel.nodes.length.toLocaleString()} nodes ready. Allocations reset for the new build.`);
  }
  return true;
}

async function initialize() {
  setEnabled(false);
  elements.retryButton.hidden = true;
  elements.treePanel.setAttribute('aria-busy', 'true');
  setStatus('Loading the pinned passive-tree export…');
  try {
    const data = await loadTree();
    if (!Array.isArray(data.classes) || data.classes.length === 0) {
      throw new Error('PoE2 passive tree: the pinned export offers no selectable classes.');
    }
    state.data = data;
    elements.version.textContent = `export ${data.version}`;
    replaceOptions(elements.classSelect, data.classes);
    populateAscendancies('');
    if (!rebuildModel(elements.classSelect.value, null, false)) {
      // rebuildModel has already reported why the default build failed. Keep
      // that message instead of announcing success, leave the controls that
      // need a model disabled, and offer both recoveries: choosing another
      // build or reloading the export.
      elements.buildControls.disabled = false;
      elements.retryButton.hidden = false;
      elements.treePanel.setAttribute('aria-busy', 'false');
      return;
    }
    setStatus(`Export ${data.version} loaded. Choose a class or inspect the tree.`);
  } catch (error) {
    state.data = null;
    state.model = null;
    state.available = null;
    setEnabled(false);
    elements.retryButton.hidden = false;
    elements.treePanel.setAttribute('aria-busy', 'false');
    setStatus(error instanceof Error ? error.message : 'The passive tree could not be loaded.', true);
  }
}

elements.classSelect.addEventListener('change', () => {
  populateAscendancies('');
  rebuildModel(elements.classSelect.value, null);
});

elements.ascendancySelect.addEventListener('change', () => {
  rebuildModel(elements.classSelect.value, elements.ascendancySelect.value || null);
});

elements.searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!state.model) return;
  const query = elements.searchInput.value.trim().toLocaleLowerCase();
  if (query === '') {
    setStatus('Enter a node name or ID to search.', true);
    return;
  }
  const exact = state.model.nodes.find((node) => node.id.toLocaleLowerCase() === query || node.name.toLocaleLowerCase() === query);
  const match = exact || state.model.nodes.find((node) => node.name.toLocaleLowerCase().includes(query) || node.id.toLocaleLowerCase().includes(query));
  if (!match) {
    setStatus(`No node matched “${elements.searchInput.value.trim()}” in this build.`, true);
    return;
  }
  centerNode(match.id);
  setStatus(`Found ${match.name || `node ${match.id}`}.`);
});

elements.toggleNode.addEventListener('click', tryAllocationChange);
elements.fitButton.addEventListener('click', fitTree);
elements.retryButton.addEventListener('click', initialize);
elements.resetButton.addEventListener('click', () => {
  if (!state.model) return;
  const validation = state.model.validateAllocation([]);
  if (!validation.valid) {
    setStatus(validation.reason || 'The allocation could not be reset.', true);
    return;
  }
  setAllocation(new Set());
  updateGraphState();
  setStatus('All allocated nodes reset. Starting nodes remain implicit and free.');
});

elements.zoomIn.addEventListener('click', () => {
  const { width, height } = svgSize();
  zoomAt(1.3, width / 2, height / 2);
});

elements.zoomOut.addEventListener('click', () => {
  const { width, height } = svgSize();
  zoomAt(1 / 1.3, width / 2, height / 2);
});

elements.tree.addEventListener('wheel', (event) => {
  if (!state.model) return;
  event.preventDefault();
  const rect = elements.tree.getBoundingClientRect();
  zoomAt(event.deltaY < 0 ? 1.16 : 1 / 1.16, event.clientX - rect.left, event.clientY - rect.top);
}, { passive: false });

elements.tree.addEventListener('pointerdown', (event) => {
  if (!state.model || event.button !== 0) return;
  state.drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: state.view.x, originY: state.view.y, moved: false };
  elements.tree.setPointerCapture(event.pointerId);
  elements.tree.classList.add('is-dragging');
});

elements.tree.addEventListener('pointermove', (event) => {
  if (!state.drag || state.drag.pointerId !== event.pointerId) return;
  const dx = event.clientX - state.drag.startX;
  const dy = event.clientY - state.drag.startY;
  if (Math.abs(dx) + Math.abs(dy) > 4) state.drag.moved = true;
  state.view.x = state.drag.originX + dx;
  state.view.y = state.drag.originY + dy;
  applyTransform();
});

function endDrag(event) {
  if (!state.drag || state.drag.pointerId !== event.pointerId) return;
  elements.tree.classList.remove('is-dragging');
  try {
    elements.tree.releasePointerCapture(event.pointerId);
  } catch {
    // Capture may already be released when the pointer is cancelled.
  }
  requestAnimationFrame(() => { state.drag = null; });
}

elements.tree.addEventListener('pointerup', endDrag);
elements.tree.addEventListener('pointercancel', endDrag);

// Node selection is delegated to the tree. Panning captures the pointer on
// pointerdown, and browsers dispatch the click of a captured pointer at the
// capturing <svg> rather than at the node under it, so the click position is
// hit-tested whenever the event target is not inside a node.
elements.tree.addEventListener('click', (event) => {
  if (!state.model || state.drag?.moved) return;
  const nodeId = nodeIdFromEvent(event)
    || document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-node-id]')?.dataset.nodeId;
  if (nodeId) selectNode(nodeId);
});

elements.tree.addEventListener('keydown', (event) => {
  if (!state.model) return;
  if (event.target !== elements.tree) {
    // Enter or Space on a focused node selects it.
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const nodeId = nodeIdFromEvent(event);
    if (!nodeId) return;
    event.preventDefault();
    selectNode(nodeId);
    return;
  }
  const { width, height } = svgSize();
  if (event.key === '+' || event.key === '=') zoomAt(1.2, width / 2, height / 2);
  else if (event.key === '-' || event.key === '_') zoomAt(1 / 1.2, width / 2, height / 2);
  else if (event.key === '0') fitTree();
  else if (event.key === 'ArrowLeft') state.view.x += 48;
  else if (event.key === 'ArrowRight') state.view.x -= 48;
  else if (event.key === 'ArrowUp') state.view.y += 48;
  else if (event.key === 'ArrowDown') state.view.y -= 48;
  else return;
  event.preventDefault();
  applyTransform();
});

window.addEventListener('resize', () => {
  if (state.model) fitTree();
});

initialize();