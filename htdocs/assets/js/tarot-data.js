(() => {
    'use strict';

    const IMAGE_ROOT = '/assets/img/tarot/';
    const CARD_BACK_IMAGE = `${IMAGE_ROOT}card-back.png`;

    const pad2 = (value) => String(value).padStart(2, '0');

    const deepFreeze = (value) => {
        if (value && typeof value === 'object' && !Object.isFrozen(value)) {
            Object.values(value).forEach(deepFreeze);
            Object.freeze(value);
        }

        return value;
    };

    // Major Arcana, in order 00-21. Traditional Rider-Waite interpretations.
    const MAJOR_ARCANA = [
        {
            key: 'the-fool',
            name: 'The Fool',
            keywords: ['beginnings', 'innocence', 'spontaneity', 'free spirit'],
            upright: 'New beginnings, faith in the unknown, and a leap taken with an open heart; the start of a journey full of potential.',
            reversed: 'Recklessness, naivety, or hesitation to begin; holding back out of fear or leaping without looking.',
        },
        {
            key: 'the-magician',
            name: 'The Magician',
            keywords: ['manifestation', 'willpower', 'skill', 'resourcefulness'],
            upright: 'Focused will and skill turning ideas into reality; every tool you need is already at hand.',
            reversed: 'Manipulation, scattered energy, or untapped talent; plans that lack follow-through or honest intent.',
        },
        {
            key: 'the-high-priestess',
            name: 'The High Priestess',
            keywords: ['intuition', 'mystery', 'inner voice', 'subconscious'],
            upright: 'Intuition, hidden knowledge, and quiet wisdom; trust what you sense beneath the surface.',
            reversed: 'Ignoring your inner voice, secrets withheld, or disconnection from intuition; surface noise drowning out deeper truth.',
        },
        {
            key: 'the-empress',
            name: 'The Empress',
            keywords: ['abundance', 'nurturing', 'fertility', 'nature'],
            upright: 'Abundance, nurturing, and creative fertility; growth that comes from care, comfort, and connection to the senses.',
            reversed: 'Creative block, smothering, or neglect of self-care; dependence on others or growth stalled by imbalance.',
        },
        {
            key: 'the-emperor',
            name: 'The Emperor',
            keywords: ['authority', 'structure', 'stability', 'leadership'],
            upright: 'Structure, authority, and steady leadership; order established through discipline and clear boundaries.',
            reversed: 'Rigidity, domination, or lack of discipline; control used to excess or authority that has lost its footing.',
        },
        {
            key: 'the-hierophant',
            name: 'The Hierophant',
            keywords: ['tradition', 'conformity', 'spiritual guidance', 'institutions'],
            upright: 'Tradition, shared belief, and guidance from established institutions or a trusted mentor; learning within a system.',
            reversed: 'Rebellion against convention, questioning dogma, or feeling constrained by rules; finding your own path.',
        },
        {
            key: 'the-lovers',
            name: 'The Lovers',
            keywords: ['love', 'harmony', 'choice', 'aligned values'],
            upright: 'Love, union, and meaningful choice; a partnership or decision rooted in aligned values.',
            reversed: 'Disharmony, imbalance, or misaligned values; a difficult choice avoided or a relationship out of sync.',
        },
        {
            key: 'the-chariot',
            name: 'The Chariot',
            keywords: ['determination', 'willpower', 'victory', 'control'],
            upright: 'Determination and willpower driving toward victory; opposing forces harnessed and steered with focus.',
            reversed: 'Lack of direction, loss of control, or aggression; forces pulling different ways and momentum stalled.',
        },
        {
            key: 'strength',
            name: 'Strength',
            keywords: ['courage', 'compassion', 'inner strength', 'patience'],
            upright: 'Quiet courage, compassion, and inner strength; gentle mastery of fear and impulse.',
            reversed: 'Self-doubt, low energy, or raw emotion in charge; inner strength forgotten or turned into force.',
        },
        {
            key: 'the-hermit',
            name: 'The Hermit',
            keywords: ['introspection', 'solitude', 'guidance', 'inner search'],
            upright: 'Introspection and solitude in search of truth; the inner light that guides you and others.',
            reversed: 'Isolation, loneliness, or withdrawal carried too far; refusing counsel or avoiding necessary reflection.',
        },
        {
            key: 'wheel-of-fortune',
            name: 'Wheel of Fortune',
            keywords: ['cycles', 'fate', 'turning point', 'luck'],
            upright: 'Cycles turning, fortunate change, and a decisive turning point; fate in motion.',
            reversed: 'Bad luck, resistance to change, or a cycle repeating; clinging to what the wheel is carrying away.',
        },
        {
            key: 'justice',
            name: 'Justice',
            keywords: ['fairness', 'truth', 'cause and effect', 'law'],
            upright: 'Fairness, truth, and accountability; clear decisions and the consequences of past actions coming due.',
            reversed: 'Unfairness, dishonesty, or avoided accountability; a biased judgment or a truth not faced.',
        },
        {
            key: 'the-hanged-man',
            name: 'The Hanged Man',
            keywords: ['surrender', 'pause', 'new perspective', 'letting go'],
            upright: 'A willing pause, surrender, and a new perspective; insight gained by letting go and waiting.',
            reversed: 'Stalling, resistance, or needless sacrifice; indecision that keeps you suspended.',
        },
        {
            key: 'death',
            name: 'Death',
            keywords: ['endings', 'transformation', 'transition', 'release'],
            upright: 'Endings that make way for transformation; one chapter closing so another can begin.',
            reversed: 'Resisting change, stagnation, or fear of endings; holding on to what has already run its course.',
        },
        {
            key: 'temperance',
            name: 'Temperance',
            keywords: ['balance', 'moderation', 'patience', 'purpose'],
            upright: 'Balance, moderation, and patience; blending opposites into a harmonious middle way.',
            reversed: 'Imbalance, excess, or haste; lacking long-term vision and swinging between extremes.',
        },
        {
            key: 'the-devil',
            name: 'The Devil',
            keywords: ['bondage', 'attachment', 'temptation', 'materialism'],
            upright: 'Attachment, temptation, and self-imposed chains; unhealthy patterns, addiction, or materialism.',
            reversed: 'Release from bondage, reclaiming power, or confronting the shadow self; breaking free of what held you.',
        },
        {
            key: 'the-tower',
            name: 'The Tower',
            keywords: ['sudden upheaval', 'revelation', 'chaos', 'awakening'],
            upright: 'Sudden upheaval and revelation; false structures collapsing so the truth can be seen.',
            reversed: 'Disaster averted or delayed, fear of change, or inner upheaval; resisting a collapse that must come.',
        },
        {
            key: 'the-star',
            name: 'The Star',
            keywords: ['hope', 'renewal', 'inspiration', 'serenity'],
            upright: 'Hope, renewal, and serene inspiration; healing and faith in the future after hardship.',
            reversed: 'Despair, lack of faith, or disconnection; hope dimmed and inspiration hard to find.',
        },
        {
            key: 'the-moon',
            name: 'The Moon',
            keywords: ['illusion', 'intuition', 'uncertainty', 'subconscious'],
            upright: 'Illusion, dreams, and uncertainty; intuition guides you through what is unclear or hidden.',
            reversed: 'Confusion lifting, fears released, or repressed emotions surfacing; truth emerging from the fog.',
        },
        {
            key: 'the-sun',
            name: 'The Sun',
            keywords: ['joy', 'success', 'vitality', 'positivity'],
            upright: 'Joy, success, and radiant vitality; clarity, warmth, and confidence in full light.',
            reversed: 'Temporary gloom, dampened enthusiasm, or overconfidence; the inner child hidden behind clouds.',
        },
        {
            key: 'judgement',
            name: 'Judgement',
            keywords: ['rebirth', 'reckoning', 'inner calling', 'absolution'],
            upright: 'Awakening, reckoning, and answering a higher calling; honest self-evaluation leading to renewal.',
            reversed: 'Self-doubt, harsh self-judgment, or ignoring the call; refusing to learn from the past.',
        },
        {
            key: 'the-world',
            name: 'The World',
            keywords: ['completion', 'integration', 'accomplishment', 'wholeness'],
            upright: 'Completion, integration, and accomplishment; a cycle fulfilled and the world open before you.',
            reversed: 'Incompletion, lack of closure, or shortcuts taken; a final step still waiting to be taken.',
        },
    ];

    const SUITS = [
        { id: 'wands', name: 'Wands', element: 'fire' },
        { id: 'cups', name: 'Cups', element: 'water' },
        { id: 'swords', name: 'Swords', element: 'air' },
        { id: 'pentacles', name: 'Pentacles', element: 'earth' },
    ];

    const RANKS = [
        { id: 'ace', name: 'Ace' },
        { id: 'two', name: 'Two' },
        { id: 'three', name: 'Three' },
        { id: 'four', name: 'Four' },
        { id: 'five', name: 'Five' },
        { id: 'six', name: 'Six' },
        { id: 'seven', name: 'Seven' },
        { id: 'eight', name: 'Eight' },
        { id: 'nine', name: 'Nine' },
        { id: 'ten', name: 'Ten' },
        { id: 'page', name: 'Page' },
        { id: 'knight', name: 'Knight' },
        { id: 'queen', name: 'Queen' },
        { id: 'king', name: 'King' },
    ];

    // Minor Arcana meanings, indexed by suit then rank order (ace..king).
    const MINOR_MEANINGS = {
        wands: [
            {
                keywords: ['inspiration', 'potential', 'new venture', 'spark'],
                upright: 'A spark of inspiration and raw creative potential; the start of a bold new venture.',
                reversed: 'Delays, lack of motivation, or a creative spark that fails to catch; energy without an outlet.',
            },
            {
                keywords: ['planning', 'future vision', 'decisions', 'discovery'],
                upright: 'Planning ahead, personal power, and choosing a direction; the wider world is within reach.',
                reversed: 'Fear of the unknown, poor planning, or playing it safe; staying inside your comfort zone.',
            },
            {
                keywords: ['expansion', 'foresight', 'progress', 'opportunity'],
                upright: 'Expansion and foresight; early efforts paying off as ships come in and horizons widen.',
                reversed: 'Obstacles to growth, delays, or lack of foresight; plans that disappoint or return slowly.',
            },
            {
                keywords: ['celebration', 'harmony', 'home', 'milestones'],
                upright: 'Celebration, harmony, and homecoming; a milestone reached and a stable foundation to enjoy.',
                reversed: 'Tension at home, lack of support, or transition; celebrations postponed or a sense of being unsettled.',
            },
            {
                keywords: ['conflict', 'competition', 'tension', 'disagreement'],
                upright: 'Competition, conflict, and clashing egos; tension that can sharpen skills or scatter energy.',
                reversed: 'Avoiding conflict, resolving disagreements, or inner struggle; tension finally easing.',
            },
            {
                keywords: ['victory', 'recognition', 'success', 'confidence'],
                upright: 'Victory, public recognition, and well-earned success; confidence rides high.',
                reversed: 'A fall from grace, lack of recognition, or ego; success delayed or praise withheld.',
            },
            {
                keywords: ['defiance', 'perseverance', 'protection', 'standing ground'],
                upright: 'Standing your ground, defending your position, and persevering against challengers.',
                reversed: 'Feeling overwhelmed, giving up, or exhaustion; defenses crumbling under pressure.',
            },
            {
                keywords: ['speed', 'movement', 'action', 'swift change'],
                upright: 'Swift action, rapid movement, and news arriving; momentum carrying things forward quickly.',
                reversed: 'Delays, frustration, or scattered energy; waiting when you want to move.',
            },
            {
                keywords: ['resilience', 'persistence', 'boundaries', 'last stand'],
                upright: 'Resilience and persistence near the finish line; wounded but still standing and guarding what matters.',
                reversed: 'Paranoia, defensiveness, or fatigue; struggling to carry on or refusing help.',
            },
            {
                keywords: ['burden', 'responsibility', 'overload', 'hard work'],
                upright: 'Burden and heavy responsibility; carrying too much as success turns into strain.',
                reversed: 'Releasing burdens, delegating, or collapse from overload; learning to set things down.',
            },
            {
                keywords: ['enthusiasm', 'exploration', 'discovery', 'free spirit'],
                upright: 'Enthusiastic exploration and exciting news; a curious free spirit eager to begin.',
                reversed: 'Hasty ideas, lack of direction, or procrastination; news delayed or enthusiasm that fizzles.',
            },
            {
                keywords: ['energy', 'passion', 'adventure', 'impulsiveness'],
                upright: 'Energy, passion, and bold adventure; charging forward with fiery confidence.',
                reversed: 'Recklessness, haste, or scattered energy; impatience leading to frustration or burnout.',
            },
            {
                keywords: ['courage', 'confidence', 'determination', 'warmth'],
                upright: 'Courage, warmth, and vibrant confidence; a determined and magnetic presence.',
                reversed: 'Self-doubt, jealousy, or a demanding temperament; confidence turned inward or depleted.',
            },
            {
                keywords: ['leadership', 'vision', 'entrepreneurship', 'honour'],
                upright: 'Visionary leadership and bold entrepreneurial spirit; turning big ideas into action.',
                reversed: 'Impulsiveness, overbearing leadership, or impossible expectations; vision without follow-through.',
            },
        ],
        cups: [
            {
                keywords: ['love', 'new feelings', 'compassion', 'creativity'],
                upright: 'New love, compassion, and overflowing emotion; the heart opening to connection and creativity.',
                reversed: 'Emotional loss, blocked feelings, or emptiness; love held back or poured out without care.',
            },
            {
                keywords: ['partnership', 'unity', 'attraction', 'mutual respect'],
                upright: 'Partnership, mutual attraction, and unity; a balanced connection between two people.',
                reversed: 'Imbalance in a relationship, broken communication, or tension; a bond out of step.',
            },
            {
                keywords: ['friendship', 'celebration', 'community', 'joy'],
                upright: 'Friendship, celebration, and community; joy shared among those who support you.',
                reversed: 'Overindulgence, gossip, or isolation; a third party straining the circle.',
            },
            {
                keywords: ['apathy', 'contemplation', 'discontent', 'reevaluation'],
                upright: 'Apathy and contemplation; so focused on what is lacking that new offers go unseen.',
                reversed: 'Renewed awareness, accepting an offer, or a retreat ending; stepping out of withdrawal.',
            },
            {
                keywords: ['loss', 'grief', 'regret', 'disappointment'],
                upright: 'Loss, grief, and regret; mourning what spilled while overlooking what still stands.',
                reversed: 'Acceptance, moving on, and forgiveness; finding peace after disappointment.',
            },
            {
                keywords: ['nostalgia', 'memories', 'innocence', 'reunion'],
                upright: 'Nostalgia, happy memories, and innocence; kindness and reunion with the past.',
                reversed: 'Living in the past, rose-tinted nostalgia, or leaving childhood behind; moving forward.',
            },
            {
                keywords: ['choices', 'illusion', 'fantasy', 'wishful thinking'],
                upright: 'Many choices, fantasy, and illusion; options that dazzle but are not all they seem.',
                reversed: 'Clarity, making a choice, or a reality check; illusions dissolving into focus.',
            },
            {
                keywords: ['walking away', 'withdrawal', 'deeper meaning', 'disillusion'],
                upright: 'Walking away from what no longer fulfills; leaving the familiar behind to seek deeper meaning.',
                reversed: 'Fear of change, avoidance, or aimless drifting; staying too long or leaving without purpose.',
            },
            {
                keywords: ['contentment', 'satisfaction', 'wishes fulfilled', 'gratitude'],
                upright: 'Contentment, satisfaction, and a wish fulfilled; emotional and material comfort.',
                reversed: 'Smugness, dissatisfaction, or materialism; getting what you wanted but not what you needed.',
            },
            {
                keywords: ['harmony', 'family', 'happiness', 'emotional fulfillment'],
                upright: 'Emotional fulfillment, family harmony, and lasting happiness; love that feels like home.',
                reversed: 'A broken home, disconnection, or misaligned values; the ideal picture under strain.',
            },
            {
                keywords: ['creativity', 'intuition', 'curiosity', 'emotional message'],
                upright: 'Creative opportunity, intuitive messages, and curiosity; a gentle and open heart.',
                reversed: 'Emotional immaturity, creative block, or insecurity; feelings expressed awkwardly.',
            },
            {
                keywords: ['romance', 'charm', 'idealism', 'following the heart'],
                upright: 'Romance, charm, and following the heart; an invitation or offer carried with grace.',
                reversed: 'Moodiness, unrealistic ideals, or jealousy; promises that do not hold.',
            },
            {
                keywords: ['compassion', 'emotional security', 'intuition', 'care'],
                upright: 'Compassion, emotional security, and deep intuition; calm care that holds space for others.',
                reversed: 'Emotional insecurity, codependence, or martyrdom; giving too much and neglecting yourself.',
            },
            {
                keywords: ['emotional balance', 'diplomacy', 'generosity', 'calm'],
                upright: 'Emotional balance, diplomacy, and generous calm; mastery of feeling without being ruled by it.',
                reversed: 'Emotional manipulation, moodiness, or volatility; feelings repressed or used to control.',
            },
        ],
        swords: [
            {
                keywords: ['clarity', 'breakthrough', 'truth', 'new idea'],
                upright: 'Mental clarity, breakthrough, and truth; a new idea cuts through confusion.',
                reversed: 'Confusion, clouded judgment, or misuse of power; a truth distorted or an idea poorly executed.',
            },
            {
                keywords: ['indecision', 'stalemate', 'avoidance', 'difficult choice'],
                upright: 'Difficult choices and stalemate; blocking out information to avoid a decision.',
                reversed: 'Indecision breaking, information overload, or confusion; the blindfold beginning to slip.',
            },
            {
                keywords: ['heartbreak', 'grief', 'sorrow', 'painful truth'],
                upright: 'Heartbreak, sorrow, and painful truth; grief that must be felt in order to heal.',
                reversed: 'Recovery, forgiveness, and releasing pain; healing from heartbreak.',
            },
            {
                keywords: ['rest', 'recovery', 'contemplation', 'respite'],
                upright: 'Rest, recovery, and quiet contemplation; a necessary retreat to restore strength.',
                reversed: 'Restlessness, burnout, or a return to action; refusing rest or reawakening after it.',
            },
            {
                keywords: ['conflict', 'defeat', 'winning at all costs', 'tension'],
                upright: 'Conflict, defeat, and hollow victory; winning at any cost leaves damage behind.',
                reversed: 'Reconciliation, making amends, or lingering resentment; the desire to end conflict.',
            },
            {
                keywords: ['transition', 'moving on', 'leaving behind', 'rite of passage'],
                upright: 'Transition and moving on; leaving troubled waters behind for calmer shores.',
                reversed: 'Resistance to change, unfinished business, or a journey delayed; carrying old baggage.',
            },
            {
                keywords: ['deception', 'strategy', 'stealth', 'cunning'],
                upright: 'Deception, strategy, and stealth; acting alone or trying to get away with something.',
                reversed: 'Coming clean, a troubled conscience, or deception revealed; rethinking an approach.',
            },
            {
                keywords: ['restriction', 'entrapment', 'self-limiting beliefs', 'powerlessness'],
                upright: 'Restriction and self-imposed limitation; feeling trapped by beliefs rather than real bonds.',
                reversed: 'Release, new perspective, and self-acceptance; freeing yourself from limiting thoughts.',
            },
            {
                keywords: ['anxiety', 'worry', 'fear', 'nightmares'],
                upright: 'Anxiety, worry, and sleepless fear; the mind magnifying troubles in the dark.',
                reversed: 'Hope, reaching out, or despair easing; confronting inner turmoil or releasing worry.',
            },
            {
                keywords: ['painful ending', 'betrayal', 'rock bottom', 'loss'],
                upright: 'Painful endings, betrayal, and hitting rock bottom; the worst is over and dawn follows.',
                reversed: 'Recovery, regeneration, or resisting an inevitable end; slowly rising again.',
            },
            {
                keywords: ['curiosity', 'new ideas', 'communication', 'vigilance'],
                upright: 'Curiosity, new ideas, and a thirst for knowledge; alert and honest communication.',
                reversed: 'Gossip, deception, or all talk and no action; hasty speech or scattered thoughts.',
            },
            {
                keywords: ['ambition', 'action', 'drive', 'haste'],
                upright: 'Ambitious, fast-moving drive; charging toward a goal with sharp focus.',
                reversed: 'Recklessness, impatience, or aggression; acting without thinking or burning out.',
            },
            {
                keywords: ['independence', 'clear boundaries', 'perception', 'direct communication'],
                upright: 'Independent perception, clear boundaries, and direct communication; truth spoken with wisdom.',
                reversed: 'Coldness, bitterness, or cruelty; judgment clouded by emotion or words used as weapons.',
            },
            {
                keywords: ['intellect', 'authority', 'truth', 'clear thinking'],
                upright: 'Intellectual authority, truth, and clear thinking; decisions made with fairness and logic.',
                reversed: 'Manipulation, tyranny, or misuse of intellect; cold judgment or abuse of power.',
            },
        ],
        pentacles: [
            {
                keywords: ['opportunity', 'prosperity', 'new venture', 'manifestation'],
                upright: 'A new financial or material opportunity; prosperity and solid ground for something to grow.',
                reversed: 'A lost opportunity, poor planning, or scarcity; a promising start that fails to take root.',
            },
            {
                keywords: ['balance', 'adaptability', 'priorities', 'juggling'],
                upright: 'Juggling priorities with adaptability; balancing resources and time with a light touch.',
                reversed: 'Overcommitment, disorganization, or financial imbalance; too many things in the air.',
            },
            {
                keywords: ['teamwork', 'collaboration', 'skill', 'learning'],
                upright: 'Teamwork, collaboration, and skilled craftsmanship; building something together.',
                reversed: 'Disharmony, poor teamwork, or lack of effort; misaligned goals or skills left unrecognized.',
            },
            {
                keywords: ['security', 'control', 'conservation', 'possessiveness'],
                upright: 'Security, saving, and control; holding tightly to resources and stability.',
                reversed: 'Greed, materialism, or releasing control; overspending or learning to let go.',
            },
            {
                keywords: ['hardship', 'poverty', 'isolation', 'worry'],
                upright: 'Financial hardship, isolation, and worry; feeling left out in the cold while help is near.',
                reversed: 'Recovery from loss, spiritual renewal, or help accepted; the hard times ending.',
            },
            {
                keywords: ['generosity', 'charity', 'giving and receiving', 'sharing'],
                upright: 'Generosity, charity, and the balanced flow of giving and receiving.',
                reversed: 'Strings attached, debt, or one-sided charity; imbalance between who gives and who takes.',
            },
            {
                keywords: ['patience', 'long-term view', 'investment', 'assessment'],
                upright: 'Patience, long-term investment, and assessing progress; waiting for the harvest.',
                reversed: 'Impatience, poor returns, or wasted effort; questioning whether the work is worth it.',
            },
            {
                keywords: ['diligence', 'craftsmanship', 'mastery', 'dedication'],
                upright: 'Diligence, craftsmanship, and dedication; skill honed through focused repetition.',
                reversed: 'Perfectionism, lack of focus, or uninspired work; shortcuts taken or mastery neglected.',
            },
            {
                keywords: ['abundance', 'luxury', 'self-sufficiency', 'independence'],
                upright: 'Abundance, self-sufficiency, and refined independence; enjoying the fruits of your labor.',
                reversed: 'Overwork, financial setbacks, or superficial success; dependence or hollow luxury.',
            },
            {
                keywords: ['wealth', 'legacy', 'family', 'long-term security'],
                upright: 'Wealth, family legacy, and lasting security; prosperity shared across generations.',
                reversed: 'Family disputes, financial loss, or fleeting success; a legacy under strain.',
            },
            {
                keywords: ['ambition', 'diligence', 'study', 'new opportunity'],
                upright: 'A studious beginning and practical ambition; news of a tangible opportunity.',
                reversed: 'Lack of progress, procrastination, or missed chances; learning without applying it.',
            },
            {
                keywords: ['efficiency', 'routine', 'reliability', 'hard work'],
                upright: 'Steady efficiency, reliability, and methodical hard work; progress through routine.',
                reversed: 'Laziness, boredom, or stubbornness; feeling stuck or obsessing over details.',
            },
            {
                keywords: ['nurturing', 'practicality', 'abundance', 'groundedness'],
                upright: 'Practical nurturing, abundance, and down-to-earth care; providing comfort and security.',
                reversed: 'Self-neglect, imbalance between work and home, or smothering; financial worry or insecurity.',
            },
            {
                keywords: ['wealth', 'business', 'security', 'discipline'],
                upright: 'Wealth, business acumen, and disciplined security; a reliable provider and leader.',
                reversed: 'Greed, stubbornness, or obsession with status; financial mismanagement or rigid control.',
            },
        ],
    };

    const buildCard = (fields) => ({
        ...fields,
        keywords: [...fields.keywords],
        image: `${IMAGE_ROOT}${fields.slug}.png`,
    });

    const majorCards = MAJOR_ARCANA.map((entry, index) => buildCard({
        slug: `major-${pad2(index)}-${entry.key}`,
        name: entry.name,
        arcana: 'major',
        suit: null,
        number: index,
        rank: null,
        keywords: entry.keywords,
        uprightMeaning: entry.upright,
        reversedMeaning: entry.reversed,
    }));

    const minorCards = SUITS.flatMap((suit) => RANKS.map((rank, index) => {
        const meaning = MINOR_MEANINGS[suit.id][index];
        const number = index + 1;

        return buildCard({
            slug: `${suit.id}-${pad2(number)}-${rank.id}`,
            name: `${rank.name} of ${suit.name}`,
            arcana: 'minor',
            suit: suit.id,
            number,
            rank: rank.id,
            keywords: meaning.keywords,
            uprightMeaning: meaning.upright,
            reversedMeaning: meaning.reversed,
        });
    }));

    const TAROT_CARDS = deepFreeze([...majorCards, ...minorCards]);

    // Spread setups. Each position carries a CSS-grid layout hint: 1-based
    // row/col inside the spread's grid; rotate (degrees) marks crossing cards.
    const TAROT_SPREADS = deepFreeze([
        {
            id: 'single-card',
            name: 'Card of the Day',
            description: 'Draw one card for a focused message or theme to carry through the day.',
            grid: { rows: 1, cols: 1 },
            positions: [
                {
                    id: 'card-of-the-day',
                    name: 'Card of the Day',
                    positionMeaning: 'This card names the central energy, lesson, or theme to carry through today.',
                    readingPrompt: 'Let it guide your attention and choices over the day ahead.',
                    layout: { row: 1, col: 1, rotate: 0 },
                },
            ],
        },
        {
            id: 'three-card',
            name: 'Past, Present, Future',
            description: 'A simple three-card line tracing how a situation came to be, where it stands, and where it is heading.',
            grid: { rows: 1, cols: 3 },
            positions: [
                {
                    id: 'past',
                    name: 'Past',
                    positionMeaning: 'This position shows the influences and events behind you that shaped the situation.',
                    readingPrompt: 'Consider how this has brought you to where you stand now.',
                    layout: { row: 1, col: 1, rotate: 0 },
                },
                {
                    id: 'present',
                    name: 'Present',
                    positionMeaning: 'This position shows the heart of the situation as it stands right now.',
                    readingPrompt: 'This is the energy most active in your life at this moment.',
                    layout: { row: 1, col: 2, rotate: 0 },
                },
                {
                    id: 'future',
                    name: 'Future',
                    positionMeaning: 'This position shows the likely direction if the current path continues.',
                    readingPrompt: 'Treat it as a trajectory rather than a fixed fate; your choices still shape it.',
                    layout: { row: 1, col: 3, rotate: 0 },
                },
            ],
        },
        {
            id: 'horseshoe',
            name: 'Horseshoe',
            description: 'Seven cards laid in an open arc to explore a question from its roots through obstacles and advice to a likely outcome.',
            grid: { rows: 4, cols: 7 },
            positions: [
                {
                    id: 'past',
                    name: 'Past',
                    positionMeaning: 'This position shows past events and influences that bear on the question.',
                    readingPrompt: 'Consider what lingers from before and how it colors the present.',
                    layout: { row: 1, col: 1, rotate: 0 },
                },
                {
                    id: 'present',
                    name: 'Present',
                    positionMeaning: 'This position shows the current circumstances surrounding the question.',
                    readingPrompt: 'This is where things stand today.',
                    layout: { row: 2, col: 2, rotate: 0 },
                },
                {
                    id: 'hidden-influences',
                    name: 'Hidden Influences',
                    positionMeaning: 'This position reveals factors working beneath the surface that you may not see.',
                    readingPrompt: 'Look for what is unspoken, unnoticed, or not yet understood.',
                    layout: { row: 3, col: 3, rotate: 0 },
                },
                {
                    id: 'obstacles',
                    name: 'Obstacles',
                    positionMeaning: 'This position shows the main challenge or block standing in your way.',
                    readingPrompt: 'Naming this obstacle is the first step to moving past it.',
                    layout: { row: 4, col: 4, rotate: 0 },
                },
                {
                    id: 'outside-influences',
                    name: 'Outside Influences',
                    positionMeaning: 'This position shows the people, environment, and forces around you that affect the matter.',
                    readingPrompt: 'Consider which of these influences you can lean on and which you should guard against.',
                    layout: { row: 3, col: 5, rotate: 0 },
                },
                {
                    id: 'advice',
                    name: 'Advice',
                    positionMeaning: 'This position offers guidance on the best approach to take.',
                    readingPrompt: 'Apply this counsel to how you act next.',
                    layout: { row: 2, col: 6, rotate: 0 },
                },
                {
                    id: 'outcome',
                    name: 'Outcome',
                    positionMeaning: 'This position shows the most likely outcome if you follow the path the spread describes.',
                    readingPrompt: 'Weigh it against the advice card; the outcome can shift as you do.',
                    layout: { row: 1, col: 7, rotate: 0 },
                },
            ],
        },
        {
            id: 'celtic-cross',
            name: 'Celtic Cross',
            description: 'The classic ten-card spread: a six-card cross examining the situation and a four-card staff examining you, your surroundings, and the outcome.',
            grid: { rows: 4, cols: 4 },
            positions: [
                {
                    id: 'present',
                    name: 'The Present',
                    positionMeaning: 'This card covers you and represents the heart of the matter as it stands now.',
                    readingPrompt: 'Everything else in the spread revolves around this energy.',
                    layout: { row: 2, col: 2, rotate: 0 },
                },
                {
                    id: 'challenge',
                    name: 'The Challenge',
                    positionMeaning: 'This card crosses you and shows the immediate obstacle or opposing force.',
                    readingPrompt: 'This is the tension you must work with or through.',
                    layout: { row: 2, col: 2, rotate: 90 },
                },
                {
                    id: 'foundation',
                    name: 'The Foundation',
                    positionMeaning: 'This card lies beneath you and shows the root cause or unconscious basis of the situation.',
                    readingPrompt: 'Consider how this deeper layer drives what is happening above it.',
                    layout: { row: 3, col: 2, rotate: 0 },
                },
                {
                    id: 'recent-past',
                    name: 'The Recent Past',
                    positionMeaning: 'This card lies behind you and shows events that are passing away.',
                    readingPrompt: 'Its influence is fading but still shapes the present.',
                    layout: { row: 2, col: 1, rotate: 0 },
                },
                {
                    id: 'crown',
                    name: 'The Crown',
                    positionMeaning: 'This card crowns you and shows your conscious goal or the best that can be achieved.',
                    readingPrompt: 'Hold this as the aim or ideal you are reaching toward.',
                    layout: { row: 1, col: 2, rotate: 0 },
                },
                {
                    id: 'near-future',
                    name: 'The Near Future',
                    positionMeaning: 'This card lies before you and shows what is approaching in the coming weeks.',
                    readingPrompt: 'Prepare for this energy as it moves into your life.',
                    layout: { row: 2, col: 3, rotate: 0 },
                },
                {
                    id: 'self',
                    name: 'Yourself',
                    positionMeaning: 'This card shows your own attitude, position, and approach to the situation.',
                    readingPrompt: 'Reflect honestly on how you are showing up.',
                    layout: { row: 4, col: 4, rotate: 0 },
                },
                {
                    id: 'environment',
                    name: 'Environment',
                    positionMeaning: 'This card shows the influence of the people and surroundings around you.',
                    readingPrompt: 'Consider how others see the matter and how they affect it.',
                    layout: { row: 3, col: 4, rotate: 0 },
                },
                {
                    id: 'hopes-and-fears',
                    name: 'Hopes and Fears',
                    positionMeaning: 'This card shows what you hope for, what you fear, and how the two may be intertwined.',
                    readingPrompt: 'Notice whether this is something you long for, something you dread, or both.',
                    layout: { row: 2, col: 4, rotate: 0 },
                },
                {
                    id: 'outcome',
                    name: 'The Outcome',
                    positionMeaning: 'This card shows the culmination of all the influences in the spread.',
                    readingPrompt: 'This is where the current path leads if nothing changes.',
                    layout: { row: 1, col: 4, rotate: 0 },
                },
            ],
        },
    ]);

    // Orientation framing used by the meaning map.
    const TAROT_ORIENTATIONS = deepFreeze({
        upright: {
            id: 'upright',
            label: 'Upright',
            lead: 'Upright, its energy flows openly:',
        },
        reversed: {
            id: 'reversed',
            label: 'Reversed',
            lead: 'Reversed, its energy is blocked, delayed, or turned inward:',
        },
    });

    const cardsBySlug = new Map(TAROT_CARDS.map((card) => [card.slug, card]));
    const spreadsById = new Map(TAROT_SPREADS.map((spread) => [spread.id, spread]));

    const getCard = (slug) => cardsBySlug.get(slug) || null;

    const getSpread = (spreadId) => spreadsById.get(spreadId) || null;

    const getPosition = (spreadId, positionId) => {
        const spread = getSpread(spreadId);

        return spread ? spread.positions.find((position) => position.id === positionId) || null : null;
    };

    const normalizeOrientation = (orientation) => (
        orientation === true || (typeof orientation === 'string' && orientation.trim().toLowerCase() === 'reversed')
            ? 'reversed'
            : 'upright'
    );

    // Pure helper: composes position context with the card's upright or
    // reversed meaning. Returns '' only for an unknown card, spread, or position.
    const tarotMeaningFor = (cardSlug, spreadId, positionId, orientation) => {
        const card = getCard(cardSlug);
        const position = getPosition(spreadId, positionId);

        if (!card || !position) {
            return '';
        }

        const orientationKey = normalizeOrientation(orientation);
        const frame = TAROT_ORIENTATIONS[orientationKey];
        const meaning = orientationKey === 'reversed' ? card.reversedMeaning : card.uprightMeaning;

        return `${frame.lead} ${meaning} ${position.readingPrompt}`;
    };

    // Builds the full map { [positionId]: { [slug]: { upright, reversed } } }
    // for a spread, or for every spread keyed by spread id when omitted.
    const buildMeaningMap = (spreadId) => {
        const buildForSpread = (spread) => Object.fromEntries(spread.positions.map((position) => [
            position.id,
            Object.fromEntries(TAROT_CARDS.map((card) => [card.slug, {
                upright: tarotMeaningFor(card.slug, spread.id, position.id, 'upright'),
                reversed: tarotMeaningFor(card.slug, spread.id, position.id, 'reversed'),
            }])),
        ]));

        if (spreadId !== undefined) {
            const spread = getSpread(spreadId);

            return spread ? buildForSpread(spread) : {};
        }

        return Object.fromEntries(TAROT_SPREADS.map((spread) => [spread.id, buildForSpread(spread)]));
    };

    window.TarotData = Object.freeze({
        IMAGE_ROOT,
        CARD_BACK_IMAGE,
        TAROT_SUITS: deepFreeze(SUITS.map((suit) => ({ ...suit }))),
        TAROT_RANKS: deepFreeze(RANKS.map((rank, index) => ({ ...rank, number: index + 1 }))),
        TAROT_CARDS,
        TAROT_SPREADS,
        TAROT_ORIENTATIONS,
        getCard,
        getSpread,
        getPosition,
        tarotMeaningFor,
        buildMeaningMap,
    });
})();
