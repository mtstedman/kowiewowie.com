import { loadTree, buildAllocationModel, summarizeRouteBonuses } from './tree-data.js';
// Production caches static JavaScript for seven days. Keep this dependency
// versioned so a new planner cannot load an older optimizer from browser cache.
// Bump the token whenever optimizer.js changes its exports.
import { findMinimalRoute, findConnection } from './optimizer.js?v=20261002-find-connection';
import { listBuilds, createBuild, updateBuild, deleteBuild } from './builds-api.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MIN_SCALE = 0.01;
const MAX_SCALE = 2.5;

// Ordinary passive-point budget behind the character-level estimate. The
// pinned GGG export (0.5.5) describes tree topology only and carries no reward
// accounting, so these figures follow the 0.5-era community wiki
// (poe2wiki.net: Passive_skill_tree, Quest_rewards): one passive point per
// level gained (none at level 1, level cap 100) plus twelve 2-point campaign
// rewards across Acts 1-4 and the Interludes. Weapon-set capacity reuses those
// 24 points rather than adding a pool. League/endgame rewards and
// ascendancy-granted extra passives are deliberately not counted. This is a
// display estimate only; nothing here limits allocation.
const CAMPAIGN_PASSIVE_POINTS = 24;
const MAX_CHARACTER_LEVEL = 100;
const STANDARD_PASSIVE_BUDGET = MAX_CHARACTER_LEVEL - 1 + CAMPAIGN_PASSIVE_POINTS;

const elements = {
  status: /** @type {HTMLParagraphElement} */ (document.querySelector('#poe2-status')),
  classSelect: /** @type {HTMLSelectElement} */ (document.querySelector('#poe2-class')),
  ascendancySelect: /** @type {HTMLSelectElement} */ (document.querySelector('#poe2-ascendancy')),
  buildControls: /** @type {HTMLFieldSetElement} */ (document.querySelector('#poe2-build-controls')),
  searchForm: /** @type {HTMLFormElement} */ (document.querySelector('#poe2-search')),
  searchInput: /** @type {HTMLInputElement} */ (document.querySelector('#poe2-node-query')),
  searchButton: /** @type {HTMLButtonElement} */ (document.querySelector('#poe2-search button')),
  passiveTotal: /** @type {HTMLElement} */ (document.querySelector('#poe2-passive-total')),
  ascendancyTotal: /** @type {HTMLElement} */ (document.querySelector('#poe2-ascendancy-total')),
  levelEstimate: /** @type {HTMLElement} */ (document.querySelector('#poe2-level-estimate')),
  levelEstimateNote: /** @type {HTMLElement} */ (document.querySelector('#poe2-level-estimate-note')),
  fitButton: /** @type {HTMLButtonElement} */ (document.querySelector('#poe2-fit')),
  resetButton: /** @type {HTMLButtonElement} */ (document.querySelector('#poe2-reset')),
  retryButton: /** @type {HTMLButtonElement} */ (document.querySelector('#poe2-retry')),
  zoomOut: /** @type {HTMLButtonElement} */ (document.querySelector('#poe2-zoom-out')),
  zoomIn: /** @type {HTMLButtonElement} */ (document.querySelector('#poe2-zoom-in')),
  treePanel: /** @type {HTMLElement} */ (document.querySelector('.poe2-tree-panel')),
  tree: /** @type {SVGSVGElement} */ (document.querySelector('#poe2-tree')),
  viewport: /** @type {SVGGElement} */ (document.querySelector('#poe2-viewport')),
  edgeLayer: /** @type {SVGGElement} */ (document.querySelector('#poe2-edges')),
  nodeLayer: /** @type {SVGGElement} */ (document.querySelector('#poe2-nodes')),
  detailsTitle: /** @type {HTMLHeadingElement} */ (document.querySelector('#poe2-details-title')),
  nodeMeta: /** @type {HTMLParagraphElement} */ (document.querySelector('#poe2-node-meta')),
  nodeStats: /** @type {HTMLUListElement} */ (document.querySelector('#poe2-node-stats')),
  toggleNode: /** @type {HTMLButtonElement} */ (document.querySelector('#poe2-toggle-node')),
  toggleMustHave: /** @type {HTMLButtonElement} */ (document.querySelector('#poe2-toggle-must-have')),
  mustHaveEmpty: /** @type {HTMLParagraphElement} */ (document.querySelector('#poe2-must-have-empty')),
  mustHaveList: /** @type {HTMLUListElement} */ (document.querySelector('#poe2-must-have-list')),
  findRoute: /** @type {HTMLButtonElement} */ (document.querySelector('#poe2-find-route')),
  clearMustHaves: /** @type {HTMLButtonElement} */ (document.querySelector('#poe2-clear-must-haves')),
  clearRoute: /** @type {HTMLButtonElement} */ (document.querySelector('#poe2-clear-route')),
  routeSummary: /** @type {HTMLDivElement} */ (document.querySelector('#poe2-route-summary')),
  bonusSummary: /** @type {HTMLDivElement} */ (document.querySelector('#poe2-bonus-summary')),
  savedBuildForm: /** @type {HTMLFormElement} */ (document.querySelector('#poe2-saved-build-form')),
  characterName: /** @type {HTMLInputElement} */ (document.querySelector('#poe2-character-name')),
  buildName: /** @type {HTMLInputElement} */ (document.querySelector('#poe2-build-name')),
  saveBuild: /** @type {HTMLButtonElement} */ (document.querySelector('#poe2-save-build')),
  saveBuildAsNew: /** @type {HTMLButtonElement} */ (document.querySelector('#poe2-save-build-as-new')),
  savedBuildOwner: /** @type {HTMLParagraphElement} */ (document.querySelector('#poe2-saved-build-owner')),
  savedBuildStatus: /** @type {HTMLParagraphElement} */ (document.querySelector('#poe2-saved-build-status')),
  savedBuildEmpty: /** @type {HTMLParagraphElement} */ (document.querySelector('#poe2-saved-build-empty')),
  savedBuildList: /** @type {HTMLUListElement} */ (document.querySelector('#poe2-saved-build-list')),
  version: /** @type {HTMLSpanElement} */ (document.querySelector('#poe2-version')),
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
  // Node IDs the user requires in the computed route, in marking order.
  mustHaves: new Set(),
  // Summary of the last computed route: { nodeCount, passive, ascendancy, exact, stale } or null.
  // `exact` is false when the route is not proven shortest.
  route: null,
  computing: false,
  enabled: false,
  selectedId: null,
  classId: null,
  ascendancyId: null,
  savedBuilds: [],
  savedBuildOwner: null,
  loadedBuildId: null,
  buildsBusy: false,
  view: { x: 0, y: 0, scale: 1 },
  bounds: null,
  fitScale: MIN_SCALE,
  renderedScale: null,
  drag: null,
};

function setStatus(message, error = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle('poe2-notice--error', error);
}

function setEnabled(enabled) {
  state.enabled = enabled;
  elements.buildControls.disabled = !enabled;
  elements.searchInput.disabled = !enabled;
  elements.searchButton.disabled = !enabled;
  elements.fitButton.disabled = !enabled;
  elements.resetButton.disabled = !enabled;
  elements.zoomIn.disabled = !enabled;
  elements.zoomOut.disabled = !enabled;
  if (!enabled) elements.toggleMustHave.disabled = true;
  renderMustHaves();
  syncSavedBuildControls();
}

function nodeName(nodeId) {
  return state.nodeById.get(nodeId)?.name || `Node ${nodeId}`;
}

function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count.toLocaleString()} ${count === 1 ? singular : pluralForm}`;
}

/**
 * Show the character level implied by `passive` paid passive points when every
 * ordinary campaign reward is assumed collected, or an unavailable state when
 * there is no model to cost against.
 *
 * @param {number | null} passive Paid passive cost from the model (no ascendancy, no free roots).
 * @param {string} [unavailableNote] Explanation shown when `passive` is null.
 */
function renderLevelEstimate(passive, unavailableNote = 'Level estimate unavailable.') {
  if (passive === null) {
    elements.levelEstimate.textContent = '—';
    elements.levelEstimateNote.textContent = unavailableNote;
    return;
  }
  if (passive > STANDARD_PASSIVE_BUDGET) {
    const excess = passive - STANDARD_PASSIVE_BUDGET;
    elements.levelEstimate.textContent = `Over level ${MAX_CHARACTER_LEVEL}`;
    elements.levelEstimateNote.textContent = `${passive} passive points is ${excess} more than the standard level-${MAX_CHARACTER_LEVEL} budget of ${STANDARD_PASSIVE_BUDGET} (${MAX_CHARACTER_LEVEL - 1} from levels + up to ${CAMPAIGN_PASSIVE_POINTS} campaign-granted).`;
    return;
  }
  const level = Math.max(1, passive - CAMPAIGN_PASSIVE_POINTS + 1);
  elements.levelEstimate.textContent = `Level ${level}`;
  if (passive === 0) {
    elements.levelEstimateNote.textContent = 'Estimated level. No passive points spent yet.';
  } else if (passive <= CAMPAIGN_PASSIVE_POINTS) {
    elements.levelEstimateNote.textContent = `Estimated minimum level. ${plural(passive, 'point')} fit within the up to ${CAMPAIGN_PASSIVE_POINTS} campaign-granted passive points, which are earned during the campaign, not at level 1.`;
  } else {
    elements.levelEstimateNote.textContent = `Estimated level + up to ${CAMPAIGN_PASSIVE_POINTS} campaign-granted passive points (assumes all are collected).`;
  }
}

function plannerUsable() {
  return state.enabled && Boolean(state.model) && !state.computing;
}

function setSavedBuildStatus(message, error = false) {
  elements.savedBuildStatus.textContent = message;
  elements.savedBuildStatus.classList.toggle('is-error', error);
}

function syncSavedBuildControls() {
  const unavailable = !plannerUsable() || state.buildsBusy;
  elements.saveBuild.disabled = unavailable;
  elements.saveBuildAsNew.hidden = !state.loadedBuildId;
  elements.saveBuildAsNew.disabled = unavailable;
  for (const button of elements.savedBuildList.querySelectorAll('button')) {
    button.disabled = state.buildsBusy || (button.dataset.buildAction === 'load' && !plannerUsable());
  }
}

function updateSavedBuildOwner() {
  elements.savedBuildOwner.textContent = state.savedBuildOwner === 'user'
    ? 'Builds are saved to your signed-in account.'
    : state.savedBuildOwner === 'guest'
      ? 'Builds are saved to this browser with a guest cookie.'
      : 'Saved-build ownership is unavailable.';
}

function savedBuildClassLabel(build) {
  const classOption = state.data?.classes.find((option) => option.id === build.class_id);
  const className = classOption?.name || build.class_id;
  if (!build.ascendancy_id) return `${className} · No ascendancy`;
  const ascendancy = classOption?.ascendancies.find((option) => option.id === build.ascendancy_id);
  return `${className} · ${ascendancy?.name || build.ascendancy_id}`;
}

function savedBuildTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function renderSavedBuilds() {
  elements.savedBuildList.replaceChildren();
  for (const build of state.savedBuilds) {
    const item = document.createElement('li');

    const title = document.createElement('div');
    title.className = 'poe2-saved-build-title';
    title.textContent = `${build.character_name} — ${build.build_name}`;

    const meta = document.createElement('div');
    meta.className = 'poe2-saved-build-meta';
    meta.textContent = `${savedBuildClassLabel(build)} · Updated ${savedBuildTime(build.updated_at)}`;

    const actions = document.createElement('div');
    actions.className = 'poe2-saved-build-buttons';

    const loadButton = document.createElement('button');
    loadButton.type = 'button';
    loadButton.dataset.buildAction = 'load';
    loadButton.textContent = 'Load';
    loadButton.setAttribute('aria-label', `Load ${build.build_name} for ${build.character_name}`);
    loadButton.addEventListener('click', () => loadSavedBuild(build));

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.dataset.buildAction = 'delete';
    deleteButton.className = 'poe2-saved-build-delete';
    deleteButton.textContent = 'Delete';
    deleteButton.setAttribute('aria-label', `Delete ${build.build_name} for ${build.character_name}`);
    deleteButton.addEventListener('click', () => removeSavedBuild(build));

    actions.append(loadButton, deleteButton);
    item.append(title, meta, actions);
    elements.savedBuildList.append(item);
  }

  const empty = state.savedBuilds.length === 0;
  elements.savedBuildEmpty.hidden = !empty;
  elements.savedBuildList.hidden = empty;
  syncSavedBuildControls();
}

function setBuildsBusy(busy) {
  state.buildsBusy = busy;
  elements.savedBuildForm.setAttribute('aria-busy', String(busy));
  syncSavedBuildControls();
}

function readBuildNames() {
  const characterName = elements.characterName.value.trim();
  const buildName = elements.buildName.value.trim();
  if (characterName.length === 0 || characterName.length > 64) {
    setSavedBuildStatus('Character name must be between 1 and 64 characters.', true);
    elements.characterName.focus();
    return null;
  }
  if (buildName.length === 0 || buildName.length > 80) {
    setSavedBuildStatus('Build name must be between 1 and 80 characters.', true);
    elements.buildName.focus();
    return null;
  }
  return { characterName, buildName };
}

function currentBuildSnapshot(names) {
  return {
    character_name: names.characterName,
    build_name: names.buildName,
    class_id: state.classId,
    ascendancy_id: state.ascendancyId,
    tree_version: state.data.version,
    allocated_node_ids: [...state.allocated],
    must_have_node_ids: [...state.mustHaves],
  };
}

function storeSavedBuild(build) {
  state.savedBuilds = [build, ...state.savedBuilds.filter((candidate) => candidate.id !== build.id)]
    .sort((left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime());
  state.savedBuildOwner = build.owner;
  state.loadedBuildId = build.id;
  updateSavedBuildOwner();
  renderSavedBuilds();
}

async function saveCurrentBuild(asNew = false) {
  const names = readBuildNames();
  if (!names) return;
  if (!plannerUsable() || state.buildsBusy) {
    setSavedBuildStatus('Wait until the planner is ready before saving.', true);
    return;
  }

  setBuildsBusy(true);
  setSavedBuildStatus(asNew || !state.loadedBuildId ? 'Saving a new build…' : 'Updating the loaded build…');
  try {
    const input = currentBuildSnapshot(names);
    const build = !asNew && state.loadedBuildId
      ? await updateBuild(state.loadedBuildId, input)
      : await createBuild(input);
    storeSavedBuild(build);
    setSavedBuildStatus(`${build.build_name} saved for ${build.character_name}.`);
  } catch (error) {
    setSavedBuildStatus(error instanceof Error ? error.message : 'The build could not be saved.', true);
  } finally {
    setBuildsBusy(false);
  }
}

async function refreshSavedBuilds() {
  setBuildsBusy(true);
  setSavedBuildStatus('Loading saved builds…');
  try {
    const result = await listBuilds();
    state.savedBuilds = result.builds;
    state.savedBuildOwner = result.owner;
    if (state.loadedBuildId && !state.savedBuilds.some((build) => build.id === state.loadedBuildId)) {
      state.loadedBuildId = null;
    }
    updateSavedBuildOwner();
    renderSavedBuilds();
    setSavedBuildStatus(state.savedBuilds.length === 0 ? '' : `${plural(state.savedBuilds.length, 'saved build')} loaded.`);
  } catch (error) {
    state.savedBuildOwner = null;
    updateSavedBuildOwner();
    setSavedBuildStatus(error instanceof Error ? error.message : 'Saved builds are unavailable.', true);
  } finally {
    setBuildsBusy(false);
  }
}

function loadSavedBuild(build) {
  if (state.buildsBusy || !plannerUsable()) return;
  const classOption = state.data.classes.find((option) => option.id === build.class_id);
  if (!classOption) {
    setSavedBuildStatus(`The saved class ${build.class_id} is not available in this tree export.`, true);
    return;
  }
  if (build.ascendancy_id && !classOption.ascendancies.some((option) => option.id === build.ascendancy_id)) {
    setSavedBuildStatus(`The saved ascendancy ${build.ascendancy_id} is not available for ${classOption.name}.`, true);
    return;
  }

  setBuildsBusy(true);
  try {
    elements.classSelect.value = build.class_id;
    populateAscendancies(build.ascendancy_id || '');
    if (!rebuildModel(build.class_id, build.ascendancy_id, false)) {
      setSavedBuildStatus('The saved build could not be loaded with this tree export.', true);
      return;
    }
    state.loadedBuildId = null;
    syncSavedBuildControls();

    const validation = state.model.validateAllocation(build.allocated_node_ids);
    if (!validation.valid) {
      setSavedBuildStatus(validation.reason || 'The saved allocation is not valid for this tree export.', true);
      return;
    }

    setAllocation(new Set(build.allocated_node_ids));
    const modelNodeIds = new Set(state.model.nodes.map((node) => node.id));
    state.mustHaves = new Set(build.must_have_node_ids.filter((nodeId) => modelNodeIds.has(nodeId)));
    state.route = null;
    renderRouteSummary();
    updateGraphState();
    renderMustHaves();
    elements.characterName.value = build.character_name;
    elements.buildName.value = build.build_name;
    state.loadedBuildId = build.id;
    syncSavedBuildControls();

    const versionNote = build.tree_version === state.data.version
      ? ''
      : ` Saved export ${build.tree_version} differs from loaded export ${state.data.version}.`;
    setSavedBuildStatus(`${build.build_name} loaded for ${build.character_name}.${versionNote}`);
  } catch (error) {
    setSavedBuildStatus(error instanceof Error ? error.message : 'The saved build could not be loaded.', true);
  } finally {
    setBuildsBusy(false);
  }
}

async function removeSavedBuild(build) {
  if (state.buildsBusy) return;
  if (!window.confirm(`Delete ${build.build_name} for ${build.character_name}?`)) return;

  setBuildsBusy(true);
  setSavedBuildStatus(`Deleting ${build.build_name}…`);
  try {
    await deleteBuild(build.id);
    state.savedBuilds = state.savedBuilds.filter((candidate) => candidate.id !== build.id);
    if (state.loadedBuildId === build.id) state.loadedBuildId = null;
    renderSavedBuilds();
    setSavedBuildStatus(`${build.build_name} deleted.`);
  } catch (error) {
    setSavedBuildStatus(error instanceof Error ? error.message : 'The saved build could not be deleted.', true);
  } finally {
    setBuildsBusy(false);
  }
}

// Clear route needs a usable planner and a computed route to clear.
function syncClearRoute() {
  elements.clearRoute.disabled = !plannerUsable() || !state.route;
}

function renderMustHaves() {
  const usable = plannerUsable();
  elements.mustHaveList.replaceChildren();
  for (const nodeId of state.mustHaves) {
    const name = nodeName(nodeId);
    const item = document.createElement('li');

    const focusButton = document.createElement('button');
    focusButton.type = 'button';
    focusButton.className = 'poe2-must-have-focus';
    focusButton.textContent = name;
    focusButton.setAttribute('aria-label', `Show ${name} on the tree`);
    focusButton.disabled = !usable;
    focusButton.addEventListener('click', () => centerNode(nodeId));

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'poe2-must-have-remove';
    removeButton.textContent = 'Remove';
    removeButton.setAttribute('aria-label', `Remove ${name} from must-have passives`);
    removeButton.disabled = !usable;
    removeButton.addEventListener('click', () => setMustHave(nodeId, false));

    item.append(focusButton, removeButton);
    elements.mustHaveList.append(item);
  }
  const empty = state.mustHaves.size === 0;
  elements.mustHaveList.hidden = empty;
  elements.mustHaveEmpty.hidden = !empty;
  elements.findRoute.disabled = !usable || empty;
  elements.clearMustHaves.disabled = !usable || empty;
  syncClearRoute();
  syncSavedBuildControls();
}

function renderRouteSummary() {
  const route = state.route;
  elements.routeSummary.replaceChildren();
  elements.routeSummary.hidden = !route;
  elements.routeSummary.classList.toggle('is-stale', Boolean(route?.stale));
  syncClearRoute();
  if (!route) return;
  const title = document.createElement('p');
  title.className = 'poe2-route-summary__title';
  if (route.stale) title.textContent = 'Last computed route (out of date)';
  else title.textContent = route.exact ? 'Shortest route' : 'Route found (not proven shortest)';
  const counts = document.createElement('p');
  counts.textContent = `${plural(route.nodeCount, 'route node')}: ${plural(route.passive, 'passive point')} and ${plural(route.ascendancy, 'ascendancy point')}.`;
  elements.routeSummary.append(title, counts);
  if (!route.exact && !route.stale) {
    const note = document.createElement('p');
    note.className = 'poe2-route-summary__note';
    note.textContent = 'This set is too large for the exact search, so the route is short but not proven shortest.';
    elements.routeSummary.append(note);
  }
  if (route.stale) {
    const note = document.createElement('p');
    note.className = 'poe2-route-summary__note';
    note.textContent = 'Must-haves or allocations changed since this route was computed. Find the route again to update it.';
    elements.routeSummary.append(note);
  }
}

function renderNetBonuses() {
  elements.bonusSummary.replaceChildren();
  if (!state.model || state.allocated.size === 0) {
    const empty = document.createElement('p');
    empty.className = 'poe2-bonus-empty';
    empty.textContent = 'No passives allocated yet.';
    elements.bonusSummary.append(empty);
    return;
  }

  const summary = summarizeRouteBonuses(state.model, [...state.allocated]);
  const groups = [
    { title: 'Summed totals', entries: summary.totals },
    { title: 'Preserved stat lines', entries: summary.unsummed },
    { title: 'Keystones', entries: summary.keystones },
    { title: 'Notables', entries: summary.notables },
  ];

  for (const group of groups) {
    if (group.entries.length === 0) continue;
    const section = document.createElement('section');
    section.className = 'poe2-bonus-group';
    const heading = document.createElement('h4');
    heading.textContent = group.title;
    const list = document.createElement('ul');
    list.className = 'poe2-bonus-list';
    for (const entry of group.entries) {
      const item = document.createElement('li');
      const text = document.createElement('span');
      text.className = 'poe2-bonus-text';
      text.textContent = typeof entry === 'string' ? entry : ('text' in entry ? entry.text : entry.name);
      item.append(text);
      if (typeof entry !== 'string' && 'count' in entry && entry.count > 1) {
        const count = document.createElement('span');
        count.className = 'poe2-bonus-count';
        count.textContent = `×${entry.count}`;
        count.setAttribute('aria-label', `repeated ${entry.count} times`);
        item.append(count);
      }
      list.append(item);
    }
    section.append(heading, list);
    elements.bonusSummary.append(section);
  }

  if (elements.bonusSummary.childElementCount === 0) {
    const empty = document.createElement('p');
    empty.className = 'poe2-bonus-empty';
    empty.textContent = 'The allocated passives have no listed bonuses.';
    elements.bonusSummary.append(empty);
  }
}

// Called whenever must-haves or allocations change outside route computation.
function invalidateRoute() {
  if (!state.route || state.route.stale) return;
  state.route.stale = true;
  renderRouteSummary();
}

function setMustHave(nodeId, marked) {
  if (!state.model || !state.nodeById.has(nodeId) || state.rootIds.has(nodeId)) return;
  if (marked === state.mustHaves.has(nodeId)) return;
  if (marked) state.mustHaves.add(nodeId);
  else state.mustHaves.delete(nodeId);
  const parts = state.nodeElements.get(nodeId);
  if (parts) paintNode(nodeId, parts, currentAvailability());
  renderMustHaves();
  invalidateRoute();
  updateDetails();
  setStatus(`${nodeName(nodeId)} ${marked ? 'marked as' : 'removed from'} must-have passives.`);
}

function clearMustHaves() {
  if (state.mustHaves.size === 0) return;
  const ids = [...state.mustHaves];
  state.mustHaves.clear();
  if (state.model) {
    const available = currentAvailability();
    for (const id of ids) {
      const parts = state.nodeElements.get(id);
      if (parts) paintNode(id, parts, available);
    }
  }
  renderMustHaves();
  invalidateRoute();
  updateDetails();
  setStatus('All must-have passives cleared.');
}

// Drops the computed route and its allocation; must-haves are kept so the
// route can be found again.
function clearRoute() {
  if (!state.model || state.computing || !state.route) return;
  setAllocation(new Set());
  state.route = null;
  renderRouteSummary();
  updateGraphState();
  setStatus('Route cleared. Allocations reset; must-have passives are kept.');
}

function nextPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });
}

async function computeRoute() {
  if (!state.model || state.computing || state.mustHaves.size === 0) return;
  const model = state.model;
  const mustHaves = [...state.mustHaves];
  state.computing = true;
  renderMustHaves();
  updateDetails();
  setStatus(`Computing a route through ${plural(mustHaves.length, 'must-have passive')}…`);
  try {
    await nextPaint();
    // The build may have changed while the status painted.
    if (state.model !== model) return;
    const result = findMinimalRoute(model, mustHaves);
    if (!result.ok) {
      state.route = null;
      renderRouteSummary();
      setStatus(result.reason || 'No route could be found for these must-have passives.', true);
      return;
    }
    setAllocation(new Set(result.nodeIds));
    updateGraphState();
    // Only an exact result is proven shortest; the fallback is disclosed as such.
    const exact = result.exact === true;
    state.route = {
      nodeCount: result.nodeIds.length,
      passive: result.pointCost.passive,
      ascendancy: result.pointCost.ascendancy,
      exact,
      stale: false,
    };
    renderRouteSummary();
    setStatus(exact
      ? `Shortest route found: ${plural(result.nodeIds.length, 'node')} allocated.`
      : `Route found, but not proven shortest: ${plural(result.nodeIds.length, 'node')} allocated.`);
  } finally {
    state.computing = false;
    renderMustHaves();
    updateDetails();
  }
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
  // Panning changes only the viewport transform. Resize glyphs only on zoom.
  if (state.renderedScale === scale) return;
  state.renderedScale = scale;
  const density = Math.min(1, scale / 0.025);
  elements.tree.style.setProperty('--poe2-node-stroke', String(0.4 * density));
  elements.tree.style.setProperty('--poe2-edge-stroke', String(0.35 * density));
  for (const parts of state.nodeElements.values()) {
    const radius = Math.max(parts.radius, Math.max(0.55, parts.screenRadius * density) / scale);
    parts.circle.setAttribute('r', String(radius));
    if (parts.kindRing) parts.kindRing.setAttribute('r', String(radius * 0.55));
    parts.label.setAttribute('y', String(-radius - 14));
  }
}

function svgSize() {
  const rect = elements.tree.getBoundingClientRect();
  return { width: Math.max(rect.width, 1), height: Math.max(rect.height, 1) };
}

function fitTree() {
  if (!state.bounds) return;
  const { width, height } = svgSize();
  const padding = Math.min(32, width / 4, height / 4);
  const worldWidth = Math.max(state.bounds.maxX - state.bounds.minX, 1);
  const worldHeight = Math.max(state.bounds.maxY - state.bounds.minY, 1);
  const scale = Math.min((width - padding) / worldWidth, (height - padding) / worldHeight);
  // A lower clamp would crop the tree on narrow panels instead of fitting it.
  state.fitScale = Math.min(MAX_SCALE, scale);
  state.view.scale = state.fitScale;
  state.view.x = width / 2 - ((state.bounds.minX + state.bounds.maxX) / 2) * state.view.scale;
  state.view.y = height / 2 - ((state.bounds.minY + state.bounds.maxY) / 2) * state.view.scale;
  applyTransform();
}

function zoomAt(factor, screenX, screenY) {
  if (!state.model) return;
  const oldScale = state.view.scale;
  const nextScale = Math.max(Math.min(MIN_SCALE, state.fitScale), Math.min(MAX_SCALE, oldScale * factor));
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

// Export coordinates are rounded, so allow a small absolute radius error.
// SVG's positive sweep follows the positive cross product in its y-down axes.
function edgeArcPath(from, to, arc) {
  if (!arc || !Number.isFinite(arc.orbitX) || !Number.isFinite(arc.orbitY)) return null;
  const ax = from.x - arc.orbitX;
  const ay = from.y - arc.orbitY;
  const bx = to.x - arc.orbitX;
  const by = to.y - arc.orbitY;
  const radius = Math.hypot(ax, ay);
  const endRadius = Math.hypot(bx, by);
  const chord = Math.hypot(to.x - from.x, to.y - from.y);
  if (radius === 0 || chord === 0 || chord > 2 * radius || Math.abs(radius - endRadius) > 0.2) return null;
  const sweep = ax * by - ay * bx >= 0 ? 1 : 0;
  return `M ${from.x} ${from.y} A ${radius} ${radius} 0 0 ${sweep} ${to.x} ${to.y}`;
}

function buildGraph(focusNodeId = null) {
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
    // Measure the actual main-tree extent for this model. Ascendancies remain
    // at their exported positions and in the rendered/searchable node set.
    if (node.domain !== 'passive') continue;
    const radius = nodeRadius(node);
    minX = Math.min(minX, node.x - radius);
    minY = Math.min(minY, node.y - radius);
    maxX = Math.max(maxX, node.x + radius);
    maxY = Math.max(maxY, node.y + radius);
  }
  state.bounds = { minX, minY, maxX, maxY };

  const edgeFragment = document.createDocumentFragment();
  for (const [edgeIndex, [fromId, toId]] of state.model.edges.entries()) {
    const from = state.nodeById.get(fromId);
    const to = state.nodeById.get(toId);
    const path = edgeArcPath(from, to, state.model.edgeArcs?.[edgeIndex]);
    const edge = document.createElementNS(SVG_NS, path ? 'path' : 'line');
    edge.setAttribute('class', 'poe2-edge');
    if (path) {
      edge.setAttribute('d', path);
    } else {
      edge.setAttribute('x1', String(from.x));
      edge.setAttribute('y1', String(from.y));
      edge.setAttribute('x2', String(to.x));
      edge.setAttribute('y2', String(to.y));
    }
    edgeFragment.append(edge);
    state.edgeElements.push({ element: edge, fromId, toId });
  }
  elements.edgeLayer.append(edgeFragment);

  // Root and ascendancy membership never change within a model, so those
  // classes are written once here. Selection is delegated to the tree element.
  const nodeFragment = document.createDocumentFragment();
  for (const node of state.model.nodes) {
    const isRoot = state.rootIds.has(node.id);
    const radius = nodeRadius(node);
    const kindClass = { notable: 'is-notable', keystone: 'is-keystone', jewelSocket: 'is-jewel-socket' }[node.kind];
    // At 0.01 zoom, even two largest markers plus their outlines fit inside
    // the 2px gap between neighbours 200 world units apart.
    const screenRadius = isRoot || node.kind === 'keystone' ? 2.25
      : node.kind === 'notable' ? 2 : node.kind === 'jewelSocket' ? 1.8 : 1.5;
    const group = document.createElementNS(SVG_NS, 'g');
    group.setAttribute('class', `poe2-node${kindClass ? ` ${kindClass}` : ''}${isRoot ? ' is-root' : ''}${node.domain === 'ascendancy' ? ' is-ascendancy' : ''}`);
    group.setAttribute('transform', `translate(${node.x} ${node.y})`);
    group.setAttribute('role', 'button');
    group.setAttribute('tabindex', isRoot ? '0' : '-1');
    group.setAttribute('aria-label', `${node.name || `Node ${node.id}`}, ${node.domain} node`);
    group.dataset.nodeId = node.id;

    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('class', 'poe2-node-body');
    circle.setAttribute('r', String(radius));
    group.append(circle);

    // The inner kind outline keeps its colour when state changes recolour
    // the outer circle (including allocated ascendancy must-have nodes).
    let kindRing = null;
    if (kindClass) {
      kindRing = document.createElementNS(SVG_NS, 'circle');
      kindRing.setAttribute('class', 'poe2-node-kind');
      kindRing.setAttribute('r', String(radius * 0.55));
      group.append(kindRing);
    }

    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('y', String(-radius - 14));
    if (isRoot) label.textContent = node.name;
    group.append(label);

    nodeFragment.append(group);
    state.nodeElements.set(node.id, { group, label, circle, kindRing, radius, screenRadius });
  }
  elements.nodeLayer.append(nodeFragment);
  state.renderedScale = null;
  applyTransform();
  updateGraphState();
  requestAnimationFrame(() => {
    fitTree();
    // A whole-tree fit can leave a specific node of interest (e.g. a newly
    // selected ascendancy's start node) far from the viewport center, since
    // ascendancy clusters sit well outside the main tree's bounds. Re-center
    // on that node after the fit settles so it isn't overridden by it.
    if (focusNodeId) centerNode(focusNodeId);
  });
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
  parts.group.classList.toggle('is-must-have', state.mustHaves.has(id));
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
  renderLevelEstimate(totals.passive);
  elements.resetButton.disabled = state.allocated.size === 0;
  renderNetBonuses();
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
    elements.toggleMustHave.textContent = 'Mark must-have';
    elements.toggleMustHave.disabled = true;
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
  const isMustHave = state.mustHaves.has(node.id);
  elements.toggleMustHave.textContent = isRoot ? 'Start node' : isMustHave ? 'Unmark must-have' : 'Mark must-have';
  elements.toggleMustHave.setAttribute('aria-pressed', String(isMustHave));
  elements.toggleMustHave.disabled = isRoot || !state.enabled || state.computing;
}

/**
 * @param {Event} event
 * @returns {string | null | undefined}
 */
function nodeIdFromEvent(event) {
  const group = event.target instanceof Element ? /** @type {SVGElement | null} */ (event.target.closest('[data-node-id]')) : null;
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

/** @param {string} nodeId */
function activateNode(nodeId) {
  selectNode(nodeId);
  if (!state.model || !state.nodeById.has(nodeId) || state.route === null
    || state.computing || state.rootIds.has(nodeId) || state.allocated.has(nodeId)) return;
  const result = findConnection(state.model, [...state.allocated], nodeId);
  if (!result.ok) {
    setStatus(result.reason || 'That node could not be connected to the allocated tree.', true);
    return;
  }
  setAllocation(new Set([...state.allocated, ...result.nodeIds]));
  updateGraphState();
  invalidateRoute();
  setStatus(`${nodeName(nodeId)} allocated with ${plural(result.nodeIds.length - 1, 'connecting node')} added.`);
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
  let next = candidate;
  if (!validation.valid) {
    next = removing ? prunedAllocation(candidate) : null;
    if (!next) {
      setStatus(validation.reason || 'That allocation is not legal.', true);
      return;
    }
  }
  setAllocation(next);
  updateGraphState();
  invalidateRoute();
  const node = state.nodeById.get(nodeId);
  const name = node.name || `Node ${nodeId}`;
  const dependents = candidate.size - next.size;
  if (dependents > 0) {
    setStatus(`${name} removed, along with ${plural(dependents, 'dependent node')} no longer connected to a start.`);
  } else {
    setStatus(`${name} ${removing ? 'removed' : 'allocated'}.`);
  }
}

// The largest legal subset of `remaining`: grow a kept set from empty, adding
// one node the model currently allows at a time, until nothing more can be
// added. Returns null when the result does not validate.
function prunedAllocation(remaining) {
  const kept = new Set();
  for (;;) {
    const available = state.model.availableNodeIds([...kept]);
    let added = false;
    for (const id of remaining) {
      if (!kept.has(id) && available.has(id)) {
        kept.add(id);
        added = true;
        break;
      }
    }
    if (!added) break;
  }
  return state.model.validateAllocation([...kept]).valid ? kept : null;
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
  state.mustHaves = new Set();
  state.route = null;
  renderRouteSummary();
  state.selectedId = nextModel.rootIds[0] || null;
  setEnabled(true);
  elements.retryButton.hidden = true;
  const ascendancyStart = nextAscendancyId
    ? nextModel.nodes.find((node) => node.kind === 'ascendancyStart' && nextModel.rootIds.includes(node.id))
    : null;
  buildGraph(ascendancyStart ? ascendancyStart.id : null);
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
  renderLevelEstimate(null, 'Level estimate unavailable while the tree loads.');
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
      if (state.model) updateGraphState();
      else renderLevelEstimate(null, 'Level estimate unavailable: no build could be created.');
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
    state.mustHaves = new Set();
    state.route = null;
    renderRouteSummary();
    renderNetBonuses();
    setEnabled(false);
    renderLevelEstimate(null, 'Level estimate unavailable: the passive tree could not be loaded.');
    elements.retryButton.hidden = false;
    elements.treePanel.setAttribute('aria-busy', 'false');
    setStatus(error instanceof Error ? error.message : 'The passive tree could not be loaded.', true);
  } finally {
    void refreshSavedBuilds();
  }
}

elements.classSelect.addEventListener('change', () => {
  populateAscendancies('');
  rebuildModel(elements.classSelect.value, null);
});

elements.ascendancySelect.addEventListener('change', () => {
  rebuildModel(elements.classSelect.value, elements.ascendancySelect.value || null);
});

elements.savedBuildForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void saveCurrentBuild(false);
});

elements.saveBuildAsNew.addEventListener('click', () => {
  void saveCurrentBuild(true);
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
elements.toggleMustHave.addEventListener('click', () => {
  if (state.computing || !state.selectedId) return;
  setMustHave(state.selectedId, !state.mustHaves.has(state.selectedId));
});
elements.findRoute.addEventListener('click', computeRoute);
elements.clearMustHaves.addEventListener('click', clearMustHaves);
elements.clearRoute.addEventListener('click', clearRoute);
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
  state.route = null;
  renderRouteSummary();
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

/** @param {PointerEvent} event */
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
    || /** @type {SVGElement | null | undefined} */ (document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-node-id]'))?.dataset.nodeId;
  if (nodeId) activateNode(nodeId);
});

elements.tree.addEventListener('keydown', (event) => {
  if (!state.model) return;
  if (event.target !== elements.tree) {
    // Enter or Space on a focused node follows the same path as a click.
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const nodeId = nodeIdFromEvent(event);
    if (!nodeId) return;
    event.preventDefault();
    activateNode(nodeId);
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
