import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const [lobbyPhp, gamePhp, strategoCss] = await Promise.all([
    read('htdocs/stratego/index.php'),
    read('htdocs/stratego/game.php'),
    read('htdocs/assets/css/stratego.css'),
]);

const strategoPages = [
    ['lobby', lobbyPhp, 'stratego-index'],
    ['game', gamePhp, 'stratego-game'],
];

for (const [name, source, moduleName] of strategoPages) {
    assert.match(source, /\$pageTitle\s*=/, `${name} page sets $pageTitle`);
    assert.match(source, /\$metaDescription\s*=/, `${name} page sets $metaDescription`);
    assert.ok(source.includes("$pageStyles = ['/assets/css/stratego.css'];"), `${name} page loads the Stratego stylesheet`);
    for (const partial of ['head.php', 'header.php', 'footer.php']) {
        assert.ok(source.includes(`/partials/${partial}`), `${name} page includes partials/${partial}`);
    }

    // Quoted attribute values may contain PHP (`?>`), so treat them as opaque.
    const scripts = [...source.matchAll(/<script\b(?:[^>"]|"[^"]*")*>/gi)].map((match) => match[0]);
    assert.equal(scripts.length, 1, `${name} page registers exactly one script`);

    const [script] = scripts;
    assert.match(script, /\stype="module"/, `${name} script is an ES module`);
    assert.match(
        script,
        new RegExp(`\\ssrc="/assets/js/${moduleName}\\.js\\?v=<\\?= @filemtime\\(dirname\\(__DIR__\\) \\. '/assets/js/${moduleName}\\.js'\\) \\?: time\\(\\) \\?>"`),
        `${name} script is same-origin ${moduleName}.js with a filemtime cache-buster`,
    );
    assert.match(source, /<script\b(?:[^>"]|"[^"]*")*><\/script>/i, `${name} script tag has no inline body`);

    assert.doesNotMatch(source, /<script\b(?![^>]*\ssrc=)[^>]*>/i, `${name} page has no inline script blocks`);
    assert.doesNotMatch(source, /\son[a-z]+\s*=/i, `${name} page has no inline event handler attributes`);
    assert.doesNotMatch(source, /javascript:/i, `${name} page has no javascript: URLs`);
    assert.doesNotMatch(source, /\sstyle\s*=/i, `${name} page has no inline style attributes`);
    assert.doesNotMatch(source, /<style\b/i, `${name} page has no inline style blocks`);
}

assert.ok(lobbyPhp.includes('id="stratego-new-game-form"'), 'lobby has the new game form');
for (const color of ['red', 'blue', 'random']) {
    assert.ok(lobbyPhp.includes(`<option value="${color}"`), `lobby offers the ${color} creator color`);
}
assert.ok(lobbyPhp.includes('id="stratego-copy-invite-button"'), 'lobby has a copy invite button');
assert.match(gamePhp, /id="stratego-board"[^>]*role="grid"/, 'game page renders the board inside role="grid"');

const { PIECES, HIDDEN_ART } = await import(new URL('../htdocs/assets/js/stratego-pieces.js', import.meta.url).href);

const expectedArmy = {
    10: ['Marshal', 1, 'marshal'],
    9: ['General', 1, 'general'],
    8: ['Colonel', 2, 'colonel'],
    7: ['Major', 3, 'major'],
    6: ['Captain', 4, 'captain'],
    5: ['Lieutenant', 4, 'lieutenant'],
    4: ['Sergeant', 4, 'sergeant'],
    3: ['Miner', 5, 'miner'],
    2: ['Scout', 8, 'scout'],
    1: ['Spy', 1, 'spy'],
    B: ['Bomb', 6, 'bomb'],
    F: ['Flag', 1, 'flag'],
};

const ranks = Object.keys(PIECES);
assert.equal(ranks.length, 12, 'stratego-pieces.js lists exactly 12 ranks');
assert.deepEqual([...ranks].sort(), Object.keys(expectedArmy).sort(), 'stratego-pieces.js uses the contract rank codes');

const total = ranks.reduce((sum, rank) => sum + PIECES[rank].count, 0);
assert.equal(total, 40, 'piece counts sum to a 40-piece army');

for (const [rank, [name, count, file]] of Object.entries(expectedArmy)) {
    const piece = PIECES[rank];
    assert.equal(piece.name, name, `rank ${rank} is the ${name}`);
    assert.equal(piece.count, count, `rank ${rank} has ${count} pieces`);
    assert.equal(piece.art, `/assets/img/stratego/${file}.png`, `rank ${rank} art path follows the contract`);
    assert.match(piece.art, /^\/assets\/img\/stratego\/[a-z]+\.png$/, `rank ${rank} art lives under /assets/img/stratego/`);
}

assert.equal(HIDDEN_ART, '/assets/img/stratego/hidden.png', 'hidden piece art follows the contract');

assert.match(strategoCss, /\.piece--red\b/, 'stylesheet styles red team pieces');
assert.match(strategoCss, /\.piece--blue\b/, 'stylesheet styles blue team pieces');

console.log('stratego static checks passed');
