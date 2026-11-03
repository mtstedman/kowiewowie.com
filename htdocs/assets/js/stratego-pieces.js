/**
 * Stratego piece catalog shared by the lobby and board UI.
 *
 * Rank codes follow the stratego-state-shape contract. Team color is applied
 * by CSS on the board cell (.piece--red / .piece--blue), so each rank has a
 * single same-origin art path.
 */

/** @typedef {'10' | '9' | '8' | '7' | '6' | '5' | '4' | '3' | '2' | '1' | 'B' | 'F'} RankCode */

/** @typedef {{ name: string, count: number, art: string }} PieceDefinition */

/** @type {Readonly<Record<RankCode, Readonly<PieceDefinition>>>} */
export const PIECES = Object.freeze({
    '10': Object.freeze({ name: 'Marshal', count: 1, art: '/assets/img/stratego/marshal.png' }),
    '9': Object.freeze({ name: 'General', count: 1, art: '/assets/img/stratego/general.png' }),
    '8': Object.freeze({ name: 'Colonel', count: 2, art: '/assets/img/stratego/colonel.png' }),
    '7': Object.freeze({ name: 'Major', count: 3, art: '/assets/img/stratego/major.png' }),
    '6': Object.freeze({ name: 'Captain', count: 4, art: '/assets/img/stratego/captain.png' }),
    '5': Object.freeze({ name: 'Lieutenant', count: 4, art: '/assets/img/stratego/lieutenant.png' }),
    '4': Object.freeze({ name: 'Sergeant', count: 4, art: '/assets/img/stratego/sergeant.png' }),
    '3': Object.freeze({ name: 'Miner', count: 5, art: '/assets/img/stratego/miner.png' }),
    '2': Object.freeze({ name: 'Scout', count: 8, art: '/assets/img/stratego/scout.png' }),
    '1': Object.freeze({ name: 'Spy', count: 1, art: '/assets/img/stratego/spy.png' }),
    B: Object.freeze({ name: 'Bomb', count: 6, art: '/assets/img/stratego/bomb.png' }),
    F: Object.freeze({ name: 'Flag', count: 1, art: '/assets/img/stratego/flag.png' }),
});

/** Face-down art for enemy pieces whose rank is still hidden. */
export const HIDDEN_ART = '/assets/img/stratego/hidden.png';

/**
 * Display order, strongest first, ending with the immovable pieces.
 * @type {ReadonlyArray<RankCode>}
 */
export const RANK_ORDER = Object.freeze(/** @type {RankCode[]} */ (['10', '9', '8', '7', '6', '5', '4', '3', '2', '1', 'B', 'F']));

/**
 * Short text glyphs used when piece art cannot be loaded.
 * @type {Readonly<Record<RankCode, string>>}
 */
export const PIECE_GLYPHS = Object.freeze({
    '10': 'Mar',
    '9': 'Gen',
    '8': 'Col',
    '7': 'Maj',
    '6': 'Cpt',
    '5': 'Lt',
    '4': 'Sgt',
    '3': 'Min',
    '2': 'Sct',
    '1': 'Spy',
    B: 'Bomb',
    F: 'Flag',
});

/** Glyph shown for a face-down piece when HIDDEN_ART cannot be loaded. */
export const HIDDEN_GLYPH = '?';

/** Total army size per color (40). */
export const ARMY_SIZE = RANK_ORDER.reduce((total, rank) => total + PIECES[rank].count, 0);

/**
 * @param {unknown} rank
 * @returns {rank is RankCode}
 */
export const isRankCode = (rank) => typeof rank === 'string' && Object.prototype.hasOwnProperty.call(PIECES, rank);

/**
 * Human label such as "Captain (6)", "Bomb" or "Flag".
 * @param {unknown} rank
 */
export const rankLabel = (rank) => {
    if (!isRankCode(rank)) {
        return 'Unknown piece';
    }

    const { name } = PIECES[rank];
    return rank === 'B' || rank === 'F' ? name : `${name} (${rank})`;
};

/**
 * Compact badge text: the numeric rank, or B / F.
 * @param {unknown} rank
 */
export const rankBadge = (rank) => (isRankCode(rank) ? rank : '?');

export default Object.freeze({
    PIECES,
    HIDDEN_ART,
    RANK_ORDER,
    PIECE_GLYPHS,
    HIDDEN_GLYPH,
    ARMY_SIZE,
    isRankCode,
    rankLabel,
    rankBadge,
});
