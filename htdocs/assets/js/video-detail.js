(() => {
    const page = document.getElementById('video-page');
    const slug = new URLSearchParams(window.location.search).get('slug')?.trim() ?? '';

    if (!(page instanceof HTMLElement)) {
        return;
    }

    const numberFormatter = new Intl.NumberFormat('en-US');
    const absoluteDateFormatter = new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
    const unpublishedStatuses = new Set(['draft', 'private', 'scheduled', 'unpublished']);
    const youtubeIdPattern = /^[A-Za-z0-9_-]{11}$/;

    const readText = (value) => typeof value === 'string' ? value.trim() : '';

    const normalizeCount = (value) => {
        if (typeof value === 'number' && Number.isFinite(value)) {
            return Math.max(0, Math.trunc(value));
        }

        const parsed = Number.parseInt(String(value ?? ''), 10);
        return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    };

    const getYouTubeId = (video) => {
        const youtubeId = readText(video?.youtube_id ?? video?.youtubeId);
        return youtubeIdPattern.test(youtubeId) ? youtubeId : '';
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

    const formatPublishedDate = (video) => {
        const publishedDate = getPublishedDate(video);
        return publishedDate === null ? 'Publish date unknown' : absoluteDateFormatter.format(publishedDate);
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

    const appendTextElement = (parent, tagName, className, text) => {
        const element = document.createElement(tagName);

        if (className !== '') {
            element.className = className;
        }

        element.textContent = text;
        parent.append(element);
        return element;
    };

    const appendArrowLink = (parent, className, href, text) => {
        const link = document.createElement('a');
        link.className = className;
        link.href = href;
        link.append(`${text} `);

        const arrow = document.createElement('span');
        arrow.setAttribute('aria-hidden', 'true');
        arrow.textContent = '->';
        link.append(arrow);

        parent.append(link);
        return link;
    };

    const extractVideo = (payload) => {
        if (payload && typeof payload === 'object' && payload.video && typeof payload.video === 'object') {
            return payload.video;
        }

        return payload && typeof payload === 'object' ? payload : null;
    };

    const extractRelatedVideos = (payload) => {
        if (!payload || typeof payload !== 'object') {
            return [];
        }

        const related = payload.related_videos ?? payload.relatedVideos ?? [];
        return Array.isArray(related) ? related : [];
    };

    const renderNotFound = () => {
        page.replaceChildren();

        const section = document.createElement('section');
        section.className = 'hero hero-compact';

        appendTextElement(section, 'p', 'eyebrow', 'Video not found');
        appendTextElement(section, 'h1', '', 'That watch page is not available.');
        appendTextElement(section, 'p', 'lede', 'Choose a public video from the videos tab to keep watching.');
        appendArrowLink(section, 'button', '/videos/', 'Back to videos');

        page.append(section);
    };

    const renderError = () => {
        page.replaceChildren();

        const section = document.createElement('section');
        section.className = 'hero hero-compact';

        appendTextElement(section, 'p', 'eyebrow', 'Loading error');
        appendTextElement(section, 'h1', '', 'This video could not be loaded.');
        appendTextElement(section, 'p', 'lede', 'Try the videos tab again in a moment.');
        appendArrowLink(section, 'button', '/videos/', 'Back to videos');

        page.append(section);
    };

    const renderEmpty = () => {
        page.replaceChildren();

        const section = document.createElement('section');
        section.className = 'hero hero-compact';

        appendTextElement(section, 'p', 'eyebrow', 'Video unavailable');
        appendTextElement(section, 'h1', '', 'The watch page is missing a playable video.');
        appendTextElement(section, 'p', 'lede', 'Pick another upload from the videos list to keep browsing.');
        appendArrowLink(section, 'button', '/videos/', 'Back to videos');

        page.append(section);
    };

    const renderRelatedRail = (container, currentVideo, relatedVideos, state) => {
        container.replaceChildren();

        const section = document.createElement('section');
        section.className = 'videos-related';
        appendTextElement(section, 'h2', '', 'Related videos');

        if (state === 'loading') {
            appendTextElement(section, 'p', 'videos-related-state', 'Loading related videos...');
            container.append(section);
            return;
        }

        if (state === 'error') {
            appendTextElement(section, 'p', 'videos-related-state', 'Related videos could not be loaded right now.');
            container.append(section);
            return;
        }

        const currentSlug = readText(currentVideo?.slug);
        const visibleVideos = relatedVideos
            .filter((video) => isPublished(video))
            .filter((video) => readText(video?.slug) !== '')
            .filter((video) => readText(video?.slug) !== currentSlug)
            .slice(0, 8);

        if (visibleVideos.length === 0) {
            appendTextElement(section, 'p', 'videos-related-state', 'No related videos are available yet.');
            container.append(section);
            return;
        }

        const list = document.createElement('div');
        list.className = 'videos-related-list';

        visibleVideos.forEach((video) => {
            const slugValue = readText(video?.slug);
            const title = readText(video?.title) || 'Untitled video';
            const channelTitle = readText(video?.channel_title ?? video?.channelTitle) || 'Unknown channel';
            const thumbnailUrl = getThumbnailUrl(video);
            const topicLabel = getTopics(video)[0] || channelTitle;

            const link = document.createElement('a');
            link.className = 'videos-related-item';
            link.href = `/videos/video.php?slug=${encodeURIComponent(slugValue)}`;

            const thumb = document.createElement('div');
            thumb.className = 'videos-related-thumb';

            if (thumbnailUrl !== '') {
                const image = document.createElement('img');
                image.src = thumbnailUrl;
                image.alt = `${title} thumbnail`;
                image.loading = 'lazy';
                thumb.append(image);
            } else {
                const placeholder = document.createElement('div');
                placeholder.className = 'videos-thumb-fallback';
                placeholder.textContent = 'Video';
                thumb.append(placeholder);
            }

            const duration = document.createElement('span');
            duration.className = 'videos-duration-badge';
            duration.textContent = formatDuration(video?.duration_seconds ?? video?.durationSeconds);
            thumb.append(duration);
            link.append(thumb);

            const body = document.createElement('div');
            body.className = 'videos-related-body';
            appendTextElement(body, 'h3', 'videos-related-title', title);
            appendTextElement(body, 'p', 'videos-related-channel', channelTitle);
            appendTextElement(body, 'p', 'videos-related-meta', `${topicLabel} • ${formatViews(video)}`);
            link.append(body);

            list.append(link);
        });

        section.append(list);
        container.append(section);
    };

    const renderVideo = (video) => {
        const youtubeId = getYouTubeId(video);
        if (youtubeId === '') {
            renderEmpty();
            return null;
        }

        const title = readText(video?.title) || 'Untitled video';
        const channelTitle = readText(video?.channel_title ?? video?.channelTitle) || 'Unknown channel';
        const description = readText(video?.description) || 'No description provided.';
        const channelInitial = channelTitle.charAt(0).toUpperCase() || 'C';

        document.title = `${title} - wowiekowie.com`;
        page.replaceChildren();

        const wrapper = document.createElement('section');
        wrapper.className = 'videos-watch-layout';

        const mainColumn = document.createElement('div');
        mainColumn.className = 'videos-watch-main';

        const player = document.createElement('div');
        player.className = 'videos-player';

        const iframe = document.createElement('iframe');
        iframe.src = `https://www.youtube-nocookie.com/embed/${youtubeId}`;
        iframe.title = title;
        iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
        iframe.allowFullscreen = true;
        player.append(iframe);
        mainColumn.append(player);

        const metadata = document.createElement('article');
        metadata.className = 'videos-watch-meta';
        appendTextElement(metadata, 'h1', 'videos-watch-title', title);
        appendTextElement(metadata, 'p', 'videos-watch-stats', `${formatViews(video)} • ${formatPublishedDate(video)}`);
        mainColumn.append(metadata);

        const channelRow = document.createElement('div');
        channelRow.className = 'videos-channel-row';
        appendTextElement(channelRow, 'span', 'videos-channel-badge', channelInitial);

        const channelCopy = document.createElement('div');
        channelCopy.className = 'videos-channel-copy';
        appendTextElement(channelCopy, 'p', 'videos-channel-name', channelTitle);
        appendTextElement(channelCopy, 'p', 'videos-channel-label', 'Channel');
        channelRow.append(channelCopy);
        mainColumn.append(channelRow);

        const descriptionCard = document.createElement('section');
        descriptionCard.className = 'videos-description-card';
        appendTextElement(descriptionCard, 'h2', 'videos-description-heading', 'Description');

        const descriptionText = appendTextElement(descriptionCard, 'p', 'videos-description-text is-collapsed', description);
        const shouldToggle = description.length > 220 || description.includes('\n');

        if (shouldToggle) {
            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = 'videos-description-toggle';
            toggle.textContent = 'Show more';
            toggle.setAttribute('aria-expanded', 'false');
            toggle.addEventListener('click', () => {
                const collapsed = descriptionText.classList.toggle('is-collapsed');
                toggle.textContent = collapsed ? 'Show more' : 'Show less';
                toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
            });
            descriptionCard.append(toggle);
        }

        mainColumn.append(descriptionCard);

        const backParagraph = document.createElement('p');
        appendArrowLink(backParagraph, 'text-link', '/videos/', 'Back to all videos');
        mainColumn.append(backParagraph);

        const aside = document.createElement('aside');
        aside.className = 'videos-related-rail';

        wrapper.append(mainColumn, aside);
        page.append(wrapper);

        return aside;
    };

    const fetchVideoDetail = () => fetch(`/v1/videos/${encodeURIComponent(slug)}`)
        .then((response) => {
            if (response.status === 404) {
                return null;
            }

            if (!response.ok) {
                throw new Error('Unable to load video.');
            }

            return response.json();
        });

    const fetchVideoList = () => fetch('/v1/videos')
        .then((response) => {
            if (!response.ok) {
                throw new Error('Unable to load related videos.');
            }

            return response.json();
        })
        .then((payload) => {
            if (Array.isArray(payload)) {
                return payload;
            }

            if (payload && typeof payload === 'object' && Array.isArray(payload.videos)) {
                return payload.videos;
            }

            return [];
        });

    if (slug === '') {
        renderNotFound();
        return;
    }

    fetchVideoDetail()
        .then((payload) => {
            if (payload === null) {
                renderNotFound();
                return;
            }

            const video = extractVideo(payload);
            if (video === null) {
                renderEmpty();
                return;
            }

            if (!isPublished(video)) {
                renderNotFound();
                return;
            }

            const relatedRail = renderVideo(video);
            if (!(relatedRail instanceof HTMLElement)) {
                return;
            }

            const relatedFromPayload = extractRelatedVideos(payload);
            if (relatedFromPayload.length > 0) {
                renderRelatedRail(relatedRail, video, relatedFromPayload, 'ready');
                return;
            }

            renderRelatedRail(relatedRail, video, [], 'loading');
            fetchVideoList()
                .then((videos) => {
                    renderRelatedRail(relatedRail, video, videos, 'ready');
                })
                .catch(() => {
                    renderRelatedRail(relatedRail, video, [], 'error');
                });
        })
        .catch(renderError);
})();
