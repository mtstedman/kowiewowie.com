<?php

declare(strict_types=1);

$year = gmdate('Y');
$musicFile = __DIR__ . '/../data/music.json';
$musicJson = is_readable($musicFile) ? file_get_contents($musicFile) : false;
$decodedSongs = is_string($musicJson) ? json_decode($musicJson, true) : null;
$songs = is_array($decodedSongs) ? $decodedSongs : [];
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="A simple list of songs liked by wowiekowie.com.">
    <title>Music - wowiekowie.com</title>
    <link rel="stylesheet" href="/assets/styles.css">
</head>
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

                <?php if ($songs === []): ?>
                    <p>No songs have been added yet.</p>
                <?php else: ?>
                    <div class="feature-grid">
                        <?php foreach ($songs as $song): ?>
                            <?php
                            $song = is_array($song) ? $song : [];
                            $title = isset($song['title']) && is_string($song['title']) && $song['title'] !== ''
                                ? $song['title']
                                : 'Untitled song';
                            $artist = isset($song['artist']) && is_string($song['artist']) && $song['artist'] !== ''
                                ? $song['artist']
                                : 'Unknown artist';
                            $spotifyUrl = isset($song['spotify_url']) && is_string($song['spotify_url'])
                                ? $song['spotify_url']
                                : '';
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
            </section>
        </main>

        <?php include __DIR__ . '/../partials/footer.php'; ?>
    </div>
</body>
</html>
