<?php

declare(strict_types=1);

$year = gmdate('Y');
$pageTitle = 'Crabs - wowiekowie.com';
$metaDescription = 'The fictional Florida crab takeover, true crab facts, and a darker universe where an endless high tide brings the end of the world.';
$pageStyles = ['/assets/css/crabs.css'];
$crabFactGroups = [
    [
        'title' => 'Size records',
        'facts' => [
            [
                'text' => 'The Japanese spider crab has the longest legs of any crab: the largest specimen listed by Guinness spanned about 3.7 m (12 ft), roughly twice the height of an adult human, and weighed 18.6 kg (41 lb).',
                'source' => 'https://www.guinnessworldrecords.com/world-records/70875-longest-marine-crustacean',
            ],
            [
                'text' => 'Japanese spider crabs may live up to 100 years.',
                'source' => 'https://www.nationalgeographic.com/animals/invertebrates/facts/japanese-spider-crab',
            ],
            [
                'text' => 'The coconut crab is the largest crustacean living on land, reaching about 40 cm long, about 0.9 m from leg tip to leg tip, and about 4.1 kg (9 lb). It is a shell-less relative of hermit crabs, not a true crab.',
                'source' => 'https://en.wikipedia.org/wiki/Coconut_crab',
            ],
            [
                'text' => 'The strongest measured pinch among 29 wild coconut crabs was 1,765.2 newtons. Scientists estimate that a 4 kg coconut crab could pinch with about 3,300 newtons; that larger figure is an estimate, not a measurement, and coconut crabs are not true crabs.',
                'source' => 'https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0166108',
            ],
            [
                'text' => 'The Tasmanian giant crab can reach 17.6 kg (39 lb), with a shell up to 46 cm (18 in) wide. Males grow to more than twice the size of females, which do not exceed 7 kg.',
                'source' => 'https://en.wikipedia.org/wiki/Tasmanian_giant_crab',
            ],
        ],
    ],
    [
        'title' => 'Bodies and senses',
        'facts' => [
            [
                'text' => 'Crabs can shuffle forward slowly, but their simple hinge-like leg joints and wide, flat bodies make sideways travel much faster.',
                'source' => 'https://www.sciencefocus.com/nature/why-do-crabs-walk-sideways',
            ],
            [
                'text' => 'Adult female Tasmanian giant crabs molt only about once every nine years. Because they can mate only just after molting, this limits how often they breed.',
                'source' => 'https://en.wikipedia.org/wiki/Tasmanian_giant_crab',
            ],
            [
                'text' => 'A stone crab can deliberately drop a damaged leg or claw and regrow it. The replacement starts smaller and takes about three molts to regain most of its size.',
                'source' => 'https://myfwc.com/research/saltwater/crustaceans/stone-crabs/faq/',
            ],
            [
                'text' => 'Crustaceans can have blue blood because they carry oxygen with hemocyanin, a copper-containing protein that is colourless until it binds oxygen and turns blue.',
                'source' => 'https://www.nationalgeographic.com/animals/article/animal-blood-comes-in-a-rainbow-of-colors',
            ],
            [
                'text' => 'Adult coconut crabs breathe air with special branchiostegal lungs and can drown if kept underwater. Coconut crabs are not true crabs.',
                'source' => 'https://en.wikipedia.org/wiki/Coconut_crab',
            ],
            [
                'text' => 'Coconut crabs have a keen sense of smell for finding food, and their smell organs evolved to resemble those of insects. They are not true crabs.',
                'source' => 'https://en.wikipedia.org/wiki/Coconut_crab',
            ],
        ],
    ],
    [
        'title' => 'Behaviour',
        'facts' => [
            [
                'text' => 'Tens of millions of red crabs march from forest to coast on Christmas Island after the first wet-season rain. Each female can release up to 100,000 eggs into the sea.',
                'source' => 'https://christmasislandnationalpark.gov.au/news/millions-of-crabs-march-on-christmas-island/',
            ],
            [
                'text' => 'Decorator crabs fasten algae, sponges, and anemones to hooked bristles that work a little like Velcro. After molting, they move favourite decorations to the new shell.',
                'source' => 'https://oceana.org/marine-life/decorator-crab/',
            ],
            [
                'text' => 'Boxer crabs hold a sea anemone in each claw. If one is lost, a crab can split the remaining anemone in two, and both pieces regrow into identical clones.',
                'source' => 'https://www.eurekalert.org/news-releases/673859',
            ],
            [
                'text' => 'Male fiddler crabs have one large and one small claw, while females have equal-sized claws. A male waves his large claw beside his burrow to attract a female.',
                'source' => 'https://www.nps.gov/pais/learn/nature/fiddlercrab.htm',
            ],
            [
                'text' => 'Hermit crabs in Belize have formed groups of up to 20 around a shell that was too large, lined up from largest to smallest, and swapped shells in rapid sequence. Hermit crabs are not true crabs.',
                'source' => 'https://www.scientificamerican.com/article/vacancy-hermit-crab-social-networks/',
            ],
        ],
    ],
    [
        'title' => 'Evolution and oddities',
        'facts' => [
            [
                'text' => 'Evolution has produced the crab body shape at least five separate times in true crabs and crab-like relatives. This repeated trend is called carcinization.',
                'source' => 'https://www.eurekalert.org/news-releases/509499',
            ],
            [
                'text' => 'Evolution can also lose the crab body plan, a process called decarcinization. King crabs look like crabs but are false crabs, not true crabs.',
                'source' => 'https://www.scientificamerican.com/article/why-do-animals-keep-evolving-into-crabs/',
            ],
            [
                'text' => 'The yeti crab Kiwa puravida farms bacteria on its hairy arms as its main food, waving its claws in a way that may help the bacteria grow before harvesting them with its mouthparts. Yeti crabs are not true crabs.',
                'source' => 'https://pmc.ncbi.nlm.nih.gov/articles/PMC3227565',
            ],
            [
                'text' => 'The smallest crabs are parasitic pea crabs, some measuring no more than 6.3 mm across. They live inside molluscs such as oysters and mussels.',
                'source' => 'https://www.guinnessworldrecords.com/world-records/112630-smallest-crab',
            ],
        ],
    ],
];
require dirname(__DIR__) . '/partials/head.php';
?>
<body>
    <div class="page-shell">
        <?php require dirname(__DIR__) . '/partials/header.php'; ?>

        <main>
            <section class="hero hero-compact" aria-labelledby="crabs-title">
                <p class="eyebrow">Shell shock</p>
                <h1 id="crabs-title">The crabs have taken Florida.</h1>
                <p class="lede">Large, sentient, and extremely organized. The Sunshine State is now a claw-run territory.</p>
                <div class="hero-actions">
                    <a class="button" href="#crab-dark-universe">Descend into the darker side</a>
                </div>
            </section>

            <section class="foundation" aria-labelledby="crabs-story-title">
                <div class="section-heading">
                    <p class="eyebrow">How it happened</p>
                    <h2 id="crabs-story-title">A very pinchy takeover.</h2>
                </div>

                <div class="feature-grid">
                    <article>
                        <h3>The landing</h3>
                        <p>They rose out of the Gulf at low tide, each one the size of a pickup truck, and politely asked to speak to the manager of the beach.</p>
                    </article>
                    <article>
                        <h3>The council</h3>
                        <p>By morning the crabs had seized every boardwalk, formed a governing council, and declared sideways the only legal direction of travel.</p>
                    </article>
                    <article>
                        <h3>The new order</h3>
                        <p>Theme parks now run on shell time, the swamps belong to the molting class, and tourists are welcome so long as they bring snacks.</p>
                    </article>
                </div>
            </section>

            <section class="foundation crab-gallery-section" aria-labelledby="crab-gallery-title">
                <div class="section-heading">
                    <p class="eyebrow">Takeover sightings</p>
                    <h2 id="crab-gallery-title">Florida, now with considerably more crab.</h2>
                </div>
                <p class="lede">These are imagined illustrations from the takeover story, not photos, because no real crab's body is larger than a person.</p>

                <div class="crab-gallery">
                    <figure class="crab-gallery-item">
                        <img src="/assets/img/crabs/crab-beach-lifeguard.png" alt="A towering crab leans down to a lifeguard on a Gulf beach at low tide." loading="lazy" decoding="async">
                        <figcaption>The lifeguard has updated the flag system to include “absolutely enormous crab.”</figcaption>
                    </figure>
                    <figure class="crab-gallery-item">
                        <img src="/assets/img/crabs/crab-boardwalk-council.png" alt="A council of giant crabs gathers on a seaside boardwalk while small people look up." loading="lazy" decoding="async">
                        <figcaption>The boardwalk council opens the floor, then declares the floor crab territory.</figcaption>
                    </figure>
                    <figure class="crab-gallery-item">
                        <img src="/assets/img/crabs/crab-theme-park-gate.png" alt="A giant crab at a theme park gate dwarfs the line of visitors." loading="lazy" decoding="async">
                        <figcaption>Park admission is one snack, exact change preferred.</figcaption>
                    </figure>
                    <figure class="crab-gallery-item">
                        <img src="/assets/img/crabs/crab-everglades-airboat.png" alt="A giant crab rises from an Everglades swamp over a small airboat." loading="lazy" decoding="async">
                        <figcaption>The airboat tour has encountered a much larger form of local transit.</figcaption>
                    </figure>
                    <figure class="crab-gallery-item">
                        <img src="/assets/img/crabs/crab-highway-crossing.png" alt="A giant crab walks sideways across a highway while a road worker holds traffic." loading="lazy" decoding="async">
                        <figcaption>Traffic will resume once the new government finishes crossing sideways.</figcaption>
                    </figure>
                    <figure class="crab-gallery-item">
                        <img src="/assets/img/crabs/crab-tourist-snacks.png" alt="Tourists hold snacks up to a huge, polite crab on a beach." loading="lazy" decoding="async">
                        <figcaption>The tourists remembered tribute, so everyone gets to keep their beach chairs.</figcaption>
                    </figure>
                </div>
            </section>

            <section class="foundation crab-facts-section" aria-labelledby="crab-facts-title">
                <div class="section-heading">
                    <p class="eyebrow">True crab facts</p>
                    <h2 id="crab-facts-title">The real world is already wonderfully crabby.</h2>
                </div>
                <p class="lede">The Florida takeover above is make-believe. Every fact below comes from the decidedly strange real world.</p>

                <div class="crab-fact-groups">
                    <?php foreach ($crabFactGroups as $groupIndex => $group): ?>
                        <section class="crab-fact-group" aria-labelledby="crab-fact-group-<?= htmlspecialchars((string) $groupIndex, ENT_QUOTES, 'UTF-8') ?>">
                            <h3 id="crab-fact-group-<?= htmlspecialchars((string) $groupIndex, ENT_QUOTES, 'UTF-8') ?>"><?= htmlspecialchars($group['title'], ENT_QUOTES, 'UTF-8') ?></h3>
                            <div class="crab-fact-grid">
                                <?php foreach ($group['facts'] as $fact): ?>
                                    <article class="crab-fact">
                                        <p><?= htmlspecialchars($fact['text'], ENT_QUOTES, 'UTF-8') ?></p>
                                        <a class="crab-fact-source" href="<?= htmlspecialchars($fact['source'], ENT_QUOTES, 'UTF-8') ?>" target="_blank" rel="noopener noreferrer">Source<span class="visually-hidden"> for this crab fact</span></a>
                                    </article>
                                <?php endforeach; ?>
                            </div>
                        </section>
                    <?php endforeach; ?>
                </div>
            </section>

            <section class="bio-section" aria-labelledby="crab-notes-title">
                <div class="section-heading">
                    <p class="eyebrow">Field notes</p>
                    <h2 id="crab-notes-title">A small salute to the ocean's finest little weirdos.</h2>
                </div>
                <p class="lede">Crabs bring strong claws, excellent hats, and the quiet confidence to scuttle wherever the day takes them.</p>
                <p class="aside">Today's crab wisdom: when forward feels overrated, sideways still counts.</p>
            </section>

            <section id="crab-dark-universe" class="foundation crab-dark-universe" aria-labelledby="crab-dark-title">
                <div class="section-heading">
                    <p class="eyebrow">The darker side</p>
                    <h2 id="crab-dark-title">The tide that never went out.</h2>
                </div>
                <p class="lede"><strong>Fictional horror:</strong> this separate timeline contains graphic violence and the end of the world.</p>

                <div class="crab-dark-story">
                    <article>
                        <h3>The arrival</h3>
                        <p>The high tide arrived beneath a moonless sky and kept climbing after every clock said it should turn. Shapes moved under the black water, first by the hundreds and then beyond counting. When the first crabs hauled themselves onto the seawall, they were taller than the streetlights, armored in weed and rust, and they did not ask for the manager. Behind them, the ocean continued inland.</p>
                    </article>
                    <article>
                        <h3>The breaking</h3>
                        <p>By dawn, the avenues had become channels. The crabs tore people apart wherever crowds jammed against locked doors, their claws striking with the sound of trees splitting in a storm. Sirens vanished beneath the scraping of shells against concrete. Those who escaped the first assault watched the water carry away every place where safety had once seemed certain.</p>
                    </article>
                    <article>
                        <h3>The failed evacuation</h3>
                        <p>The last evacuation convoy turned toward higher ground, but every road ended in the same advancing tide. Engines drowned. Rescue boats found the current running backward, drawing them toward a moving wall of claws. Radio voices counted shelters going silent until only static remained, and the survivors understood that there was nowhere left to flee.</p>
                    </article>
                    <article>
                        <h3>The high tide mess</h3>
                        <p>The high tide never went out. It crossed mountains, swallowed the final lights, and left the world ending in a high tide mess of broken towers, drifting roofs, and red shells moving beneath the waves. At the end there was no shore, no morning traffic, no dry land at all&mdash;only a dark ocean circling the planet and the slow percussion of claws below.</p>
                    </article>
                </div>

                <section class="crab-dark-gallery-section" aria-labelledby="crab-dark-gallery-title">
                    <h3 id="crab-dark-gallery-title">What the last witnesses saw.</h3>
                    <p class="lede">These are imagined illustrations from the dark story, not photos.</p>

                    <div class="crab-gallery crab-dark-gallery">
                        <figure class="crab-gallery-item">
                            <img src="/assets/img/crabs/crab-dark-high-tide-surge.png" alt="A black tide breaks over a Gulf Coast town at night as giant crabs ride the surge and people flee." loading="lazy" decoding="async">
                            <figcaption>The tide came ashore carrying an army, and every street became an escape route that ended at the water.</figcaption>
                        </figure>
                        <figure class="crab-gallery-item">
                            <img src="/assets/img/crabs/crab-dark-boardwalk-massacre.png" alt="Giant crabs overrun a flooded boardwalk while people flee through the dark water." loading="lazy" decoding="async">
                            <figcaption>The boardwalk lights stayed on long enough to show the survivors what was hunting them.</figcaption>
                        </figure>
                        <figure class="crab-gallery-item">
                            <img src="/assets/img/crabs/crab-dark-highway-evacuation.png" alt="Giant crabs rip into cars trapped on a gridlocked evacuation highway at night." loading="lazy" decoding="async">
                            <figcaption>The evacuation stopped where the traffic did, beneath claws strong enough to open every locked door.</figcaption>
                        </figure>
                        <figure class="crab-gallery-item">
                            <img src="/assets/img/crabs/crab-dark-theme-park-flood.png" alt="Giant crabs hunt survivors through a flooded amusement park beside a half-sunk Ferris wheel." loading="lazy" decoding="async">
                            <figcaption>The drowned midway played its final music while shapes moved between the rides.</figcaption>
                        </figure>
                        <figure class="crab-gallery-item">
                            <img src="/assets/img/crabs/crab-dark-drowned-city.png" alt="Enormous crab claws reach for people in the water between the towers of a flooded city." loading="lazy" decoding="async">
                            <figcaption>The city disappeared floor by floor, and the claws below chose who vanished next.</figcaption>
                        </figure>
                        <figure class="crab-gallery-item">
                            <img src="/assets/img/crabs/crab-dark-last-shore.png" alt="A lone survivor stands on the last strip of land, ringed by crabs before a black tide and blood-red sky." loading="lazy" decoding="async">
                            <figcaption>At the last shore, the final survivor watched the black tide close over the world.</figcaption>
                        </figure>
                    </div>
                </section>
            </section>
        </main>

        <?php require dirname(__DIR__) . '/partials/footer.php'; ?>
    </div>
</body>
</html>
