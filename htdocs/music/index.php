<?php

declare(strict_types=1);

$year = gmdate('Y');

function load_music(): array
{
    $musicPath = __DIR__ . '/../data/music.json';
    if (!is_file($musicPath)) {
        return [];
    }

    $musicJson = file_get_contents($musicPath);
    if ($musicJson === false) {
        return [];
    }

    $songs = json_decode($musicJson, true);
    return is_array($songs) ? $songs : [];
}

$songs = load_music();
$pageTitle = 'Music - wowiekowie.com';
$metaDescription = 'A simple list of songs liked by wowiekowie.com.';
require __DIR__ . '/../partials/head.php';
?>
<body>
    <div class="page-shell">
        <?php include __DIR__ . '/../partials/header.php'; ?>

        <main>
            <section class="hero hero-compact">
                <p class="eyebrow">Music</p>
                <h1>Liked songs</h1>
                <p class="lede">A short list of tracks worth keeping nearby.</p>
            </section>

            <section class="foundation" aria-labelledby="music-title">
                <div class="section-heading">
                    <p class="eyebrow">Now playing elsewhere</p>
                    <h2 id="music-title">Songs list</h2>
                </div>

                <div id="music-list" aria-live="polite">
                    <?php if ($songs === []): ?>
                        <p>No songs have been added yet.</p>
                    <?php else: ?>
                        <div class="feature-grid">
                            <?php foreach ($songs as $song): ?>
                                <?php
                                $safeSong = is_array($song) ? $song : [];
                                $title = isset($safeSong['title']) && is_string($safeSong['title']) && $safeSong['title'] !== '' ? $safeSong['title'] : 'Untitled song';
                                $artist = isset($safeSong['artist']) && is_string($safeSong['artist']) && $safeSong['artist'] !== '' ? $safeSong['artist'] : 'Unknown artist';
                                $spotifyUrl = isset($safeSong['spotify_url']) && is_string($safeSong['spotify_url']) ? $safeSong['spotify_url'] : '';
                                ?>
                                <article>
                                    <h3><?= htmlspecialchars($title, ENT_QUOTES, 'UTF-8') ?></h3>
                                    <p><?= htmlspecialchars($artist, ENT_QUOTES, 'UTF-8') ?></p>
                                    <?php if ($spotifyUrl !== ''): ?>
                                        <a class="text-link" href="<?= htmlspecialchars($spotifyUrl, ENT_QUOTES, 'UTF-8') ?>" rel="noopener noreferrer" target="_blank">Listen on Spotify <span aria-hidden="true">&nearr;</span></a>
                                    <?php endif; ?>
                                </article>
                            <?php endforeach; ?>
                        </div>
                    <?php endif; ?>
                </div>
            </section>
        </main>

        <?php include __DIR__ . '/../partials/footer.php'; ?>
    </div>
</body>
</html>
