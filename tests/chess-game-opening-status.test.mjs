import assert from 'node:assert/strict';

import { formatOpening } from '../htdocs/assets/js/chess-game.js';

const cases = [
    {
        description: 'named opening',
        opening: {
            on_book: true,
            eco_code: 'C20',
            name: "King's Pawn Game",
        },
        expected: {
            label: "[C20] King's Pawn Game",
            onBook: true,
        },
    },
    {
        description: 'unnamed on-book position',
        opening: {
            on_book: true,
            eco_code: '',
            name: '',
        },
        expected: {
            label: 'On book',
            onBook: true,
        },
    },
    {
        description: 'unnamed on-book position after a named opening',
        opening: {
            on_book: true,
            eco_code: 'C20',
            name: '',
        },
        expected: {
            label: '[C20]',
            onBook: true,
        },
    },
    {
        description: 'off-book position hides the opening badge',
        opening: {
            on_book: false,
            eco_code: 'C20',
            name: "King's Pawn Game",
        },
        expected: {
            label: '',
            onBook: false,
        },
    },
];

for (const { description, opening, expected } of cases) {
    const actual = formatOpening(opening);

    assert.equal(actual.label, expected.label, `${description} label`);
    assert.equal(actual.onBook, expected.onBook, `${description} on-book classification`);
}
