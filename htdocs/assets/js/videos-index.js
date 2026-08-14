(() => {
    const results = document.getElementById('videos-results');
    const filters = document.getElementById('videos-filters');
    const searchInput = document.getElementById('videos-search');
    const resultsStatus = document.getElementById('videos-results-status');

    if (!(results instanceof HTMLElement)
        || !(filters instanceof HTMLElement)
        || !(searchInput instanceof HTMLInputElement)
        || !(resultsStatus instanceof HTMLElement)) {
        return;
    }

    const numberFormatter = new Intl.NumberFormat('en-US');
    const relativeFormatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
    const unpublishedStatuses = new Set(['draft', 'private', 'scheduled', 'unpublished']);
    const youtubeIdPattern = /^[A-Za-z0-9_-]{11}$/;

    let allVideos = [];
    let selectedTopic = 'All';
    let activeQuery = '';

    const readText = (value) => typeof value === 'string' ? value.trim() : '';
    const setStatus = (message) => {
        resultsStatus.textContent = message;
    };

    const normalizeCount = (value) => {
        if (typeof value === 'number' && Number.isFinite(value)) {
            return Math.max(0, Math.trunc(value));
        }

        const parsed = Number.parseInt(String(value ?? ''), 10);
        return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    };

    const getPublishedDate = (video) => {
        const rawValue = video && typeof video === 'object'
            ? (video.published_at ?? video.publishedAt ?? video.created_at ?? video.createdAt)
            : null;

        if (typeof rawValue !== 'string' || rawValue.trim() === '') {
            return null;
        }

        const parsed = new Date(rawValue);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    };

    const getYouTubeId = (video) => {
        const youtubeId = readText(video?.youtube_id ?? video?.youtubeId);
        return youtubeIdPattern.test(youtubeId) ? youtubeId : '';
    };

    const appendTopicValues = (values, set) => {
        if (Array.isArray(values)) {
            values.forEach((value) => appendTopicValues(value, set));
            return;
        }

        const topic = values && typeof values === 'object' && 'name' in values
            ? readText(values.name)
            : readText(values);

        if (topic !== '') {
            set.add(topic);
        }
    };

    const getTopics = (video) => {
        const topics = new Set();

        if (!video || typeof video !== 'object') {
            return [];
        }

        appendTopicValues(video.category, topics);
        appendTopicValues(video.categories, topics);
        appendTopicValues(video.tag, topics);
        appendTopicValues(video.tags, topics);
        appendTopicValues(video.topic, topics);
        appendTopicValues(video.topics, topics);

        return Array.from(topics);
    };

    const getThumbnailUrl = (video) => {
        const thumbnailUrl = readText(video?.thumbnail_url ?? video?.thumbnailUrl);
        if (thumbnailUrl !== '') {
            return thumbnailUrl;
        }

        const youtubeId = getYouTubeId(video);
        return youtubeId === '' ? '' : `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`;
    };

    const formatDuration = (value) => {
        const totalSeconds = normalizeCount(value);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        if (hours > 0) {
            return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        }

        return `${minutes}:${String(seconds).padStart(2, '0')}`;
    };

    const formatViews = (video) => `${numberFormatter.format(normalizeCount(video?.view_count ?? video?.viewCount))} views`;

    const formatRelativeDate = (video) => {
        const publishedDate = getPublishedDate(video);

        if (publishedDate === null) {
            return 'Publish date unknown';
        }

        const elapsedMilliseconds = publishedDate.getTime() - Date.now();
        const elapsedDays = Math.round(elapsedMilliseconds / 86400000);

        if (Math.abs(elapsedDays) < 30) {
            return relativeFormatter.format(elapsedDays, 'day');
        }

        const elapsedMonths = Math.round(elapsedDays / 30);
        if (Math.abs(elapsedMonths) < 12) {
            return relativeFormatter.format(elapsedMonths, 'month');
        }

        const elapsedYears = Math.round(elapsedDays / 365);
        return relativeFormatter.format(elapsedYears, 'year');
    };

    const getVideosFromPayload = (payload) => {
        if (payload && typeof payload === 'object' && Array.isArray(payload.data)) {
            return payload.data;
        }

        if (Array.isArray(payload)) {
            return payload;
        }

        if (payload && typeof payload === 'object' && Array.isArray(payload.videos)) {
            return payload.videos;
        }

        return [];
    };

    const isPublished = (video) => {
        if (!video || typeof video !== 'object') {
            return false;
        }

        const status = readText(video.status).toLowerCase();
        if (status !== '' && unpublishedStatuses.has(status)) {
            return false;
        }

        return video.is_published !== false && video.published !== false && video.public !== false;
    };

    const renderState = (title, description, className, statusText = `${title}. ${description}`) => {
        results.replaceChildren();
        setStatus(statusText);

        const section = document.createElement('section');
        section.className = className;

        const heading = document.createElement('h3');
        heading.textContent = title;
        section.append(heading);

        const paragraph = document.createElement('p');
        paragraph.textContent = description;
        section.append(paragraph);

        results.append(section);
    };

    const createVideoCard = (video) => {
        const slug = readText(video?.slug);
        const title = readText(video?.title) || 'Untitled video';
        const channelTitle = readText(video?.channel_title ?? video?.channelTitle) || 'Unknown channel';
        const thumbnailUrl = getThumbnailUrl(video);
        const durationLabel = formatDuration(video?.duration_seconds ?? video?.durationSeconds);

        const article = document.createElement('article');
        article.className = 'videos-grid-item';

        const wrapper = slug === '' ? document.createElement('div') : document.createElement('a');
        wrapper.className = 'videos-card';

        if (wrapper instanceof HTMLAnchorElement) {
            wrapper.href = `/videos/video.php?slug=${encodeURIComponent(slug)}`;
        }

        const thumbnail = document.createElement('div');
        thumbnail.className = 'videos-card-thumb';

        if (thumbnailUrl !== '') {
            const image = document.createElement('img');
            image.src = thumbnailUrl;
            image.alt = `${title} thumbnail`;
            image.loading = 'lazy';
            thumbnail.append(image);
        } else {
            const placeholder = document.createElement('div');
            placeholder.className = 'videos-thumb-fallback';
            placeholder.textContent = 'Video';
            thumbnail.append(placeholder);
        }

        const badge = document.createElement('span');
        badge.className = 'videos-duration-badge';
        badge.textContent = durationLabel;
        thumbnail.append(badge);
        wrapper.append(thumbnail);

        const body = document.createElement('div');
        body.className = 'videos-card-body';

        const heading = document.createElement('h3');
        heading.className = 'videos-card-title';
        heading.textContent = title;
        body.append(heading);

        const channel = document.createElement('p');
        channel.className = 'videos-card-channel';
        channel.textContent = channelTitle;
        body.append(channel);

        const meta = document.createElement('p');
        meta.className = 'videos-card-meta';
        meta.textContent = `${formatViews(video)} • ${formatRelativeDate(video)}`;
        body.append(meta);

        wrapper.append(body);
        article.append(wrapper);

        return article;
    };

    const renderChips = () => {
        filters.replaceChildren();

        const topics = Array.from(new Set(allVideos.flatMap((video) => getTopics(video))))
            .sort((left, right) => left.localeCompare(right));
        const chipLabels = ['All', ...topics];

        chipLabels.forEach((label) => {
            const button = document.createElement('button');
            const isActive = label === selectedTopic;

            button.type = 'button';
            button.className = `videos-chip${isActive ? ' is-active' : ''}`;
            button.dataset.topic = label;
            button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
            button.setAttribute('aria-controls', 'videos-results');
            button.setAttribute('aria-describedby', 'videos-results-status');
            button.textContent = label;
            filters.append(button);
        });
    };

    const getFilteredVideos = () => {
        const normalizedQuery = activeQuery.toLowerCase();

        return allVideos.filter((video) => {
            const matchesTopic = selectedTopic === 'All' || getTopics(video).includes(selectedTopic);
            if (!matchesTopic) {
                return false;
            }

            if (normalizedQuery === '') {
                return true;
            }

            const haystack = [
                readText(video?.title),
                readText(video?.channel_title ?? video?.channelTitle),
                readText(video?.description),
                getTopics(video).join(' ')
            ].join(' ').toLowerCase();

            return haystack.includes(normalizedQuery);
        });
    };

    const formatVideoCount = (count) => `${numberFormatter.format(count)} video${count === 1 ? '' : 's'}`;

    const getResultsSummary = (count) => {
        const countLabel = formatVideoCount(count);
        const hasQuery = activeQuery !== '';
        const hasTopic = selectedTopic !== 'All';

        if (hasQuery && hasTopic) {
            return {
                eyebrow: `${countLabel} found`,
                description: `Showing results for "${activeQuery}" in ${selectedTopic}.`
            };
        }

        if (hasQuery) {
            return {
                eyebrow: `${countLabel} found`,
                description: `Showing results for "${activeQuery}" across titles, channels, descriptions, and tags.`
            };
        }

        if (hasTopic) {
            return {
                eyebrow: `${countLabel} in ${selectedTopic}`,
                description: `Showing every published video tagged with ${selectedTopic}.`
            };
        }

        return {
            eyebrow: `${countLabel} available`,
            description: 'Showing the latest published uploads.'
        };
    };

    const createResultsSummary = (count, summary = getResultsSummary(count)) => {
        const section = document.createElement('section');
        section.className = 'videos-results-summary';

        const eyebrow = document.createElement('p');
        eyebrow.className = 'videos-results-summary-eyebrow';
        eyebrow.textContent = summary.eyebrow;
        section.append(eyebrow);

        const description = document.createElement('p');
        description.className = 'videos-results-summary-text';
        description.textContent = summary.description;
        section.append(description);

        return section;
    };

    const renderResults = () => {
        if (allVideos.length === 0) {
            renderState(
                'No videos yet',
                'Published uploads will appear here once they are available.',
                'videos-empty-state'
            );
            return;
        }

        const filteredVideos = getFilteredVideos();
        const summary = getResultsSummary(filteredVideos.length);
        if (filteredVideos.length === 0) {
            renderState(
                'No matching videos',
                'Try a different search term or switch back to another filter chip.',
                'videos-empty-state',
                `${summary.eyebrow}. ${summary.description}`
            );
            return;
        }

        results.replaceChildren();
        setStatus(`${summary.eyebrow}. ${summary.description}`);
        results.append(createResultsSummary(filteredVideos.length, summary));

        const grid = document.createElement('div');
        grid.className = 'videos-grid';
        filteredVideos.forEach((video) => grid.append(createVideoCard(video)));
        results.append(grid);
    };

    filters.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLButtonElement)) {
            return;
        }

        selectedTopic = readText(target.dataset.topic) || 'All';
        renderChips();
        renderResults();
    });

    searchInput.addEventListener('input', () => {
        activeQuery = searchInput.value.trim();
        renderResults();
    });

    setStatus('Loading videos...');

    fetch('/api/v1/videos')
        .then((response) => {
            if (!response.ok) {
                throw new Error('Unable to load videos.');
            }

            return response.json();
        })
        .then((payload) => {
            allVideos = getVideosFromPayload(payload).filter(isPublished);
            renderChips();
            renderResults();
        })
        .catch(() => {
            renderState(
                'Videos unavailable',
                'The videos library could not be loaded right now. Please try again later.',
                'videos-error-state'
            );
        });
})();
