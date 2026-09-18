# Tarot Interpretation Source Map

Status: Active design reference  
Last updated: 2026-09-18

## Purpose

This document defines how wowiekowie.com should create, deepen, attribute, and
maintain tarot interpretations. The goal is a coherent Rider-Waite-Smith-based
system whose readings respond to the card, orientation, and spread position
without copying a modern author's prose or presenting one interpretation as
the only authoritative meaning.

The interpretation catalog should remain useful as reflective guidance. It
must not claim certainty about another person's private thoughts or present a
likely outcome as fixed fate.

## Current interpretation model

The canonical implementation is `htdocs/assets/js/tarot-data.js`.

Each card currently supplies:

- a canonical name and slug;
- keywords;
- an upright base meaning;
- a reversed base meaning;
- arcana, suit, and rank metadata where applicable.

Each spread position supplies:

- a stable identifier and display name;
- an explanation of what the position represents;
- a practical reading prompt;
- layout coordinates.

`tarotMeaningFor()` composes these data into the text shown in the reading
dialog and meaning map. The first depth layer adds:

1. the card's upright or reversed meaning;
2. orientation framing appropriate to the selected position;
3. an archetypal frame for Major Arcana, or rank-and-suit structure for Minor
   Arcana;
4. the position's practical prompt.

This composition model gives every card, position, and orientation a complete
interpretation without maintaining thousands of nearly duplicated strings.

Rendering ownership is intentionally separate: the position block displays
only `positionMeaning`, while the interpretation ends with `readingPrompt`.
The prompt must not be repeated in both layers.

## Source hierarchy

"Authoritative" has two distinct meanings in tarot. Historical primary texts
document influential systems; respected modern works offer interpretive
methods. No source establishes a single universally correct reading.

### Tier 1: public-domain primary foundations

These sources may be ingested, normalized, quoted where useful, and mapped at
the claim level.

#### A. E. Waite, *The Pictorial Key to the Tarot*

- Published with Pamela Colman Smith's 78-card imagery.
- Primary foundation for Rider-Waite-Smith divinatory meanings and the Celtic
  Cross as popularized in that tradition.
- Best used for historical card meanings, reversals, imagery notes, and spread
  provenance.
- Public text: <https://en.wikisource.org/wiki/The_Pictorial_Key_to_the_Tarot>

#### S. L. MacGregor Mathers and Harriet Felkin, *Book T: The Tarot*

- Primary Golden Dawn source for elemental, astrological, decanic, court-card,
  and dignity correspondences that strongly influenced later English-language
  tarot systems.
- Best used for structural metadata and historical correspondences rather than
  as ready-made modern prose.
- Public text:
  <https://benebellwen.com/wp-content/uploads/2013/02/mathers-and-felkin-golden-dawn-book-t-the-tarot-1888.pdf>

### Tier 2: respected modern methodological references

These works should guide editorial reasoning and source comparison. Their prose
must not be copied into the application unless separately licensed.

#### Rachel Pollack, *Seventy-Eight Degrees of Wisdom*

- Strong reference for psychological, narrative, and archetypal readings.
- Useful for understanding a card as a lived process rather than a keyword
  list.
- Publisher page:
  <https://redwheelweiser.com/book/seventy-eight-degrees-of-wisdom-9781578636655/>

#### Mary K. Greer, *The Complete Book of Tarot Reversals*

- Preferred methodological reference for avoiding the simplistic rule that a
  reversed card is merely the upright card's opposite.
- Supports reading reversals as blocked, delayed, internalized, weakened,
  excessive, resisted, or emerging energy.
- Publisher page: <https://www.llewellyn.com/product.php?ean=9781567182859>

#### Mary K. Greer, *21 Ways to Read a Tarot Card*

- Useful for symbolism, narrative, dialogue, comparison, and contextual
  interpretation techniques.
- Publisher page: <https://www.llewellyn.com/product.php?ean=9780738707846>

#### Joan Bunning, *Learning the Tarot*

- Clear reference for keywords, action phrases, card relationships, and a
  teachable progression from individual cards to complete readings.
- The author maintains an online course and card reference:
  <https://www.learntarot.com/>

#### Benebell Wen, *Holistic Tarot*

- Comprehensive modern synthesis of symbolism, traditional structures,
  analytical reading, decision-making, and self-reflection.
- Useful as a systems-design and editorial cross-check.
- Publisher page:
  <https://penguinrandomhousehighereducation.com/book/?isbn=9781583948354>

#### T. Susan Chang and M. M. Meleen, *Tarot Deciphered*

- Strong modern reference for Golden Dawn-derived correspondences in
  Rider-Waite-Smith and related decks.
- Useful when adding decans, planets, zodiac signs, elemental dignities, and
  other esoteric layers.
- Publisher page: <https://www.llewellyn.com/product.php?ean=9780738764474>

## Source-map data model

Future source-backed facts should be stored as structured data rather than
embedded as unexplained prose. A source record should contain:

```js
{
    id: 'waite-pictorial-key',
    author: 'A. E. Waite',
    title: 'The Pictorial Key to the Tarot',
    publicationYear: 1911,
    url: 'https://en.wikisource.org/wiki/The_Pictorial_Key_to_the_Tarot',
    rights: 'public-domain',
}
```

A card-level sourced assertion should contain:

```js
{
    sourceId: 'waite-pictorial-key',
    locator: 'Part III, The Greater Arcana, The Fool',
    topics: ['divinatory-meaning', 'reversal'],
    sourceText: 'Optional short public-domain excerpt',
    normalizedClaims: ['beginning', 'freedom', 'risk'],
}
```

Modern copyrighted sources should normally record bibliographic metadata,
topic coverage, and an original editorial synthesis. Do not store long excerpts
or lightly paraphrased substitutes for the original text.

## Interpretation composition layers

Depth should be added through explicit layers so the reader can understand why
an interpretation says what it says.

1. **Card identity** — the card-specific upright or reversed meaning.
2. **Orientation** — direct expression when upright; blocked, internalized,
   delayed, excessive, resisted, or emerging expression when reversed.
3. **Arcana scale** — Major Arcana as broader archetypal lessons or turning
   points; Minor Arcana as situational developments.
4. **Suit domain** — Wands for will and action, Cups for emotion and
   relationship, Swords for thought and conflict, and Pentacles for embodied
   and material concerns.
5. **Rank development** — the shared movement from Ace through Ten and the
   characteristic modes of Pages, Knights, Queens, and Kings.
6. **Spread position** — the specific question the card answers in its place in
   the layout.
7. **Card relationships** — later work may consider repeated suits, repeated
   ranks, Major Arcana density, elemental support or tension, and neighboring
   cards.
8. **Actionable reflection** — close with a question or practical prompt rather
   than an absolute prediction.

## Editorial rules

- Write original application prose even when a source inspires the underlying
  interpretation.
- Keep historical claims distinct from modern editorial synthesis.
- Attribute factual correspondences to a source and include a stable locator.
- Avoid treating reversed cards as automatically negative.
- Avoid deterministic language such as "will happen" when "current direction"
  or "likely trajectory" is more accurate.
- Do not claim access to another person's unspoken thoughts, intentions, or
  future behavior.
- Preserve ambiguity where the card legitimately supports more than one
  expression.
- Prefer a coherent system over accumulating every meaning found online.
- Source maps belong in structured catalog data; rendering code should only
  compose and display that data.

## Recommended implementation sequence

### Phase 1: compositional depth

- Card meaning plus position context.
- Major versus Minor framing.
- Suit and rank structure.
- Nuanced upright and reversed orientation.
- Position-specific reflection prompt.

Status: implemented locally in `tarot-data.js`; not yet committed or deployed
as of this document's last update.

### Phase 2: primary-source map

- Add a canonical source catalog.
- Map all 78 cards to Waite and Book T locators.
- Normalize historical meanings and correspondences into structured fields.
- Preserve short public-domain excerpts only when they materially aid review.
- Add validation for unknown sources, missing locators, and unsupported claims.

### Phase 3: relational reading

- Detect suit, element, rank, and Major Arcana patterns across a dealt spread.
- Identify reinforcing and contrasting neighboring cards.
- Generate a spread-level synthesis in addition to card-by-card readings.
- Keep every generated claim traceable to card data, spread structure, or a
  documented composition rule.

### Phase 4: editorial review

- Compare generated readings against representative examples from the modern
  methodological references.
- Review for repetition, fatalism, mind-reading, vague filler, and awkward
  combinations.
- Test a balanced matrix of Major and Minor cards, all suits, court cards,
  reversals, and every position type.

## When additional book preparation is necessary

The public-domain foundation and independent research are enough to build a
deep, consistent, source-mapped system. User-prepared book extracts are only
needed when the product must reproduce a particular modern author's taxonomy,
terminology, or interpretive method precisely. Any such material must have a
clear right to be used and should remain a reference source, not become copied
application prose.
