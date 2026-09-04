const SCENE_ROOT = '/assets/img/trivia';

const stringList = (value) => Array.isArray(value)
    ? value.map((item) => String(item ?? '').trim()).filter((item) => item !== '')
    : [];

export const roundType = (room) => {
    const value = String(room?.round?.round_type || room?.phase || 'trivia');
    return ['trivia', 'killing_floor', 'ghost_race'].includes(value) ? value : 'trivia';
};

export const minigameType = (room) => {
    const value = String(room?.round?.minigame?.type || '');
    return ['key_lock', 'memory_match', 'poison_chalices', 'sword_boxes', 'crypt_runes'].includes(value) ? value : '';
};

export const selectionMode = (room) => {
    const shape = String(room?.round?.answer_shape?.type || 'single_choice');
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

export const answerPayloadForSelection = (room, selection, clientAnswerId) => {
    const selected = stringList(selection).filter((value, index, values) => values.indexOf(value) === index);
    const payload = { client_answer_id: clientAnswerId };
    if (selectionMode(room) === 'multiple') {
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
        if (['memory_match', 'crypt_runes'].includes(minigameType(room))) {
            return stringList(round.minigame?.payload?.correct_choices);
        }
        return stringList([round.minigame?.payload?.correct_key]);
    }
    if (roundType(room) === 'ghost_race') {
        return (Array.isArray(round.prompt_payload?.items) ? round.prompt_payload.items : [])
            .filter((item) => item && item.correct === true)
            .map((item) => String(item.label || '').trim())
            .filter((item) => item !== '');
    }
    const shapedAnswers = stringList(round.answer_shape?.correct_answers);
    return shapedAnswers.length > 0 ? shapedAnswers : stringList([round.prompt?.correct_answer]);
};

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
            instructions: 'Select every answer that fits. Each correct judgment moves you toward the exit—or the body.',
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
