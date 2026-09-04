import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const [nginxConfig, lobbyPhp, gamePhp] = await Promise.all([
    read('deploy/nginx/wowiekowie.com.conf'),
    read('htdocs/chess/index.php'),
    read('htdocs/chess/game.php'),
]);

const expectedCsp = "default-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'; img-src 'self' data: https://cards.scryfall.io; object-src 'none'";
assert.ok(nginxConfig.includes(`Content-Security-Policy "${expectedCsp}"`), 'nginx CSP keeps the same-origin no-inline boundary');
assert.equal(nginxConfig.includes("'unsafe-inline'"), false, 'nginx CSP does not allow inline script execution');

const chessPages = [
    ['lobby', lobbyPhp],
    ['game', gamePhp],
];

for (const [name, source] of chessPages) {
    const scripts = [...source.matchAll(/<script\b[^>]*>/gi)].map((match) => match[0]);
    assert.ok(scripts.length > 0, `${name} page registers an external script`);

    for (const script of scripts) {
        assert.match(script, /\ssrc="\/assets\/js\/chess-(?:index|game)\.js\?v=/, `${name} script is same-origin external chess JavaScript`);
        assert.doesNotMatch(script, />\s*[^<]/, `${name} script tag has no inline body`);
    }

    assert.doesNotMatch(source, /<script\b(?![^>]*\ssrc=)[^>]*>/i, `${name} page has no inline script blocks`);
    assert.doesNotMatch(source, /\sonerror\s*=/i, `${name} page has no inline onerror handler`);
    assert.doesNotMatch(source, /\son[a-z]+\s*=/i, `${name} page has no inline event handler attributes`);
    assert.doesNotMatch(source, /javascript:/i, `${name} page has no javascript: URLs`);
}
