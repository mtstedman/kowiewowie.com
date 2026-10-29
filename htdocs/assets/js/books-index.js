(() => {
    const booksList = document.getElementById('books-list');

    if (!(booksList instanceof HTMLElement)) {
        return;
    }

    const AMAZON_HOSTS = new Set([
        'amzn.to',
        'amazon.com', 'www.amazon.com',
        'amazon.co.uk', 'www.amazon.co.uk',
        'amazon.ca', 'www.amazon.ca',
        'amazon.com.au', 'www.amazon.com.au',
        'amazon.de', 'www.amazon.de',
        'amazon.fr', 'www.amazon.fr',
        'amazon.it', 'www.amazon.it',
        'amazon.es', 'www.amazon.es',
        'amazon.nl', 'www.amazon.nl',
        'amazon.ie', 'www.amazon.ie',
        'amazon.co.jp', 'www.amazon.co.jp',
        'amazon.in', 'www.amazon.in',
        'amazon.com.mx', 'www.amazon.com.mx',
        'amazon.com.br', 'www.amazon.com.br',
    ]);
    const PRICE_PATTERN = /^([0-9]{1,10})(?:\.([0-9]{1,2}))?$/;
    const CURRENCY_PATTERN = /^[A-Z]{3}$/;
    const NORTHEAST_ARROW = String.fromCodePoint(0x2197);

    class MalformedBooksError extends Error {}

    const text = (value) => (typeof value === 'string' ? value.trim() : '');

    const parseHttpsUrl = (value) => {
        const raw = text(value);
        if (raw === '') {
            return null;
        }

        let url;
        try {
            url = new URL(raw);
        } catch (error) {
            return null;
        }

        if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== '') {
            return null;
        }

        return url;
    };

    const safeCoverUrl = (value) => {
        const url = parseHttpsUrl(value);
        return url ? url.href : '';
    };

    const safeAmazonUrl = (value) => {
        const url = parseHttpsUrl(value);
        return url && AMAZON_HOSTS.has(url.hostname.toLowerCase()) ? url.href : '';
    };

    const formatPrice = (amount, currency) => {
        const rawAmount = typeof amount === 'number' && Number.isFinite(amount) && amount >= 0
            ? amount.toFixed(2)
            : text(amount);
        const match = rawAmount.match(PRICE_PATTERN);
        const code = text(currency).toUpperCase();

        if (!match || !CURRENCY_PATTERN.test(code)) {
            return '';
        }

        const whole = match[1].replace(/^0+(?=[0-9])/, '');
        const fraction = (match[2] || '').padEnd(2, '0');
        const normalized = `${whole}.${fraction}`;

        try {
            return new Intl.NumberFormat('en', {
                style: 'currency',
                currency: code,
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
            }).format(Number(normalized));
        } catch (error) {
            return `${normalized} ${code}`;
        }
    };

    const createCoverFallback = (title) => {
        const fallback = document.createElement('div');
        const fallbackTitle = document.createElement('span');
        const fallbackNote = document.createElement('span');

        fallback.className = 'book-cover book-cover-fallback';
        fallbackTitle.className = 'book-cover-fallback-title';
        fallbackTitle.setAttribute('aria-hidden', 'true');
        fallbackTitle.textContent = title;
        fallbackNote.className = 'book-cover-fallback-note';
        fallbackNote.textContent = 'Cover unavailable';
        fallback.append(fallbackTitle, fallbackNote);

        return fallback;
    };

    const createCover = (coverUrl, title) => {
        const frame = document.createElement('div');
        frame.className = 'book-cover-frame';

        if (coverUrl === '') {
            frame.append(createCoverFallback(title));
            return frame;
        }

        const image = document.createElement('img');
        image.className = 'book-cover';
        image.setAttribute('src', coverUrl);
        image.setAttribute('alt', `Cover of ${title}`);
        image.setAttribute('width', '400');
        image.setAttribute('height', '600');
        image.setAttribute('loading', 'lazy');
        image.setAttribute('decoding', 'async');
        image.setAttribute('referrerpolicy', 'no-referrer');
        image.addEventListener('error', () => {
            frame.replaceChildren(createCoverFallback(title));
        }, { once: true });
        frame.append(image);

        return frame;
    };

    const createOverview = (overview) => {
        const container = document.createElement('div');
        container.className = 'book-overview';

        const paragraphs = text(overview)
            .replace(/\r\n?/g, '\n')
            .split(/\n\s*\n/)
            .map((paragraph) => paragraph.trim())
            .filter((paragraph) => paragraph !== '');

        if (paragraphs.length === 0) {
            const empty = document.createElement('p');
            empty.textContent = 'No overview yet.';
            container.append(empty);
            return container;
        }

        paragraphs.forEach((paragraph) => {
            const element = document.createElement('p');
            element.textContent = paragraph;
            container.append(element);
        });

        return container;
    };

    const createBookCard = (book, index) => {
        const safeBook = book && typeof book === 'object' && !Array.isArray(book) ? book : {};
        const title = text(safeBook.title) !== '' ? text(safeBook.title) : 'Untitled book';
        const author = text(safeBook.author);
        const price = formatPrice(safeBook.price_amount, safeBook.price_currency);
        const amazonUrl = safeAmazonUrl(safeBook.amazon_url);
        const headingId = `book-${index + 1}-title`;

        const article = document.createElement('article');
        const body = document.createElement('div');
        const header = document.createElement('div');
        const heading = document.createElement('h3');

        article.className = 'book-card';
        article.setAttribute('aria-labelledby', headingId);
        body.className = 'book-body';
        header.className = 'book-header';

        heading.id = headingId;
        heading.className = 'book-title';
        heading.textContent = title;
        header.append(heading);

        if (author !== '') {
            const authorText = document.createElement('p');
            authorText.className = 'book-author';
            authorText.textContent = `by ${author}`;
            header.append(authorText);
        }

        if (price !== '') {
            const priceText = document.createElement('p');
            const priceLabel = document.createElement('span');
            priceText.className = 'book-price';
            priceLabel.className = 'public-visually-hidden';
            priceLabel.textContent = 'Price: ';
            priceText.append(priceLabel, price);
            header.append(priceText);
        }

        body.append(header, createOverview(safeBook.overview));

        if (amazonUrl !== '') {
            const link = document.createElement('a');
            const icon = document.createElement('span');

            link.className = 'button book-link';
            link.href = amazonUrl;
            link.rel = 'noopener noreferrer';
            link.target = '_blank';
            link.setAttribute('aria-label', `View ${title} on Amazon, opens in a new tab`);
            link.append('View on Amazon ');

            icon.setAttribute('aria-hidden', 'true');
            icon.textContent = NORTHEAST_ARROW;
            link.append(icon);
            body.append(link);
        } else {
            const unavailable = document.createElement('p');
            unavailable.className = 'book-link-unavailable';
            unavailable.textContent = 'Amazon link unavailable.';
            body.append(unavailable);
        }

        article.append(createCover(safeCoverUrl(safeBook.cover_image_url), title), body);

        return article;
    };

    const showMessage = (message) => {
        const paragraph = document.createElement('p');
        paragraph.className = 'books-status';
        paragraph.textContent = message;
        booksList.replaceChildren(paragraph);
        booksList.setAttribute('aria-busy', 'false');
    };

    const renderBooks = (books) => {
        if (books.length === 0) {
            showMessage('The shelf is empty for now. Check back soon for a new recommendation.');
            return;
        }

        const grid = document.createElement('div');
        grid.className = 'book-grid';
        books.forEach((book, index) => grid.append(createBookCard(book, index)));
        booksList.replaceChildren(grid);
        booksList.setAttribute('aria-busy', 'false');
    };

    const renderError = (error) => {
        showMessage(error instanceof MalformedBooksError
            ? 'The shelf came back scrambled, so nothing is shown. Try again in a moment.'
            : 'The shelf would not load. Try again in a moment.');
    };

    fetch('/api/books', { headers: { Accept: 'application/json' } })
        .then((response) => {
            if (!response.ok) {
                throw new Error('Books request failed');
            }

            return Promise.resolve()
                .then(() => response.json())
                .catch(() => {
                    throw new MalformedBooksError('Books response was not JSON');
                });
        })
        .then((books) => {
            if (!Array.isArray(books)) {
                throw new MalformedBooksError('Books response was not a list');
            }

            const validBooks = books.filter((book) => book && typeof book === 'object' && !Array.isArray(book));
            if (books.length > 0 && validBooks.length === 0) {
                throw new MalformedBooksError('Books response contained no book records');
            }

            renderBooks(validBooks);
        })
        .catch(renderError);
})();
