import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import {
    answerPayloadForSelection,
    choicesForRound,
    correctAnswersForRound,
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
assert.equal(phasePresentation(memoryRoom).key, 'memory_match');

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
    'ghost-race-finale.png',
]) {
    await access(new URL(`../htdocs/assets/img/trivia/${image}`, import.meta.url));
}

console.log('Trivia game-model regressions passed.');
