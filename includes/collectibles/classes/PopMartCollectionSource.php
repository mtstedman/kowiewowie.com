<?php

declare(strict_types=1);

namespace Wowie\Api\Collectibles;

use RuntimeException;

/**
 * A Pop Mart line's catalog source backed by the public Pop Mart US storefront
 * pages: SKULLPANDA by default, or another line with its own source key and
 * collection page.
 *
 * Only the server-rendered collection and product pages are read. Pop Mart's
 * backend JSON API requires a request signature and is deliberately not used.
 */
final class PopMartCollectionSource
{
    public const SOURCE_KEY = 'popmart-us';
    public const BRAND = 'skullpanda';
    public const POP_BEAN_SOURCE_KEY = 'popmart-us-pop-bean';
    public const POP_BEAN_BRAND = 'pop-bean';
    public const POP_BEAN_COLLECTION_URL = 'https://www.popmart.com/us/collection/pop_bean';
    public const CURRENCY = 'USD';
    public const HOST = 'www.popmart.com';
    public const IMAGE_HOST = 'prod-global-biz.popmart.com';
    public const AMERICA_IMAGE_HOST = 'prod-america-res.popmart.com';

    private const ORIGIN = 'https://www.popmart.com';
    private const COLLECTION_URL = 'https://www.popmart.com/us/collection/skullpanda';
    private const MAX_PRODUCTS = 600;
    private const MAX_DETAIL_FAILURES = 5;
    private const MAX_VARIANTS = 40;
    private const MAX_NAME_BYTES = 80;
    private const NEARBY_BYTES = 600;

    private const PRICE_PATTERN = '/(?:US)?\$\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/';
    private const SECRET_PATTERN = '/\s*[(（]\s*(?:secret|hidden)\b[^)）]*[)）]\s*$/iu';
    private const BADGE_PATTERN = '/^(?:from|new|hot|sale|sold out|out of stock|coming soon|pre-?order|add to (?:cart|bag)|buy now|notify me(?: when available)?)$/i';
    private const NON_NAME_PATTERN = '/^(?:add to (?:cart|bag)|buy now|notify me(?: when available)?|quantity|size|material|brand|details?|description|shipping|share|reviews?|whole set|single box|you may also like|sold out|out of stock|specifications?|product (?:details|description|size|type))$/i';

    private CollectibleHttpClient $http;

    public function __construct(
        CollectibleHttpClient $http,
        private readonly string $sourceKey = self::SOURCE_KEY,
        private readonly string $brand = self::BRAND,
        private readonly string $collectionUrl = self::COLLECTION_URL,
        /** @var list<array{external_id: string, title: string, product_url: string}> */
        private readonly array $knownProducts = [],
    ) {
        if (!str_starts_with($collectionUrl, self::ORIGIN . '/us/collection/')) {
            throw new \InvalidArgumentException('A Pop Mart collection must be a popmart.com/us collection page.');
        }
        $this->http = $http;
    }

    public function sourceKey(): string
    {
        return $this->sourceKey;
    }

    public function brand(): string
    {
        return $this->brand;
    }

    /**
     * Walk the collection pages, then read each product page for its image and
     * figure variants.
     *
     * @return list<array{
     *     external_id: string,
     *     title: string,
     *     product_url: string,
     *     image_url: ?string,
     *     price_cents: ?int,
     *     currency: ?string,
     *     variants: list<array{name: string, is_secret: bool, image_url: ?string, price_cents: ?int, currency: ?string}>
     * }>
     */
    public function fetchProducts(): array
    {
        // Pop Mart's robots.txt disallows ?page= (and &page=, sort, filter), so
        // only the collection's first page is read; the products this line's
        // catalog cites (each series and its other listings) fill in the rest.
        $listed = [];
        foreach (self::parseCollectionPage($this->http->get($this->collectionUrl)) as $item) {
            $listed[$item['external_id']] ??= $item;
        }
        foreach ($this->knownProducts as $item) {
            if (!str_starts_with($item['product_url'], self::ORIGIN . '/us/products/')) continue;
            $listed[$item['external_id']] ??= $item + ['price_cents' => null];
        }

        $products = [];
        $failures = 0;
        foreach (array_slice($listed, 0, self::MAX_PRODUCTS) as $item) {
            try {
                $detail = self::parseProductPage($this->http->get($item['product_url']));
            } catch (RuntimeException $error) {
                // A product that cannot be read is left out so its stored row is
                // not overwritten; rate limiting or repeated failures fail the source.
                $failures++;
                if (in_array($error->getCode(), [429, 503], true) || $failures > self::MAX_DETAIL_FAILURES) {
                    throw $error;
                }

                error_log("Pop Mart product {$item['external_id']} was skipped: {$error->getMessage()}");
                continue;
            }

            $variants = [];
            foreach ($detail['variants'] as $variant) {
                // Pop Mart prices per series or blind box, never per figure.
                $variants[] = [
                    'name' => $variant['name'],
                    'is_secret' => $variant['is_secret'],
                    'image_url' => null,
                    'price_cents' => null,
                    'currency' => null,
                ];
            }

            $title = $item['title'] !== '' ? $item['title'] : $detail['title'];
            if ($title === null || $title === '') {
                error_log("Pop Mart product {$item['external_id']} was skipped: no title");
                continue;
            }

            $products[] = [
                'external_id' => $item['external_id'],
                'title' => $title,
                'product_url' => $item['product_url'],
                'image_url' => $detail['image_url'],
                'price_cents' => $item['price_cents'],
                'currency' => self::CURRENCY,
                'variants' => $variants,
            ];
        }

        return $products;
    }

    /**
     * Extract the products listed on one collection page.
     *
     * Embedded JSON-LD product nodes are preferred; product anchors with their
     * card text are the fallback and fill any gaps.
     *
     * @return list<array{external_id: string, title: string, product_url: string, price_cents: ?int}>
     */
    public static function parseCollectionPage(string $html): array
    {
        $found = [];
        foreach (array_merge(self::jsonLdListings($html), self::anchorListings($html)) as $candidate) {
            $id = $candidate['external_id'];
            if (!isset($found[$id])) {
                $found[$id] = ['external_id' => $id, 'slug' => '', 'title' => '', 'price_cents' => null];
            }
            if ($found[$id]['slug'] === '') {
                $found[$id]['slug'] = $candidate['slug'];
            }
            if ($found[$id]['title'] === '') {
                $found[$id]['title'] = $candidate['title'];
            }
            if ($found[$id]['price_cents'] === null) {
                $found[$id]['price_cents'] = $candidate['price_cents'];
            }
        }

        $products = [];
        foreach ($found as $entry) {
            $id = (string) $entry['external_id'];
            $slug = $entry['slug'];
            $title = $entry['title'] !== '' ? $entry['title'] : ucwords(trim(str_replace('-', ' ', $slug)));
            if ($title === '') {
                continue;
            }

            $products[] = [
                'external_id' => $id,
                'title' => $title,
                'product_url' => self::ORIGIN . '/us/products/' . $id . ($slug !== '' ? '/' . rawurlencode($slug) : ''),
                'price_cents' => $entry['price_cents'],
            ];
        }

        return $products;
    }

    /**
     * Extract the main image and figure variants from one product page.
     *
     * @return array{image_url: ?string, variants: list<array{name: string, is_secret: bool}>}
     */
    public static function parseProductPage(string $html): array
    {
        return [
            'title' => self::parseTitle($html),
            'image_url' => self::parseMainImage($html),
            'variants' => self::parseVariants($html),
        ];
    }

    /** The product's own title (og:title), without the store's suffix. */
    public static function parseTitle(string $html): ?string
    {
        if (preg_match('/<meta[^>]+property=["\']og:title["\'][^>]+content=["\']([^"\']+)["\']/i', $html, $match) !== 1
            && preg_match('/<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:title["\']/i', $html, $match) !== 1) {
            return null;
        }
        $title = trim(html_entity_decode($match[1], ENT_QUOTES | ENT_HTML5, 'UTF-8'));
        $title = trim((string) preg_replace('/\s*[|\-–—]\s*POP\s*MART.*$/iu', '', $title));
        return $title === '' ? null : mb_substr($title, 0, 300);
    }

    /**
     * Find the main product image on the Pop Mart image CDN, or null.
     */
    public static function parseMainImage(string $html): ?string
    {
        if (
            preg_match('~<meta\b[^>]*\bproperty\s*=\s*(["\'])og:image(?::secure_url)?\1[^>]*>~i', $html, $meta) === 1
            && preg_match('~\bcontent\s*=\s*(["\'])(.*?)\1~is', $meta[0], $content) === 1
        ) {
            $candidate = self::cdnImageUrl($content[2]);
            if ($candidate !== null) {
                return $candidate;
            }
        }

        foreach (self::jsonLdProducts($html) as $node) {
            $image = $node['image'] ?? null;
            if (is_array($image)) {
                $image = $image['url'] ?? ($image[0] ?? null);
            }
            if (is_array($image)) {
                $image = $image['url'] ?? null;
            }
            if (is_string($image)) {
                $candidate = self::cdnImageUrl($image);
                if ($candidate !== null) {
                    return $candidate;
                }
            }
        }

        // Fall back to the first product CDN image in page order, taking the widest
        // rendition of that same file that the page itself references.
        $haystack = str_replace('\\/', '/', $html);
        $matched = preg_match_all('~https://(?:prod-global-biz|prod-america-res)\.popmart\.com/[^\s"\'<>\\\\)`]+~i', $haystack, $matches);
        if ($matched === false || $matched < 1) {
            return null;
        }

        $firstPath = null;
        $best = null;
        $bestWidth = -1;
        foreach ($matches[0] as $raw) {
            $url = self::cdnImageUrl($raw);
            if ($url === null) {
                continue;
            }

            $path = explode('?', $url, 2)[0];
            if ($firstPath === null) {
                $firstPath = $path;
            }
            if ($path !== $firstPath) {
                continue;
            }

            $width = preg_match('~resize,w_(\d{1,5})~', $url, $size) === 1 ? (int) $size[1] : 0;
            if ($width > $bestWidth) {
                $best = $url;
                $bestWidth = $width;
            }
        }

        return $best;
    }

    /**
     * Extract figure variant names; a "(Secret)" suffix is stripped and flagged.
     *
     * @return list<array{name: string, is_secret: bool}>
     */
    public static function parseVariants(string $html): array
    {
        $lines = self::htmlToLines($html);
        $names = self::variantNamesAfterLabel($lines);
        if ($names === []) {
            $names = self::variantNamesAroundSecret($lines);
        }

        $variants = [];
        $seen = [];
        foreach ($names as $name) {
            $isSecret = preg_match(self::SECRET_PATTERN, $name) === 1;
            if ($isSecret) {
                $name = preg_replace(self::SECRET_PATTERN, '', $name) ?? $name;
            }

            $name = trim($name);
            $key = strtolower($name);
            if ($name === '' || isset($seen[$key])) {
                continue;
            }

            $seen[$key] = true;
            $variants[] = ['name' => $name, 'is_secret' => $isSecret];
            if (count($variants) >= self::MAX_VARIANTS) {
                break;
            }
        }

        return $variants;
    }

    /**
     * @return list<array{external_id: string, slug: string, title: string, price_cents: ?int}>
     */
    private static function jsonLdListings(string $html): array
    {
        $listings = [];
        foreach (self::jsonLdProducts($html) as $node) {
            $link = is_string($node['url'] ?? null) ? self::matchProductLink($node['url']) : null;
            if ($link === null) {
                continue;
            }

            $listings[] = [
                'external_id' => $link['external_id'],
                'slug' => $link['slug'],
                'title' => is_string($node['name'] ?? null) ? self::collapse($node['name']) : '',
                'price_cents' => self::jsonLdPrice($node['offers'] ?? null),
            ];
        }

        return $listings;
    }

    /**
     * @return list<array{external_id: string, slug: string, title: string, price_cents: ?int}>
     */
    private static function anchorListings(string $html): array
    {
        $matched = preg_match_all(
            '~<a\b[^>]*?\bhref\s*=\s*(["\'])(.*?)\1[^>]*>(.*?)</a>~is',
            $html,
            $matches,
            PREG_SET_ORDER | PREG_OFFSET_CAPTURE,
        );
        if ($matched === false || $matched < 1) {
            return [];
        }

        $listings = [];
        $htmlLength = strlen($html);
        foreach ($matches as $index => $match) {
            $link = self::matchProductLink($match[2][0]);
            if ($link === null) {
                continue;
            }

            [$title, $price] = self::cardText(self::htmlToLines($match[3][0]));

            if (
                $title === ''
                && preg_match('~\b(?:alt|title|aria-label)\s*=\s*(["\'])(.*?)\1~is', $match[0][0], $attribute) === 1
            ) {
                $label = self::collapse(html_entity_decode($attribute[2], ENT_QUOTES | ENT_HTML5, 'UTF-8'));
                if (strlen($label) >= 3) {
                    $title = $label;
                }
            }

            if ($title === '' || $price === null) {
                // Some card layouts put the title or price beside the link.
                $end = $match[0][1] + strlen($match[0][0]);
                $nextStart = isset($matches[$index + 1]) ? $matches[$index + 1][0][1] : $htmlLength;
                $nearbyLength = max(0, min(self::NEARBY_BYTES, $nextStart - $end));
                [$nearTitle, $nearPrice] = self::cardText(self::htmlToLines(substr($html, $end, $nearbyLength)));
                if ($title === '') {
                    $title = $nearTitle;
                }
                if ($price === null) {
                    $price = $nearPrice;
                }
            }

            $listings[] = [
                'external_id' => $link['external_id'],
                'slug' => $link['slug'],
                'title' => $title,
                'price_cents' => $price,
            ];
        }

        return $listings;
    }

    /**
     * Pick the title (longest non-badge line) and the lowest USD price from card text.
     *
     * @param list<string> $lines
     * @return array{0: string, 1: ?int}
     */
    private static function cardText(array $lines): array
    {
        $title = '';
        $price = null;
        foreach ($lines as $line) {
            if (preg_match_all(self::PRICE_PATTERN, $line, $prices) >= 1) {
                foreach ($prices[1] as $amount) {
                    $cents = CollectiblesSync::priceToCents($amount);
                    if ($cents !== null && ($price === null || $cents < $price)) {
                        $price = $cents;
                    }
                }
                $line = trim(preg_replace(self::PRICE_PATTERN, ' ', $line) ?? '');
            }

            if (strlen($line) < 3 || preg_match(self::BADGE_PATTERN, $line) === 1) {
                continue;
            }
            if (strlen($line) > strlen($title)) {
                $title = $line;
            }
        }

        return [$title, $price];
    }

    /**
     * @return array{external_id: string, slug: string}|null
     */
    private static function matchProductLink(string $url): ?array
    {
        $url = html_entity_decode(trim($url), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $pattern = '~^(?:https://www\.popmart\.com)?/us/products/(\d{1,12})(?:/([^/?#\s]{0,200}))?/?(?:[?#].*)?$~i';
        if (preg_match($pattern, $url, $match) !== 1) {
            return null;
        }

        return ['external_id' => $match[1], 'slug' => rawurldecode($match[2] ?? '')];
    }

    /**
     * Decode every JSON-LD block and return the schema.org Product nodes inside.
     *
     * @return list<array<mixed>>
     */
    private static function jsonLdProducts(string $html): array
    {
        $matched = preg_match_all(
            '~<script\b[^>]*\btype\s*=\s*(["\'])application/ld\+json\1[^>]*>(.*?)</script>~is',
            $html,
            $matches,
        );
        if ($matched === false || $matched < 1) {
            return [];
        }

        $products = [];
        foreach ($matches[2] as $block) {
            $decoded = json_decode(trim($block), true, 64);
            if (is_array($decoded)) {
                self::collectJsonLdProducts($decoded, $products, 0);
            }
        }

        return $products;
    }

    /**
     * @param array<mixed> $node
     * @param list<array<mixed>> $products
     */
    private static function collectJsonLdProducts(array $node, array &$products, int $depth): void
    {
        if ($depth > 12 || count($products) >= self::MAX_PRODUCTS) {
            return;
        }

        $type = $node['@type'] ?? null;
        if ($type === 'Product' || (is_array($type) && in_array('Product', $type, true))) {
            $products[] = $node;
        }

        foreach ($node as $child) {
            if (is_array($child)) {
                self::collectJsonLdProducts($child, $products, $depth + 1);
            }
        }
    }

    private static function jsonLdPrice(mixed $offers): ?int
    {
        if (!is_array($offers)) {
            return null;
        }
        if (isset($offers[0]) && is_array($offers[0])) {
            $offers = $offers[0];
        }

        $currency = $offers['priceCurrency'] ?? null;
        if (is_string($currency) && strtoupper(trim($currency)) !== self::CURRENCY) {
            return null;
        }

        return CollectiblesSync::priceToCents($offers['price'] ?? ($offers['lowPrice'] ?? null));
    }

    private static function cdnImageUrl(string $raw): ?string
    {
        $raw = preg_split('~&(?:quot|apos|#0*34|#0*39|#x0*22|#x0*27);~i', trim($raw))[0] ?? '';
        $url = rtrim(html_entity_decode($raw, ENT_QUOTES | ENT_HTML5, 'UTF-8'), '.,;');
        if (str_starts_with($url, '//')) {
            $url = 'https:' . $url;
        }

        $parts = parse_url($url);
        if (
            !is_array($parts)
            || strtolower((string) ($parts['scheme'] ?? '')) !== 'https'
            || !in_array(strtolower((string) ($parts['host'] ?? '')), [self::IMAGE_HOST, self::AMERICA_IMAGE_HOST], true)
            || preg_match('~\.(?:jpe?g|png|webp|gif|avif)$~i', (string) ($parts['path'] ?? '')) !== 1
        ) {
            return null;
        }

        if (strlen($url) > 2000 || filter_var($url, FILTER_VALIDATE_URL) === false) {
            return null;
        }

        return $url;
    }

    /**
     * Names listed under a "Figure Styles" style label, on following lines or inline.
     *
     * @param list<string> $lines
     * @return list<string>
     */
    private static function variantNamesAfterLabel(array $lines): array
    {
        $total = count($lines);
        $labelPattern = '/^(?:figure|figurine|doll|plush|series)?\s*styles?\s*(?:[:：]\s*(.*))?$/iu';
        for ($index = 0; $index < $total; $index++) {
            if (preg_match($labelPattern, $lines[$index], $label) !== 1) {
                continue;
            }

            $inline = trim($label[1] ?? '');
            if ($inline !== '') {
                $names = self::splitNameList($inline);
                if (count($names) >= 2) {
                    return $names;
                }
                continue;
            }

            $names = [];
            for ($next = $index + 1; $next < $total && count($names) < self::MAX_VARIANTS; $next++) {
                if ($names === []) {
                    $pieces = self::splitNameList($lines[$next]);
                    if (count($pieces) >= 3) {
                        return $pieces;
                    }
                }

                $candidate = self::stripListMarker($lines[$next]);
                if (!self::looksLikeVariantName($candidate)) {
                    break;
                }
                $names[] = $candidate;
            }

            // Secret figures close the list; anything after them is page chrome.
            for ($last = count($names) - 1; $last >= 0; $last--) {
                if (preg_match(self::SECRET_PATTERN, $names[$last]) === 1) {
                    $names = array_slice($names, 0, $last + 1);
                    break;
                }
            }

            if ($names !== []) {
                return $names;
            }
        }

        return [];
    }

    /**
     * Without a label, anchor on a "(Secret)" line and take the name run around it.
     *
     * @param list<string> $lines
     * @return list<string>
     */
    private static function variantNamesAroundSecret(array $lines): array
    {
        $total = count($lines);
        for ($index = 0; $index < $total; $index++) {
            if (preg_match(self::SECRET_PATTERN, $lines[$index]) !== 1) {
                continue;
            }

            $pieces = self::splitNameList($lines[$index]);
            if (count($pieces) >= 2) {
                return $pieces;
            }

            $secret = self::stripListMarker($lines[$index]);
            if (!self::looksLikeVariantName($secret)) {
                continue;
            }

            $names = [$secret];
            for ($previous = $index - 1; $previous >= 0 && count($names) < self::MAX_VARIANTS; $previous--) {
                $candidate = self::stripListMarker($lines[$previous]);
                if (!self::looksLikeVariantName($candidate)) {
                    break;
                }
                array_unshift($names, $candidate);
            }

            for ($next = $index + 1; $next < $total && count($names) < self::MAX_VARIANTS; $next++) {
                $candidate = self::stripListMarker($lines[$next]);
                if (preg_match(self::SECRET_PATTERN, $candidate) !== 1 || !self::looksLikeVariantName($candidate)) {
                    break;
                }
                $names[] = $candidate;
            }

            return $names;
        }

        return [];
    }

    /**
     * @return list<string>
     */
    private static function splitNameList(string $line): array
    {
        $pieces = preg_split('/\s*[,，、;；|•·]\s*/u', $line);
        if (!is_array($pieces)) {
            return [];
        }

        $names = [];
        foreach ($pieces as $piece) {
            $piece = self::stripListMarker($piece);
            if (self::looksLikeVariantName($piece)) {
                $names[] = $piece;
            }
        }

        return $names;
    }

    private static function stripListMarker(string $line): string
    {
        return trim(preg_replace('/^\s*(?:[-–—•·*▪■]+|\d{1,2}\s*[.)、])\s*/u', '', $line) ?? $line);
    }

    private static function looksLikeVariantName(string $line): bool
    {
        $length = strlen($line);
        if ($length < 2 || $length > self::MAX_NAME_BYTES) {
            return false;
        }
        if (preg_match('/[:：$€£¥@=<>{}\[\]|]|https?/iu', $line) === 1) {
            return false;
        }
        if (preg_match('/\d\s*(?:%|(?:cm|mm|inch|in|g|kg|oz|pcs?)\b)/i', $line) === 1) {
            return false;
        }
        if (preg_match(self::NON_NAME_PATTERN, $line) === 1) {
            return false;
        }

        return preg_match('/\pL/u', $line) === 1;
    }

    /**
     * Reduce markup to trimmed, entity-decoded, non-empty text lines.
     *
     * @return list<string>
     */
    private static function htmlToLines(string $html): array
    {
        $text = preg_replace('~<(script|style|noscript|template)\b[^>]*>.*?</\1>~is', "\n", $html) ?? $html;
        $text = preg_replace('~<!--.*?-->~s', "\n", $text) ?? $text;
        $text = preg_replace('~<[^>]*>~', "\n", $text) ?? $text;
        $text = html_entity_decode($text, ENT_QUOTES | ENT_HTML5, 'UTF-8');

        $lines = [];
        foreach (preg_split('/\R/', $text) ?: [] as $line) {
            $line = self::collapse($line);
            if ($line !== '') {
                $lines[] = $line;
            }
        }

        return $lines;
    }

    private static function collapse(string $text): string
    {
        $text = str_replace("\u{00A0}", ' ', $text);

        return trim(preg_replace('/\s+/', ' ', $text) ?? $text);
    }
}
