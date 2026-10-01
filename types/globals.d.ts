// Global ambient declarations for browser scripts (no imports/exports, so
// everything here is global).

/* ---------- Tarot (htdocs/assets/js/tarot-data.js -> window.TarotData) ---------- */

type TarotOrientationKey = 'upright' | 'reversed';

interface TarotOrientation {
    id: string;
    label: string;
}

interface TarotSuit {
    id: string;
    name: string;
    element: string;
}

interface TarotRank {
    id: string;
    name: string;
    number: number;
}

interface TarotCard {
    slug: string;
    name: string;
    arcana: 'major' | 'minor';
    /** Suit id for minor arcana; null for major arcana. */
    suit: string | null;
    number: number;
    /** Rank id for minor arcana; null for major arcana. */
    rank: string | null;
    keywords: readonly string[];
    uprightMeaning: string;
    reversedMeaning: string;
    image: string;
}

/** CSS-grid layout hint: 1-based row/col; rotate (degrees) marks crossing cards. */
interface TarotSpreadLayout {
    row: number;
    col: number;
    rotate: number;
}

interface TarotSpreadPosition {
    id: string;
    name: string;
    positionMeaning: string;
    readingPrompt: string;
    layout: TarotSpreadLayout;
}

interface TarotSpreadGrid {
    rows: number;
    cols: number;
}

interface TarotSpread {
    id: string;
    name: string;
    description: string;
    grid: TarotSpreadGrid;
    positions: readonly TarotSpreadPosition[];
}

interface TarotMeaningPair {
    upright: string;
    reversed: string;
}

/** { [positionId]: { [cardSlug]: { upright, reversed } } } */
type TarotSpreadMeaningMap = Record<string, Record<string, TarotMeaningPair>>;

/** { [spreadId]: TarotSpreadMeaningMap } */
type TarotMeaningMapBySpread = Record<string, TarotSpreadMeaningMap>;

interface TarotDataApi {
    readonly IMAGE_ROOT: string;
    readonly CARD_BACK_IMAGE: string;
    readonly TAROT_SUITS: readonly TarotSuit[];
    readonly TAROT_RANKS: readonly TarotRank[];
    readonly TAROT_CARDS: readonly TarotCard[];
    readonly TAROT_SPREADS: readonly TarotSpread[];
    readonly TAROT_ORIENTATIONS: Readonly<Record<TarotOrientationKey, TarotOrientation>>;
    readonly getCard: (slug: string) => TarotCard | null;
    readonly getSpread: (spreadId: string) => TarotSpread | null;
    readonly getPosition: (spreadId: string, positionId: string) => TarotSpreadPosition | null;
    /**
     * Composes position context with the card's upright or reversed meaning.
     * `true` or the string 'reversed' selects reversed; anything else is upright.
     * Returns '' for an unknown card, spread, or position.
     */
    readonly tarotMeaningFor: (
        cardSlug: string,
        spreadId: string,
        positionId: string,
        orientation?: TarotOrientationKey | string | boolean,
    ) => string;
    /**
     * With a spread id: that spread's map ({} when the spread is unknown).
     * Without one: every spread's map keyed by spread id.
     */
    readonly buildMeaningMap: (spreadId?: string) => TarotSpreadMeaningMap | TarotMeaningMapBySpread;
}

interface Window {
    /** Published by tarot-data.js; absent if that script failed to load. */
    TarotData?: TarotDataApi;
}
