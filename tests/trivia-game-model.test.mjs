import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import {
    answerPayloadForSelection,
    choicesForRound,
    correctAnswersForRound,
    minigameType,
    phasePresentation,
    racePositionMap,
    savedSelection,
    selectionMode,
    viewerCanAnswer,
} from '../htdocs/assets/js/trivia-game-model.js';

const roundId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const baseRoom = {
    status: 'active',
    phase: 'trivia',
    viewer: { can_answer_round: true },
    round: {
        id: roundId,
        status: 'answering',
        round_type: 'trivia',
        answer_shape: { type: 'single_choice' },
        prompt: { question: 'Question?', choices: ['One', 'Two', 'Three', 'Four'] },
        viewer_eligible: true,
        viewer_answer: { answered: false, answer_payload: {} },
    },
};

assert.equal(selectionMode(baseRoom), 'single');
assert.deepEqual(choicesForRound(baseRoom), ['One', 'Two', 'Three', 'Four']);
assert.equal(viewerCanAnswer(baseRoom), true);
assert.deepEqual(
    answerPayloadForSelection(baseRoom, ['Two'], 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
    {
        answer: 'Two',
        answer_payload: { answer: 'Two' },
        client_answer_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    },
);

const memoryRoom = {
    ...baseRoom,
    phase: 'killing_floor',
    round: {
        ...baseRoom.round,
        round_type: 'killing_floor',
        answer_shape: { type: 'multi_select' },
        minigame: {
            type: 'memory_match',
            payload: { choices: ['Candle', 'Mirror', 'Bell', 'Mask'] },
            preview: ['Candle', 'Bell'],
        },
    },
};
assert.equal(selectionMode(memoryRoom), 'multiple');
assert.deepEqual(choicesForRound(memoryRoom), ['Candle', 'Mirror', 'Bell', 'Mask']);
assert.deepEqual(answerPayloadForSelection(memoryRoom, ['Candle', 'Bell'], 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'), {
    selected: ['Candle', 'Bell'],
    answer_payload: { selected: ['Candle', 'Bell'] },
    client_answer_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
});
assert.equal(minigameType(memoryRoom), 'memory_match');
assert.equal(phasePresentation(memoryRoom).key, 'memory_match');
assert.equal(phasePresentation(memoryRoom).image, '/assets/img/trivia/killing-floor-memory.png');
assert.deepEqual(correctAnswersForRound({
    ...memoryRoom,
    round: {
        ...memoryRoom.round,
        status: 'resolved',
        minigame: {
            ...memoryRoom.round.minigame,
            payload: { ...memoryRoom.round.minigame.payload, correct_choices: ['Candle', 'Bell'] },
        },
    },
}), ['Candle', 'Bell']);

for (const { type, choices, correct, image } of [
    { type: 'key_lock', choices: ['Rusty Key', 'Silver Key'], correct: 'Silver Key', image: 'killing-floor-keys.png' },
    { type: 'poison_chalices', choices: ['Green Chalice', 'Gold Chalice'], correct: 'Gold Chalice', image: 'killing-floor-chalices.png' },
    { type: 'sword_boxes', choices: ['Iron Box', 'Oak Box'], correct: 'Oak Box', image: 'killing-floor-sword-boxes.png' },
]) {
    const room = {
        ...baseRoom,
        phase: 'killing_floor',
        round: {
            ...baseRoom.round,
            round_type: 'killing_floor',
            minigame: { type, payload: { choices, correct_key: correct } },
        },
    };
    assert.equal(minigameType(room), type);
    assert.equal(selectionMode(room), 'single');
    assert.deepEqual(choicesForRound(room), choices);
    assert.deepEqual(answerPayloadForSelection(room, [correct], 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'), {
        answer: correct,
        answer_payload: { answer: correct },
        client_answer_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    });
    assert.equal(phasePresentation(room).key, type);
    assert.equal(phasePresentation(room).image, `/assets/img/trivia/${image}`);
    assert.deepEqual(correctAnswersForRound({
        ...room,
        round: { ...room.round, status: 'resolved' },
    }), [correct]);
}

const cryptRunesRoom = {
    ...baseRoom,
    phase: 'killing_floor',
    round: {
        ...baseRoom.round,
        round_type: 'killing_floor',
        answer_shape: { type: 'multi_select' },
        minigame: {
            type: 'crypt_runes',
            payload: {
                choices: ['Moon Rune', 'Sun Rune', 'Star Rune', 'Skull Rune'],
                correct_choices: ['Moon Rune', 'Star Rune'],
            },
        },
    },
};
assert.equal(minigameType(cryptRunesRoom), 'crypt_runes');
assert.equal(selectionMode(cryptRunesRoom), 'multiple');
assert.deepEqual(choicesForRound(cryptRunesRoom), ['Moon Rune', 'Sun Rune', 'Star Rune', 'Skull Rune']);
assert.deepEqual(answerPayloadForSelection(cryptRunesRoom, ['Moon Rune', 'Star Rune'], 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'), {
    selected: ['Moon Rune', 'Star Rune'],
    answer_payload: { selected: ['Moon Rune', 'Star Rune'] },
    client_answer_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
});
assert.equal(phasePresentation(cryptRunesRoom).key, 'crypt_runes');
assert.equal(phasePresentation(cryptRunesRoom).image, '/assets/img/trivia/killing-floor-crypt-runes.png');
assert.deepEqual(correctAnswersForRound({
    ...cryptRunesRoom,
    round: { ...cryptRunesRoom.round, status: 'resolved' },
}), ['Moon Rune', 'Star Rune']);

const raceRoom = {
    ...baseRoom,
    phase: 'ghost_race',
    race_state: { positions: { body: 5, ghost: 3 } },
    viewer: { is_ghost: true, can_answer_round: true },
    round: {
        ...baseRoom.round,
        round_type: 'ghost_race',
        answer_shape: { type: 'multi_select' },
        prompt: { question: 'Pick primes', choices: ['2', '4', '5', '9'] },
    },
};
assert.equal(selectionMode(raceRoom), 'multiple');
assert.equal(viewerCanAnswer(raceRoom), true, 'eligible ghosts can answer race rounds');
assert.deepEqual(racePositionMap(raceRoom), { body: 5, ghost: 3 });
assert.deepEqual(correctAnswersForRound(raceRoom), [], 'unresolved race answers stay hidden');

const resolvedRace = {
    ...raceRoom,
    round: {
        ...raceRoom.round,
        status: 'resolved',
        prompt_payload: {
            items: [
                { label: '2', correct: true },
                { label: '4', correct: false },
                { label: '5', correct: true },
            ],
        },
        viewer_answer: { answered: true, answer_payload: { selected: ['2', '5'] } },
    },
};
assert.deepEqual(correctAnswersForRound(resolvedRace), ['2', '5']);
assert.deepEqual(savedSelection(resolvedRace), ['2', '5']);

const finishedRace = { ...resolvedRace, status: 'finished' };
assert.equal(phasePresentation(finishedRace).key, 'finished');
assert.equal(phasePresentation(finishedRace).title, 'The mansion has chosen');

for (const image of [
    'murder-trivia-lobby.png',
    'trivia-question-stage.png',
    'killing-floor-keys.png',
    'killing-floor-memory.png',
    'killing-floor-chalices.png',
    'killing-floor-sword-boxes.png',
    'killing-floor-crypt-runes.png',
    'ghost-race-finale.png',
]) {
    await access(new URL(`../htdocs/assets/img/trivia/${image}`, import.meta.url));
}

console.log('Trivia game-model regressions passed.');
