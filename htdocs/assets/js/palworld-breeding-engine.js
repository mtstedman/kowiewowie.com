/*
 * Palworld breeding route engine.
 *
 * Pure logic only: no DOM, fetch, timers or storage. The file is a classic
 * script that exposes one frozen object as globalThis.PalworldBreeding and,
 * when `module` exists, as module.exports.
 *
 *   buildDataset(db, breeding)      -> Dataset
 *   outcomes(dataset, keyA, keyB)   -> Array<{ child, genderA, genderB }>
 *   findRoute(dataset, request)     -> RouteResult
 *   MAX_TRAITS, EGG_ODDS
 *
 * The breeding lookup is built at runtime from the raw Pal Calc files
 * (palcalc-db.json and palcalc-breeding.json).
 */
(function () {
  'use strict';

  var MAX_TRAITS = 4;

  // Index = number of wanted traits the child must carry. A breed step costs
  // 1 / EGG_ODDS[n] expected eggs.
  var EGG_ODDS = Object.freeze([1, 1, 0.6, 0.3, 0.1]);

  // The search adds costs as whole numbers so that equal totals compare equal
  // whatever order they were summed in. One egg is COST_UNIT units.
  var COST_UNIT = 30;
  var EGG_UNITS = EGG_ODDS.map(function (odds) {
    return Math.round(COST_UNIT / odds);
  });

  var BIT_COUNT = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

  var ANY = 0;
  var MALE = 1;
  var FEMALE = 2;
  var GENDER_NAMES = [null, 'male', 'female'];

  // What the leaves (sources and helpers) of one search state can do for free.
  var LEAF_MALE = 1;    // some leaf can be the male parent
  var LEAF_FEMALE = 2;  // some leaf can be the female parent
  var LEAF_PAIR = 4;    // two different leaves can be paired with each other
  var LEAF_HELPER = 8;  // a helper pal exists for this state

  // How a bred state was made from its two recorded parent states.
  var MODE_A_FEMALE = 0;        // parent A female, parent B male
  var MODE_A_MALE = 1;          // parent A male, parent B female
  var MODE_SELF_LEAVES = 2;     // two different leaves of the same state
  var MODE_SELF_LEAF_BRED = 3;  // one leaf plus a bred copy of the same state
  var MODE_SELF_BRED = 4;       // two bred copies of the same state

  var hasOwn = Object.prototype.hasOwnProperty;

  // ---------------------------------------------------------------------
  // Dataset
  // ---------------------------------------------------------------------

  function tableGender(value, rowNumber) {
    if (value === 'WILDCARD' || value === null || value === undefined) return ANY;
    if (value === 'MALE') return MALE;
    if (value === 'FEMALE') return FEMALE;
    var text = String(value).trim().toLowerCase();
    if (text === 'wildcard' || text === '') return ANY;
    if (text === 'male') return MALE;
    if (text === 'female') return FEMALE;
    throw new Error('Breeding table row ' + rowNumber + ' has an unknown gender "' + String(value) + '".');
  }

  // Picks the child for one gender assignment from the rows of one pair.
  // `rows` is a flat list of (child, genderLow, genderHigh). The most specific
  // matching row wins; among equals the first row wins.
  function resolveOutcome(rows, genderLow, genderHigh) {
    var best = -1;
    var bestSpecific = -1;
    for (var i = 0; i < rows.length; i += 3) {
      var rowLow = rows[i + 1];
      var rowHigh = rows[i + 2];
      if ((rowLow === ANY || rowLow === genderLow) && (rowHigh === ANY || rowHigh === genderHigh)) {
        var specific = (rowLow === ANY ? 0 : 1) + (rowHigh === ANY ? 0 : 1);
        if (specific > bestSpecific) {
          best = rows[i];
          bestSpecific = specific;
        }
      }
    }
    return best;
  }

  function comparePals(a, b) {
    if (a.paldexNo !== b.paldexNo) {
      if (a.paldexNo === null) return 1;
      if (b.paldexNo === null) return -1;
      return a.paldexNo - b.paldexNo;
    }
    if (a.isVariant !== b.isVariant) return a.isVariant ? 1 : -1;
    if (a.key < b.key) return -1;
    if (a.key > b.key) return 1;
    return 0;
  }

  function buildDataset(db, breeding) {
    if (!db || typeof db !== 'object' || !Array.isArray(db.Pals)) {
      throw new Error('The pal database is unusable: expected an object with a "Pals" list.');
    }
    var rows = null;
    if (Array.isArray(breeding)) {
      rows = breeding;
    } else if (breeding && typeof breeding === 'object') {
      rows = breeding.Breeding;
    }
    if (!Array.isArray(rows)) {
      throw new Error('The breeding table is unusable: expected an object with a "Breeding" list.');
    }
    if (rows.length === 0) {
      throw new Error('The breeding table is unusable: it has no rows.');
    }

    var i;
    var row;

    // Pal database entries by lowercase InternalName. The first entry wins.
    var dbByKey = new Map();
    for (i = 0; i < db.Pals.length; i++) {
      var entry = db.Pals[i];
      if (entry && typeof entry === 'object' && typeof entry.InternalName === 'string' && entry.InternalName !== '') {
        var entryKey = entry.InternalName.toLowerCase();
        if (!dbByKey.has(entryKey)) dbByKey.set(entryKey, entry);
      }
    }

    // Pass 1: every pal named in the table, as parent or child.
    var keyByName = new Map();  // InternalName as written -> key
    var nameByKey = new Map();  // key -> first InternalName seen
    function register(name, rowNumber) {
      if (keyByName.has(name)) return;
      if (typeof name !== 'string' || name === '') {
        throw new Error('Breeding table row ' + rowNumber + ' is missing a pal InternalName.');
      }
      var key = name.toLowerCase();
      keyByName.set(name, key);
      if (!nameByKey.has(key)) nameByKey.set(key, name);
    }
    for (i = 0; i < rows.length; i++) {
      row = rows[i];
      if (!row || typeof row !== 'object') {
        throw new Error('Breeding table row ' + (i + 1) + ' is not an object.');
      }
      register(row.Parent1InternalName, i + 1);
      register(row.Parent2InternalName, i + 1);
      register(row.ChildInternalName, i + 1);
    }

    var pals = [];
    var unknownKeys = new Set();
    nameByKey.forEach(function (tableName, key) {
      var found = dbByKey.get(key);
      var pal = {
        index: 0,
        key: key,
        internalName: tableName,
        name: tableName,
        paldexNo: null,
        isVariant: false
      };
      if (found) {
        pal.internalName = found.InternalName;
        pal.name = (typeof found.Name === 'string' && found.Name !== '') ? found.Name : found.InternalName;
        var id = found.Id;
        if (id && typeof id === 'object') {
          if (typeof id.PalDexNo === 'number' && isFinite(id.PalDexNo)) pal.paldexNo = id.PalDexNo;
          pal.isVariant = id.IsVariant === true;
        }
      } else {
        unknownKeys.add(key);
      }
      pals.push(pal);
    });
    pals.sort(comparePals);

    var indexByKey = {};
    var unknownNames = [];
    for (i = 0; i < pals.length; i++) {
      pals[i].index = i;
      indexByKey[pals[i].key] = i;
      if (unknownKeys.has(pals[i].key)) unknownNames.push(pals[i].internalName);
    }
    var indexByName = new Map();
    keyByName.forEach(function (key, name) {
      indexByName.set(name, indexByKey[key]);
    });

    // Pass 2: one cell per unordered pair, at high * (high + 1) / 2 + low.
    //   >= 0  child pal index, whatever the genders
    //   -1    no child
    //   <= -2 gender-dependent; entry (-2 - value) of the gender-outcome list
    var count = pals.length;
    var pairChild = new Int32Array(count * (count + 1) / 2).fill(-1);
    var mixed = new Map();  // pair cell -> { same, rows: flat (child, genderLow, genderHigh) }
    for (i = 0; i < rows.length; i++) {
      row = rows[i];
      var low = indexByName.get(row.Parent1InternalName);
      var high = indexByName.get(row.Parent2InternalName);
      var child = indexByName.get(row.ChildInternalName);
      var genderLow = tableGender(row.Parent1Gender, i + 1);
      var genderHigh = tableGender(row.Parent2Gender, i + 1);
      if (low > high) {
        var swapIndex = low;
        low = high;
        high = swapIndex;
        var swapGender = genderLow;
        genderLow = genderHigh;
        genderHigh = swapGender;
      }
      var cell = high * (high + 1) / 2 + low;
      var pending = mixed.get(cell);
      if (pending) {
        pending.rows.push(child, genderLow, genderHigh);
      } else if (genderLow === ANY && genderHigh === ANY) {
        var current = pairChild[cell];
        if (current === -1) {
          pairChild[cell] = child;
        } else if (current !== child) {
          mixed.set(cell, { same: low === high, rows: [current, ANY, ANY, child, ANY, ANY] });
        }
      } else {
        var existing = pairChild[cell];
        mixed.set(cell, {
          same: low === high,
          rows: existing === -1 ? [child, genderLow, genderHigh] : [existing, ANY, ANY, child, genderLow, genderHigh]
        });
      }
    }

    // Gender-outcome list: two entries per gender-dependent pair, the child
    // when the lower-index parent is male, then the child when it is female.
    var genderList = [];
    mixed.forEach(function (info, cell) {
      var lowMale = resolveOutcome(info.rows, MALE, FEMALE);
      var lowFemale = resolveOutcome(info.rows, FEMALE, MALE);
      if (info.same) {
        pairChild[cell] = lowMale >= 0 ? lowMale : lowFemale;
      } else if (lowMale === lowFemale) {
        pairChild[cell] = lowMale;
      } else {
        pairChild[cell] = -2 - (genderList.length / 2);
        genderList.push(lowMale, lowFemale);
      }
    });

    // A same-species pair with no row breeds the same species.
    for (i = 0; i < count; i++) {
      var selfCell = i * (i + 1) / 2 + i;
      if (pairChild[selfCell] === -1) pairChild[selfCell] = i;
    }

    var dataset = {
      version: (db.Version === null || db.Version === undefined) ? '' : String(db.Version),
      pals: pals,
      indexByKey: indexByKey,
      unknownNames: unknownNames
    };
    // The pair table rides along without being part of the listed data shape.
    Object.defineProperty(dataset, '_pairs', {
      value: Object.freeze({
        size: count,
        child: pairChild,
        gendered: Int32Array.from(genderList)
      }),
      enumerable: false,
      writable: false,
      configurable: false
    });
    return dataset;
  }

  function pairTable(dataset) {
    if (!dataset || typeof dataset !== 'object') return null;
    var table = dataset._pairs;
    if (!table || !Array.isArray(dataset.pals) || table.size !== dataset.pals.length) return null;
    if (!dataset.indexByKey || typeof dataset.indexByKey !== 'object') return null;
    return table;
  }

  function palIndex(dataset, key) {
    if (typeof key !== 'string' || !hasOwn.call(dataset.indexByKey, key)) return -1;
    var index = dataset.indexByKey[key];
    if (typeof index !== 'number' || index < 0 || index >= dataset.pals.length || index !== Math.floor(index)) return -1;
    return index;
  }

  function outcomes(dataset, keyA, keyB) {
    var table = pairTable(dataset);
    if (!table) {
      throw new Error('outcomes() needs a dataset created by buildDataset().');
    }
    var a = palIndex(dataset, keyA);
    var b = palIndex(dataset, keyB);
    if (a < 0 || b < 0) return [];
    var pals = dataset.pals;
    var value = a <= b ? table.child[b * (b + 1) / 2 + a] : table.child[a * (a + 1) / 2 + b];
    if (value === -1) return [];
    if (value >= 0) {
      return [{ child: pals[value].key, genderA: null, genderB: null }];
    }
    var at = (-2 - value) * 2;
    var lowMale = table.gendered[at];
    var lowFemale = table.gendered[at + 1];
    var aIsLow = a < b;
    var list = [];
    if (lowMale >= 0) {
      list.push({
        child: pals[lowMale].key,
        genderA: aIsLow ? 'male' : 'female',
        genderB: aIsLow ? 'female' : 'male'
      });
    }
    if (lowFemale >= 0) {
      list.push({
        child: pals[lowFemale].key,
        genderA: aIsLow ? 'female' : 'male',
        genderB: aIsLow ? 'male' : 'female'
      });
    }
    return list;
  }

  // ---------------------------------------------------------------------
  // Route request
  // ---------------------------------------------------------------------

  function fail(reason, message) {
    return { ok: false, reason: reason, message: message };
  }

  function invalid(message) {
    return fail('invalid-request', message);
  }

  function show(value) {
    return typeof value === 'string' ? value : String(value);
  }

  // Returns the checked request, or a failed RouteResult (ok === false).
  function parseRequest(dataset, request) {
    if (!request || typeof request !== 'object') {
      return invalid('The request must be an object.');
    }

    var target = palIndex(dataset, request.target);
    if (target < 0) {
      return invalid('Unknown target pal "' + show(request.target) + '".');
    }

    var traits = request.traits;
    if (!Array.isArray(traits) || traits.length === 0) {
      return invalid('Choose at least one wanted trait.');
    }
    if (traits.length > MAX_TRAITS) {
      return invalid('Choose at most ' + MAX_TRAITS + ' wanted traits.');
    }
    var bitByTrait = new Map();
    var i;
    for (i = 0; i < traits.length; i++) {
      var label = traits[i];
      if (typeof label !== 'string' || label === '') {
        return invalid('Every wanted trait needs a text label.');
      }
      if (bitByTrait.has(label)) {
        return invalid('The trait "' + label + '" is listed more than once.');
      }
      bitByTrait.set(label, 1 << i);
    }

    var sourcesIn = request.sources;
    if (!Array.isArray(sourcesIn)) {
      return invalid('The request needs a list of source pals.');
    }
    var sources = [];
    var carried = 0;
    for (i = 0; i < sourcesIn.length; i++) {
      var given = sourcesIn[i];
      var place = 'Source pal ' + (i + 1);
      if (!given || typeof given !== 'object') {
        return invalid(place + ' must be an object.');
      }
      var id = given.id;
      if (typeof id === 'number' && isFinite(id)) id = String(id);
      if (typeof id !== 'string') {
        return invalid(place + ' needs a text id.');
      }
      var pal = palIndex(dataset, given.pal);
      if (pal < 0) {
        return invalid(place + ' uses the unknown pal "' + show(given.pal) + '".');
      }
      var mask = 0;
      var sourceTraits = given.traits;
      if (sourceTraits !== undefined && sourceTraits !== null) {
        if (!Array.isArray(sourceTraits)) {
          return invalid(place + ' needs its traits as a list.');
        }
        for (var t = 0; t < sourceTraits.length; t++) {
          if (!bitByTrait.has(sourceTraits[t])) {
            return invalid(place + ' has the trait "' + show(sourceTraits[t]) + '", which is not one of the wanted traits.');
          }
          mask |= bitByTrait.get(sourceTraits[t]);
        }
      }
      var gender = ANY;
      if (given.gender !== null && given.gender !== undefined) {
        var genderText = typeof given.gender === 'string' ? given.gender.trim().toLowerCase() : '';
        if (genderText === 'male') {
          gender = MALE;
        } else if (genderText === 'female') {
          gender = FEMALE;
        } else {
          return invalid(place + ' has an unknown gender "' + show(given.gender) + '".');
        }
      }
      carried |= mask;
      sources.push({ id: id, pal: pal, mask: mask, gender: gender });
    }

    var fullMask = (1 << traits.length) - 1;
    if (carried !== fullMask) {
      var missing = [];
      for (i = 0; i < traits.length; i++) {
        if (!(carried & (1 << i))) missing.push('"' + traits[i] + '"');
      }
      return invalid('No source pal carries ' + missing.join(', ') + '. Every wanted trait must be on at least one source pal.');
    }

    var excluded = new Uint8Array(dataset.pals.length);
    var excludedIn = request.excluded;
    if (excludedIn !== undefined && excludedIn !== null) {
      if (!Array.isArray(excludedIn)) {
        return invalid('The excluded pals must be a list.');
      }
      for (i = 0; i < excludedIn.length; i++) {
        var excludedIndex = palIndex(dataset, excludedIn[i]);
        if (excludedIndex >= 0) excluded[excludedIndex] = 1;
      }
    }

    return {
      target: target,
      traits: traits.slice(),
      sources: sources,
      excluded: excluded
    };
  }

  // ---------------------------------------------------------------------
  // Route search
  // ---------------------------------------------------------------------

  /*
   * A search state is (species, set of wanted traits), numbered
   * species * 2^traits + mask. A state can be filled by a leaf (a source pal,
   * or a helper for a traitless state of a species that is not excluded) at
   * no cost, or by a bred pal.
   *
   * Breeding two states is a hyperedge whose cost is the sum of its two
   * parents plus the eggs for the child, so the cheapest tree for every state
   * comes from a shortest-hyperpath pass (Knuth's generalisation of
   * Dijkstra): states are settled in order of cost and each newly settled
   * state is combined with everything settled before it.
   *
   * Gender is tracked as a role cost per state. A leaf with a fixed gender
   * fills only that role for free; the other role needs a bred pal, which can
   * be either gender. Helpers and bred pals fill both roles.
   */
  function findRoute(dataset, request) {
    var table = pairTable(dataset);
    if (!table) {
      return invalid('The breeding data is missing or was not created by buildDataset().');
    }
    var parsed = parseRequest(dataset, request);
    if (parsed.ok === false) return parsed;

    var pals = dataset.pals;
    var pairChild = table.child;
    var gendered = table.gendered;
    var palCount = table.size;
    var traits = parsed.traits;
    var sources = parsed.sources;
    var bits = traits.length;
    var maskCount = 1 << bits;
    var fullMask = maskCount - 1;
    var stateCount = palCount * maskCount;
    var targetState = (parsed.target << bits) | fullMask;
    var i;
    var state;
    var flags;

    function traitsOf(mask) {
      var list = [];
      for (var bit = 0; bit < bits; bit++) {
        if (mask & (1 << bit)) list.push(traits[bit]);
      }
      return list;
    }

    function sourceNode(source) {
      return {
        type: 'source',
        sourceId: source.id,
        pal: pals[source.pal].key,
        traits: traitsOf(source.mask),
        gender: GENDER_NAMES[source.gender]
      };
    }

    // A source that already is the target with every wanted trait.
    for (i = 0; i < sources.length; i++) {
      if (((sources[i].pal << bits) | sources[i].mask) === targetState) {
        return { ok: true, totalEggs: 0, stepCount: 0, root: sourceNode(sources[i]) };
      }
    }

    // ---- leaves -------------------------------------------------------

    var leaf = new Uint8Array(stateCount);
    for (i = 0; i < palCount; i++) {
      if (!parsed.excluded[i]) {
        leaf[i << bits] = LEAF_MALE | LEAF_FEMALE | LEAF_PAIR | LEAF_HELPER;
      }
    }
    var sourcesByState = new Map();
    for (i = 0; i < sources.length; i++) {
      state = (sources[i].pal << bits) | sources[i].mask;
      var bucket = sourcesByState.get(state);
      if (bucket) {
        bucket.push(sources[i]);
      } else {
        sourcesByState.set(state, [sources[i]]);
      }
    }
    sourcesByState.forEach(function (list, key) {
      var canMale = 0;
      var canFemale = 0;
      for (var s = 0; s < list.length; s++) {
        if (list[s].gender !== FEMALE) canMale++;
        if (list[s].gender !== MALE) canFemale++;
      }
      var value = leaf[key];
      if (canMale > 0) value |= LEAF_MALE;
      if (canFemale > 0) value |= LEAF_FEMALE;
      // One source cannot be both parents, so a pair needs two of them.
      if (canMale > 0 && canFemale > 0 && list.length >= 2) value |= LEAF_PAIR;
      leaf[key] = value;
    });

    // ---- search state -------------------------------------------------

    var INF = Infinity;
    var bredEggs = new Float64Array(stateCount).fill(INF);  // cost units
    var bredSteps = new Float64Array(stateCount);
    var parentA = new Int32Array(stateCount);
    var parentB = new Int32Array(stateCount);
    var parentMode = new Uint8Array(stateCount);
    var settled = new Uint8Array(stateCount);

    // Cost of using a state as the male or female parent, once known.
    var maleEggs = new Float64Array(stateCount).fill(INF);
    var maleSteps = new Float64Array(stateCount);
    var femaleEggs = new Float64Array(stateCount).fill(INF);
    var femaleSteps = new Float64Array(stateCount);

    var active = new Int32Array(stateCount);
    var activeCount = 0;
    var isActive = new Uint8Array(stateCount);

    // Binary heap ordered by eggs, then steps, then state number.
    var heapState = [];
    var heapEggs = [];
    var heapSteps = [];
    var topState = 0;
    var topEggs = 0;
    var topSteps = 0;

    function heapLess(a, b) {
      if (heapEggs[a] !== heapEggs[b]) return heapEggs[a] < heapEggs[b];
      if (heapSteps[a] !== heapSteps[b]) return heapSteps[a] < heapSteps[b];
      return heapState[a] < heapState[b];
    }

    function heapSwap(a, b) {
      var s = heapState[a];
      heapState[a] = heapState[b];
      heapState[b] = s;
      var e = heapEggs[a];
      heapEggs[a] = heapEggs[b];
      heapEggs[b] = e;
      var t = heapSteps[a];
      heapSteps[a] = heapSteps[b];
      heapSteps[b] = t;
    }

    function heapPush(pushState, eggs, steps) {
      var at = heapState.length;
      heapState.push(pushState);
      heapEggs.push(eggs);
      heapSteps.push(steps);
      while (at > 0) {
        var parent = (at - 1) >> 1;
        if (!heapLess(at, parent)) break;
        heapSwap(at, parent);
        at = parent;
      }
    }

    function heapPop() {
      var last = heapState.length - 1;
      topState = heapState[0];
      topEggs = heapEggs[0];
      topSteps = heapSteps[0];
      var s = heapState.pop();
      var e = heapEggs.pop();
      var t = heapSteps.pop();
      if (last > 0) {
        heapState[0] = s;
        heapEggs[0] = e;
        heapSteps[0] = t;
        var at = 0;
        for (;;) {
          var left = 2 * at + 1;
          var right = left + 1;
          var least = at;
          if (left < last && heapLess(left, least)) least = left;
          if (right < last && heapLess(right, least)) least = right;
          if (least === at) break;
          heapSwap(at, least);
          at = least;
        }
      }
    }

    // Offers one way to breed `child`. a <= b are the parent states. Lower
    // eggs win, then fewer steps, then lower parent states (lower pal index).
    function offer(child, eggs, steps, a, b, mode) {
      if (settled[child]) return;
      // A bred copy is never needed where leaves already fill every role.
      if ((leaf[child] & 7) === 7) return;
      if (child !== targetState) {
        // Anything that already costs as much as a known route to the target
        // cannot be part of a better one.
        var bound = bredEggs[targetState];
        if (eggs > bound || (eggs === bound && steps >= bredSteps[targetState])) return;
      }
      var currentEggs = bredEggs[child];
      if (eggs > currentEggs) return;
      if (eggs === currentEggs) {
        var currentSteps = bredSteps[child];
        if (steps > currentSteps) return;
        if (steps === currentSteps) {
          var currentA = parentA[child];
          if (a > currentA) return;
          if (a === currentA) {
            var currentB = parentB[child];
            if (b > currentB) return;
            if (b === currentB && mode >= parentMode[child]) return;
          }
          parentA[child] = a;
          parentB[child] = b;
          parentMode[child] = mode;
          return;
        }
      }
      bredEggs[child] = eggs;
      bredSteps[child] = steps;
      parentA[child] = a;
      parentB[child] = b;
      parentMode[child] = mode;
      heapPush(child, eggs, steps);
    }

    // Pairs state `x`, newly usable as male and/or female at the given cost,
    // with every state that is already usable.
    function expand(x, eggs, steps, asMale, asFemale) {
      var speciesX = x >> bits;
      var maskX = x & fullMask;
      var rowX = speciesX * (speciesX + 1) / 2;
      for (var n = 0; n < activeCount; n++) {
        var y = active[n];
        if (y === x) continue;
        var speciesY = y >> bits;
        var value;
        var xIsLow;
        if (speciesY <= speciesX) {
          value = pairChild[rowX + speciesY];
          xIsLow = false;
        } else {
          value = pairChild[speciesY * (speciesY + 1) / 2 + speciesX];
          xIsLow = true;
        }
        if (value === -1) continue;
        var childIfMale;    // child species when x is the male parent
        var childIfFemale;  // child species when x is the female parent
        if (value >= 0) {
          childIfMale = value;
          childIfFemale = value;
        } else {
          var at = (-2 - value) * 2;
          if (xIsLow) {
            childIfMale = gendered[at];
            childIfFemale = gendered[at + 1];
          } else {
            childIfMale = gendered[at + 1];
            childIfFemale = gendered[at];
          }
        }
        var mask = maskX | (y & fullMask);
        var weight = EGG_UNITS[BIT_COUNT[mask]];
        var xFirst = x < y;
        var a = xFirst ? x : y;
        var b = xFirst ? y : x;
        if (asMale && childIfMale >= 0) {
          var otherFemale = femaleEggs[y];
          if (otherFemale !== INF) {
            offer((childIfMale << bits) | mask, eggs + otherFemale + weight, steps + femaleSteps[y] + 1,
              a, b, xFirst ? MODE_A_MALE : MODE_A_FEMALE);
          }
        }
        if (asFemale && childIfFemale >= 0) {
          var otherMale = maleEggs[y];
          if (otherMale !== INF) {
            offer((childIfFemale << bits) | mask, eggs + otherMale + weight, steps + maleSteps[y] + 1,
              a, b, xFirst ? MODE_A_FEMALE : MODE_A_MALE);
          }
        }
      }
    }

    function activate(x) {
      if (!isActive[x]) {
        isActive[x] = 1;
        active[activeCount++] = x;
      }
    }

    // Child species of two pals of the same species.
    function selfChildOf(species) {
      return pairChild[species * (species + 1) / 2 + species];
    }

    // ---- leaves first (cost 0), then bred states in order of cost -------

    var species;
    var selfChild;
    var mask;
    for (state = 0; state < stateCount; state++) {
      flags = leaf[state];
      if (!(flags & (LEAF_MALE | LEAF_FEMALE))) continue;
      expand(state, 0, 0, (flags & LEAF_MALE) !== 0, (flags & LEAF_FEMALE) !== 0);
      if (flags & LEAF_MALE) {
        maleEggs[state] = 0;
        maleSteps[state] = 0;
      }
      if (flags & LEAF_FEMALE) {
        femaleEggs[state] = 0;
        femaleSteps[state] = 0;
      }
      activate(state);
      if (flags & LEAF_PAIR) {
        species = state >> bits;
        selfChild = selfChildOf(species);
        if (selfChild >= 0 && selfChild !== species) {
          mask = state & fullMask;
          offer((selfChild << bits) | mask, EGG_UNITS[BIT_COUNT[mask]], 1, state, state, MODE_SELF_LEAVES);
        }
      }
    }

    while (heapState.length > 0) {
      heapPop();
      state = topState;
      if (settled[state] || topEggs !== bredEggs[state] || topSteps !== bredSteps[state]) continue;
      settled[state] = 1;
      if (state === targetState) break;

      flags = leaf[state];
      var newMale = !(flags & LEAF_MALE);
      var newFemale = !(flags & LEAF_FEMALE);
      if (newMale || newFemale) {
        expand(state, topEggs, topSteps, newMale, newFemale);
        if (newMale) {
          maleEggs[state] = topEggs;
          maleSteps[state] = topSteps;
        }
        if (newFemale) {
          femaleEggs[state] = topEggs;
          femaleSteps[state] = topSteps;
        }
        activate(state);
      }

      // Pairing the state with itself needs a second pal of that state.
      if (!(flags & LEAF_PAIR)) {
        species = state >> bits;
        selfChild = selfChildOf(species);
        if (selfChild >= 0 && selfChild !== species) {
          mask = state & fullMask;
          var weight = EGG_UNITS[BIT_COUNT[mask]];
          var selfState = (selfChild << bits) | mask;
          if (flags & (LEAF_MALE | LEAF_FEMALE)) {
            offer(selfState, topEggs + weight, topSteps + 1, state, state, MODE_SELF_LEAF_BRED);
          } else {
            offer(selfState, 2 * topEggs + weight, 2 * topSteps + 1, state, state, MODE_SELF_BRED);
          }
        }
      }
    }

    if (!settled[targetState]) {
      return fail('no-route', 'No breeding route produces ' + pals[parsed.target].name +
        ' with every wanted trait from these source pals and the allowed helper pals.');
    }

    // ---- rebuild the tree ----------------------------------------------

    var HELPER = {};

    // The leaf that fills `role` for a state: a source of that fixed gender,
    // then a source of unknown gender, then a helper. `skip` is a source
    // already used as the other parent.
    function pickLeaf(leafState, role, skip) {
      var list = sourcesByState.get(leafState);
      var s;
      if (list) {
        for (s = 0; s < list.length; s++) {
          if (list[s] !== skip && list[s].gender === role) return list[s];
        }
        for (s = 0; s < list.length; s++) {
          if (list[s] !== skip && list[s].gender === ANY) return list[s];
        }
      }
      if (leaf[leafState] & LEAF_HELPER) return HELPER;
      return null;
    }

    function leafNode(choice, leafState) {
      if (choice === HELPER) {
        return { type: 'helper', pal: pals[leafState >> bits].key };
      }
      return sourceNode(choice);
    }

    function roleNode(roleState, role) {
      if (leaf[roleState] & role) {
        return leafNode(pickLeaf(roleState, role, null), roleState);
      }
      return breedNode(roleState);
    }

    function breedNode(bredState) {
      var a = parentA[bredState];
      var b = parentB[bredState];
      var mode = parentMode[bredState];
      var nodeA;
      var nodeB;
      var genders = [null, null];
      if (mode === MODE_A_MALE || mode === MODE_A_FEMALE) {
        var roleA = mode === MODE_A_MALE ? MALE : FEMALE;
        var roleB = mode === MODE_A_MALE ? FEMALE : MALE;
        nodeA = roleNode(a, roleA);
        nodeB = roleNode(b, roleB);
        var speciesA = a >> bits;
        var speciesB = b >> bits;
        var value = speciesA <= speciesB
          ? pairChild[speciesB * (speciesB + 1) / 2 + speciesA]
          : pairChild[speciesA * (speciesA + 1) / 2 + speciesB];
        if (value < -1) {
          genders = [GENDER_NAMES[roleA], GENDER_NAMES[roleB]];
        }
      } else if (mode === MODE_SELF_LEAVES) {
        var maleLeaf = pickLeaf(a, MALE, null);
        var femaleLeaf = pickLeaf(a, FEMALE, maleLeaf === HELPER ? null : maleLeaf);
        nodeA = leafNode(maleLeaf, a);
        nodeB = leafNode(femaleLeaf, a);
      } else if (mode === MODE_SELF_LEAF_BRED) {
        var anyRole = (leaf[a] & LEAF_MALE) ? MALE : FEMALE;
        nodeA = leafNode(pickLeaf(a, anyRole, null), a);
        nodeB = breedNode(a);
      } else {
        nodeA = breedNode(a);
        nodeB = breedNode(a);
      }
      var nodeTraits = traitsOf(bredState & fullMask);
      return {
        type: 'breed',
        pal: pals[bredState >> bits].key,
        traits: nodeTraits,
        expectedEggs: 1 / EGG_ODDS[nodeTraits.length],
        parents: [nodeA, nodeB],
        parentGenders: genders
      };
    }

    var stepCount = 0;
    function sumEggs(node) {
      if (node.type !== 'breed') return 0;
      stepCount++;
      return node.expectedEggs + sumEggs(node.parents[0]) + sumEggs(node.parents[1]);
    }

    var root = breedNode(targetState);
    var totalEggs = sumEggs(root);
    return { ok: true, totalEggs: totalEggs, stepCount: stepCount, root: root };
  }

  // ---------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------

  var api = Object.freeze({
    MAX_TRAITS: MAX_TRAITS,
    EGG_ODDS: EGG_ODDS,
    buildDataset: buildDataset,
    outcomes: outcomes,
    findRoute: findRoute
  });

  if (typeof globalThis !== 'undefined') {
    globalThis.PalworldBreeding = api;
  }
  if (typeof module !== 'undefined' && module && typeof module === 'object') {
    module.exports = api;
  }
})();
