const SCENE_ROOT = '/assets/img/trivia';

const stringList = (value) => Array.isArray(value)
    ? value.map((item) => String(item ?? '').trim()).filter((item) => item !== '')
    : [];

export const roundType = (room) => {
    const value = String(room?.round?.round_type || room?.phase || 'trivia');
    return ['trivia', 'killing_floor', 'ghost_race'].includes(value) ? value : 'trivia';
};

export const MINIGAME_TYPES = [
    'key_lock',
    'memory_match',
    'poison_chalices',
    'sword_boxes',
    'crypt_runes',
    'grim_arithmetic',
    'odd_one_out',
    'sequence_recall',
];

export const SCENE_FALLBACK_IMAGE = `${SCENE_ROOT}/trivia-question-stage.png`;
export const ELIMINATION_REVEAL_IMAGE = `${SCENE_ROOT}/mansion-claims-victim.png`;

export const minigameType = (room) => {
    const value = String(room?.round?.minigame?.type || '');
    return MINIGAME_TYPES.includes(value) ? value : '';
};

/**
 * @param {any} room
 * @returns {'ordered' | 'multiple' | 'single'}
 */
export const selectionMode = (room) => {
    const shape = String(room?.round?.answer_shape?.type || 'single_choice');
    if (shape === 'ordered_select') {
        return 'ordered';
    }
    return shape === 'multi_select' || minigameType(room) === 'memory_match' || roundType(room) === 'ghost_race'
        ? 'multiple'
        : 'single';
};

export const choicesForRound = (room) => {
    const round = room?.round;
    if (!round) {
        return [];
    }
    if (roundType(room) === 'killing_floor') {
        return stringList(round.minigame?.payload?.choices);
    }
    return stringList(round.prompt?.choices);
};

/**
 * Number of picks an ordered round expects (answer_shape.count, default 4).
 * @param {any} room
 * @returns {number}
 */
export const orderedSelectionCount = (room) => {
    const count = Number.parseInt(String(room?.round?.answer_shape?.count ?? ''), 10);
    return Number.isFinite(count) && count > 0 ? count : 4;
};

export const answerPayloadForSelection = (room, selection, clientAnswerId) => {
    const selected = stringList(selection).filter((value, index, values) => values.indexOf(value) === index);
    const payload = { client_answer_id: clientAnswerId };
    const mode = selectionMode(room);
    if (mode === 'multiple' || mode === 'ordered') {
        payload.selected = selected;
        payload.answer_payload = { selected };
        return payload;
    }
    payload.answer = selected[0] || '';
    payload.answer_payload = { answer: payload.answer };
    return payload;
};

export const savedSelection = (room) => {
    const answer = room?.round?.viewer_answer;
    if (!answer || answer.answered !== true) {
        return [];
    }
    const selected = stringList(answer.answer_payload?.selected);
    if (selected.length > 0) {
        return selected;
    }
    const scalar = String(answer.answer_payload?.answer || answer.answer_text || '').trim();
    return scalar === '' || scalar === '(none)' ? [] : [scalar];
};

export const viewerCanAnswer = (room) => room?.status === 'active'
    && room?.round?.status === 'answering'
    && (room?.round?.viewer_eligible === true || room?.viewer?.can_answer_round === true)
    && room?.round?.viewer_answer?.answered !== true;

export const correctAnswersForRound = (room) => {
    const round = room?.round;
    if (!round || (round.status !== 'resolved' && room?.status !== 'finished')) {
        return [];
    }
    if (roundType(room) === 'killing_floor') {
        const minigame = minigameType(room);
        if (['memory_match', 'crypt_runes'].includes(minigame)) {
            return stringList(round.minigame?.payload?.correct_choices);
        }
        if (minigame === 'sequence_recall') {
            return stringList(round.minigame?.payload?.correct_order);
        }
        return stringList([round.minigame?.payload?.correct_key]);
    }
    if (roundType(room) === 'ghost_race') {
        return (Array.isArray(round.prompt_payload?.items) ? round.prompt_payload.items : [])
            .filter((item) => item && item.correct === true)
            .map((item) => String(item.label || '').trim())
            .filter((item) => item !== '');
    }
    const shapedCorrectAnswers = round.answer_shape?.correct_answers;
    if (round.answer_shape?.type === 'multi_select' && Array.isArray(shapedCorrectAnswers)) {
        return stringList(shapedCorrectAnswers);
    }
    const shapedAnswers = stringList(shapedCorrectAnswers);
    return shapedAnswers.length > 0 ? shapedAnswers : stringList([round.prompt?.correct_answer]);
};

/**
 * Symbols to flash before choices unlock: memory_match uses a list preview,
 * sequence_recall uses preview.sequence (ordered).
 * @param {any} room
 * @returns {{ kind: 'memory' | 'sequence' | '', symbols: string[] }}
 */
export const previewForRound = (room) => {
    const preview = room?.round?.minigame?.preview;
    const minigame = minigameType(room);
    if (minigame === 'sequence_recall') {
        const sequence = preview && typeof preview === 'object' && !Array.isArray(preview)
            ? stringList(preview.sequence)
            : [];
        return sequence.length > 0 ? { kind: 'sequence', symbols: sequence } : { kind: '', symbols: [] };
    }
    const symbols = Array.isArray(preview) ? stringList(preview) : [];
    return symbols.length > 0 ? { kind: 'memory', symbols } : { kind: '', symbols: [] };
};

/**
 * @typedef {{
 *   key: string,
 *   label: string,
 *   title: string,
 *   instructions: string,
 *   image: string,
 *   alt: string,
 *   expression?: string,
 * }} PhasePresentation
 */

/**
 * @param {any} room
 * @returns {PhasePresentation}
 */
export const phasePresentation = (room) => {
    const type = roundType(room);
    const minigame = minigameType(room);
    if (room?.status === 'waiting') {
        return {
            key: 'waiting',
            label: 'The lobby',
            title: 'Gather the living',
            instructions: 'Share the invite links. The host can begin when at least two souls are seated.',
            image: `${SCENE_ROOT}/murder-trivia-lobby.png`,
            alt: 'Friendly ghosts and skeletons gathering around a glowing question mark in a haunted game room.',
        };
    }
    if (room?.status === 'finished') {
        if (room?.winner_player_id) {
            return {
                key: 'finished',
                label: 'Game over',
                title: 'The mansion has chosen',
                instructions: 'The winner escaped with the body. Everyone else gets the consolation prize of being a ghost.',
                image: `${SCENE_ROOT}/survivor-escape.png`,
                alt: 'The last survivor bursting out of the haunted mansion doors into the dawn while ghosts wave goodbye.',
            };
        }
        return {
            key: 'finished',
            label: 'Game over',
            title: 'The mansion has chosen',
            instructions: 'The winner escaped with the body. Everyone else gets the consolation prize of being a ghost.',
            image: type === 'ghost_race' ? `${SCENE_ROOT}/ghost-race-finale.png` : `${SCENE_ROOT}/trivia-question-stage.png`,
            alt: type === 'ghost_race'
                ? 'Colorful ghosts racing through a haunted hallway beneath a glowing question mark.'
                : 'A haunted library quiz stage with four glowing answer portals and a central question podium.',
        };
    }
    if (type === 'killing_floor' && minigame === 'memory_match') {
        return {
            key: 'memory_match',
            label: 'The Killing Floor',
            title: 'Memory Grid',
            instructions: String(room?.round?.prompt_payload?.instructions || 'Select every symbol you remember before the lights go out.'),
            image: `${SCENE_ROOT}/killing-floor-memory.png`,
            alt: 'A skeleton conducting a magical memory game made of framed spooky symbols.',
        };
    }
    if (type === 'killing_floor' && minigame === 'poison_chalices') {
        return {
            key: 'poison_chalices',
            label: 'The Killing Floor',
            title: 'Poison Chalices',
            instructions: String(room?.round?.prompt_payload?.instructions || 'Choose the one chalice that is safe to drink.'),
            image: `${SCENE_ROOT}/killing-floor-chalices.png`,
            alt: 'A glowing safe chalice among poisoned goblets in a haunted crypt.',
        };
    }
    if (type === 'killing_floor' && minigame === 'sword_boxes') {
        return {
            key: 'sword_boxes',
            label: 'The Killing Floor',
            title: 'Sword Boxes',
            instructions: String(room?.round?.prompt_payload?.instructions || 'Choose the one box that holds a harmless blade.'),
            image: `${SCENE_ROOT}/killing-floor-sword-boxes.png`,
            alt: 'A set of ominous boxes concealing swords in a candlelit trap room.',
        };
    }
    if (type === 'killing_floor' && minigame === 'crypt_runes') {
        return {
            key: 'crypt_runes',
            label: 'The Killing Floor',
            title: 'Crypt Runes',
            instructions: String(room?.round?.prompt_payload?.instructions || 'Select every rune in the safe pattern.'),
            image: `${SCENE_ROOT}/killing-floor-crypt-runes.png`,
            alt: 'Ancient glowing runes arranged in a safe pattern on a crypt wall.',
        };
    }
    if (type === 'killing_floor' && minigame === 'grim_arithmetic') {
        return {
            key: 'grim_arithmetic',
            label: 'The Killing Floor',
            title: 'Grim Arithmetic',
            instructions: String(room?.round?.prompt_payload?.instructions || 'Solve the sum before the blade falls.'),
            image: `${SCENE_ROOT}/killing-floor-arithmetic.png`,
            alt: 'A skeleton scrawling a glowing sum on a chalkboard beneath a swinging blade.',
            expression: String(room?.round?.minigame?.payload?.expression || '').trim(),
        };
    }
    if (type === 'killing_floor' && minigame === 'odd_one_out') {
        return {
            key: 'odd_one_out',
            label: 'The Killing Floor',
            title: 'Odd One Out',
            instructions: String(room?.round?.prompt_payload?.instructions || 'Choose the one item that does not belong with the others.'),
            image: `${SCENE_ROOT}/killing-floor-odd-one-out.png`,
            alt: 'Four curious objects on haunted pedestals, one of them clearly out of place.',
        };
    }
    if (type === 'killing_floor' && minigame === 'sequence_recall') {
        return {
            key: 'sequence_recall',
            label: 'The Killing Floor',
            title: 'Sequence Recall',
            instructions: String(room?.round?.prompt_payload?.instructions || 'Watch the sequence, then select all four symbols in the same order.'),
            image: `${SCENE_ROOT}/killing-floor-sequence.png`,
            alt: 'Glowing symbols lighting up one after another along a crypt wall.',
        };
    }
    if (type === 'killing_floor') {
        return {
            key: 'key_lock',
            label: 'The Killing Floor',
            title: 'Keyring Trial',
            instructions: String(room?.round?.prompt_payload?.instructions || 'Choose the one key that opens the lock.'),
            image: `${SCENE_ROOT}/killing-floor-keys.png`,
            alt: 'A friendly ghost choosing among glowing keys in a hallway of locked doors.',
        };
    }
    if (type === 'ghost_race') {
        return {
            key: 'ghost_race',
            label: 'Final round',
            title: 'Escape the ghost race',
            instructions: 'All, some, or none of the choices may be correct. Each correct pick or correctly skipped choice moves you one space toward the exit—or the body.',
            image: `${SCENE_ROOT}/ghost-race-finale.png`,
            alt: 'Colorful ghosts racing through a haunted hallway beneath a glowing question mark.',
        };
    }
    return {
        key: 'trivia',
        label: 'Question chamber',
        title: 'Answer before time runs out',
        instructions: 'Pick the best answer. A miss sends the living players downstairs to face a trap.',
        image: `${SCENE_ROOT}/trivia-question-stage.png`,
        alt: 'A haunted library quiz stage with four glowing answer portals and a central question podium.',
    };
};

export const racePositionMap = (room) => {
    const source = room?.round?.race_positions && typeof room.round.race_positions === 'object'
        ? room.round.race_positions
        : room?.race_state?.positions;
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
        return {};
    }
    return Object.fromEntries(Object.entries(source).map(([id, value]) => [id, Math.max(0, Number(value) || 0)]));
};
