<?php

declare(strict_types=1);

$year = gmdate('Y');
$pageTitle = 'Music - wowiekowie.com';
$metaDescription = 'A simple list of songs liked by wowiekowie.com.';
?>
<?php include __DIR__ . '/../partials/head.php'; ?>
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
                    <p>Loading songs...</p>
                </div>
            </section>
        </main>

        <?php include __DIR__ . '/../partials/footer.php'; ?>
    </div>

    <script>
        const musicList = document.getElementById('music-list');

        const createSongCard = (song) => {
            const safeSong = song && typeof song === 'object' ? song : {};
            const title = typeof safeSong.title === 'string' && safeSong.title !== ''
                ? safeSong.title
                : 'Untitled song';
            const artist = typeof safeSong.artist === 'string' && safeSong.artist !== ''
                ? safeSong.artist
                : 'Unknown artist';
            const spotifyUrl = typeof safeSong.spotify_url === 'string'
                ? safeSong.spotify_url
                : '';

            const article = document.createElement('article');
            const heading = document.createElement('h3');
            const artistText = document.createElement('p');

            heading.textContent = title;
            artistText.textContent = artist;
            article.append(heading, artistText);

            if (spotifyUrl !== '') {
                const link = document.createElement('a');
                const icon = document.createElement('span');

                link.className = 'text-link';
                link.href = spotifyUrl;
                link.rel = 'noopener noreferrer';
                link.target = '_blank';
                link.append('Listen on Spotify ');

                icon.setAttribute('aria-hidden', 'true');
                icon.innerHTML = '&nearr;';
                link.append(icon);
                article.append(link);
            }

            return article;
        };

        const renderSongs = (songs) => {
            musicList.replaceChildren();

            if (songs.length === 0) {
                const emptyMessage = document.createElement('p');
                emptyMessage.textContent = 'No songs have been added yet.';
                musicList.append(emptyMessage);
                return;
            }

            const grid = document.createElement('div');
            grid.className = 'feature-grid';
            songs.forEach((song) => grid.append(createSongCard(song)));
            musicList.append(grid);
        };

        const renderError = () => {
            const message = document.createElement('p');
            message.textContent = 'Unable to load songs right now.';
            musicList.replaceChildren(message);
        };

        fetch('/api/music')
            .then((response) => {
                if (!response.ok) {
                    throw new Error('Music request failed');
                }

                return response.json();
            })
            .then((songs) => {
                if (!Array.isArray(songs)) {
                    throw new Error('Music response was not a list');
                }

                renderSongs(songs);
            })
            .catch(renderError);
    </script>
</body>
</html>
