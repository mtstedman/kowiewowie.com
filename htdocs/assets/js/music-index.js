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
