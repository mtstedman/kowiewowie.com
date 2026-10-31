import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import {
    answerPayloadForSelection,
    choicesForRound,
    correctAnswersForRound,
    minigameType,
    phasePresentation,
    orderedSelectionCount,
    previewForRound,
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
assert.equal(phasePresentation(finishedRace).image, '/assets/img/trivia/ghost-race-finale.png', 'finished without a winner keeps the race art');

const finishedWithWinner = { ...finishedRace, winner_player_id: 'player-1' };
assert.equal(phasePresentation(finishedWithWinner).key, 'finished');
assert.equal(phasePresentation(finishedWithWinner).image, '/assets/img/trivia/survivor-escape.png');
assert.equal(
    phasePresentation({ ...baseRoom, status: 'finished', winner_player_id: 'player-2' }).image,
    '/assets/img/trivia/survivor-escape.png',
    'a winner shows the escape art regardless of the last round type',
);

const killingFloorRoom = (type, payload, extraRound = {}) => ({
    ...baseRoom,
    phase: 'killing_floor',
    round: {
        ...baseRoom.round,
        round_type: 'killing_floor',
        prompt_payload: {},
        minigame: { type, payload, preview: [] },
        ...extraRound,
    },
});

const arithmeticRoom = killingFloorRoom('grim_arithmetic', { expression: '7 × 6 − 3', choices: ['39', '38', '40', '49'] });
assert.equal(minigameType(arithmeticRoom), 'grim_arithmetic');
assert.equal(selectionMode(arithmeticRoom), 'single');
assert.deepEqual(choicesForRound(arithmeticRoom), ['39', '38', '40', '49']);
assert.equal(phasePresentation(arithmeticRoom).key, 'grim_arithmetic');
assert.equal(phasePresentation(arithmeticRoom).title, 'Grim Arithmetic');
assert.equal(phasePresentation(arithmeticRoom).image, '/assets/img/trivia/killing-floor-arithmetic.png');
assert.equal(phasePresentation(arithmeticRoom).expression, '7 × 6 − 3');
assert.deepEqual(correctAnswersForRound(arithmeticRoom), [], 'open arithmetic rounds hide the answer');
assert.deepEqual(answerPayloadForSelection(arithmeticRoom, ['39'], 'ffffffff-ffff-4fff-8fff-ffffffffffff'), {
    answer: '39',
    answer_payload: { answer: '39' },
    client_answer_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
});
assert.deepEqual(correctAnswersForRound({
    ...arithmeticRoom,
    round: {
        ...arithmeticRoom.round,
        status: 'resolved',
        minigame: { ...arithmeticRoom.round.minigame, payload: { ...arithmeticRoom.round.minigame.payload, correct_key: '39' } },
    },
}), ['39']);

const oddRoom = killingFloorRoom('odd_one_out', { choices: ['Raven', 'Crow', 'Magpie', 'Tulip'] });
assert.equal(minigameType(oddRoom), 'odd_one_out');
assert.equal(selectionMode(oddRoom), 'single');
assert.equal(phasePresentation(oddRoom).key, 'odd_one_out');
assert.equal(phasePresentation(oddRoom).title, 'Odd One Out');
assert.equal(phasePresentation(oddRoom).image, '/assets/img/trivia/killing-floor-odd-one-out.png');
assert.deepEqual(correctAnswersForRound({
    ...oddRoom,
    round: {
        ...oddRoom.round,
        status: 'resolved',
        minigame: {
            ...oddRoom.round.minigame,
            payload: {
                ...oddRoom.round.minigame.payload,
                correct_key: 'Tulip',
                result_description: 'Three were birds; Tulip did not belong.',
            },
        },
    },
}), ['Tulip']);

const sequenceChoices = ['Bat', 'Moon', 'Skull', 'Candle', 'Raven', 'Key'];
const sequenceRoom = killingFloorRoom(
    'sequence_recall',
    { choices: sequenceChoices },
    { answer_shape: { type: 'ordered_select', count: 4 } },
);
assert.equal(minigameType(sequenceRoom), 'sequence_recall');
assert.equal(selectionMode(sequenceRoom), 'ordered');
assert.equal(orderedSelectionCount(sequenceRoom), 4);
assert.deepEqual(choicesForRound(sequenceRoom), sequenceChoices);
assert.equal(phasePresentation(sequenceRoom).key, 'sequence_recall');
assert.equal(phasePresentation(sequenceRoom).title, 'Sequence Recall');
assert.equal(phasePresentation(sequenceRoom).image, '/assets/img/trivia/killing-floor-sequence.png');
assert.deepEqual(previewForRound(sequenceRoom), { kind: '', symbols: [] }, 'no preview once the flash ends');
assert.deepEqual(
    previewForRound({
        ...sequenceRoom,
        round: { ...sequenceRoom.round, minigame: { ...sequenceRoom.round.minigame, preview: { sequence: ['Skull', 'Bat', 'Key', 'Moon'] } } },
    }),
    { kind: 'sequence', symbols: ['Skull', 'Bat', 'Key', 'Moon'] },
);
assert.deepEqual(previewForRound(memoryRoom), { kind: 'memory', symbols: ['Candle', 'Bell'] });
assert.deepEqual(
    answerPayloadForSelection(sequenceRoom, ['Skull', 'Bat', 'Key', 'Moon'], '11111111-1111-4111-8111-111111111111'),
    {
        selected: ['Skull', 'Bat', 'Key', 'Moon'],
        answer_payload: { selected: ['Skull', 'Bat', 'Key', 'Moon'] },
        client_answer_id: '11111111-1111-4111-8111-111111111111',
    },
    'ordered payload keeps click order',
);
assert.deepEqual(
    answerPayloadForSelection(sequenceRoom, ['Moon', 'Skull', 'Moon', 'Bat'], '22222222-2222-4222-8222-222222222222').selected,
    ['Moon', 'Skull', 'Bat'],
    'ordered payload drops repeated picks without reordering',
);
assert.equal(
    'answer' in answerPayloadForSelection(sequenceRoom, ['Bat'], '33333333-3333-4333-8333-333333333333'),
    false,
    'ordered payload does not send a scalar answer',
);
const resolvedSequence = {
    ...sequenceRoom,
    round: {
        ...sequenceRoom.round,
        status: 'resolved',
        minigame: {
            ...sequenceRoom.round.minigame,
            payload: { choices: sequenceChoices, correct_order: ['Skull', 'Bat', 'Key', 'Moon'] },
        },
        viewer_answer: { answered: true, answer_payload: { selected: ['Skull', 'Key', 'Bat', 'Moon'] } },
    },
};
assert.deepEqual(correctAnswersForRound(resolvedSequence), ['Skull', 'Bat', 'Key', 'Moon']);
assert.deepEqual(savedSelection(resolvedSequence), ['Skull', 'Key', 'Bat', 'Moon'], 'saved ordered picks keep their order');

const unknownRoom = killingFloorRoom('mystery_trap', { choices: ['A', 'B'] });
assert.equal(minigameType(unknownRoom), '');
assert.equal(phasePresentation(unknownRoom).key, 'key_lock', 'unknown mini-games fall back to the key lock');
assert.equal(phasePresentation(unknownRoom).image, '/assets/img/trivia/killing-floor-keys.png');

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
