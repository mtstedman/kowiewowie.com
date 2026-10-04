<?php

declare(strict_types=1);

namespace Wowie\Api\Collectibles;

/**
 * Files store listings under the catalog series (set) they belong to.
 *
 * Store feeds list every retail item on its own: a series box, a whole set,
 * one confirmed figure, a series badge. Only listings named in a catalog's
 * product/members are mapped exactly; this matches the rest by title so they
 * group with their set instead of piling up unclassified:
 *
 *   1. an exact catalog identity or URL (the existing mapping) wins;
 *   2. the listing title starts with the catalog's store title for a series
 *      ("Nommi About the Childhood Plush Dolls Blind Box Series: Carousel");
 *   3. the series name appears followed shortly by "series"
 *      ("SKULLPANDA Image Of Reality Series-Badge Blind Box").
 *
 * The longest match wins. What remains of the title says what the listing
 * sells (one figure, a whole set, an accessory, a box). Anything unmatched
 * keeps no series and is filed under a product line by keyword.
 */
final class CollectibleListingClassifier
{
    private const ACCESSORY = '/\b(?:badge|phone charm|charm|mini bag|bag|handbag|magnet|cable|sachet|hanging chain|chain|stickers?|card holder|cards?|keychain|scarf|scarves|lanyard|mirror|lamp|crystal ball|passport cover|cover|breastpin|brooch|pin|cup|mug|tumbler|phone case|case|hair clip|hairpin|pendant set)\b/u';
    /** Store hosts whose own collection/product URL slugs name a series. */
    private const STORE_HOSTS = ['toysez.com', 'www.popmart.com'];

    /**
     * @param array{identity: array<string, array<string, mixed>>, url: array<string, array<string, mixed>>, titles: array<string, list<array<string, mixed>>>} $mappings
     * @return array{series_id: ?string, series_title: ?string, series_roster_status: string, series_release_year: ?int, line: string, listing_kind: string, listing_figure: ?string}
     */
    public static function classify(array $mappings, string $sourceKey, string $brand, string $externalId, string $productUrl, string $title): array
    {
        $exact = $mappings['identity'][$sourceKey . "\0" . $externalId] ?? $mappings['url'][$sourceKey . "\0" . $productUrl] ?? null;
        $normalized = self::normalize($title);
        $match = null;
        $remainder = '';
        if ($exact === null) {
            [$match, $remainder] = self::match($mappings['titles'][$sourceKey] ?? [], $normalized);
        }
        $series = $exact ?? $match['value'] ?? null;
        if ($series === null) {
            return [
                'series_id' => null,
                'series_title' => null,
                'series_roster_status' => 'unknown',
                'series_release_year' => null,
                'line' => self::lineForTitle($brand, $title),
                'listing_kind' => 'standalone',
                'listing_figure' => null,
            ];
        }

        $isSeriesProduct = $exact !== null && (string) ($series['series_product_external_id'] ?? '') === $externalId;
        if ($exact !== null && !$isSeriesProduct) {
            // A mapped member: what it sells still comes from its title.
            foreach ($mappings['titles'][$sourceKey] ?? [] as $candidate) {
                if (($candidate['value']['series_id'] ?? null) !== $series['series_id']) continue;
                [, $remainder] = self::match([$candidate], $normalized);
                $match = $candidate;
                break;
            }
        }
        [$kind, $figure] = $isSeriesProduct ? ['series', null] : self::listingKind($remainder, $match['figures'] ?? []);

        return [
            'series_id' => (string) $series['series_id'],
            'series_title' => (string) $series['series_title'],
            'series_roster_status' => (string) $series['series_roster_status'],
            'series_release_year' => is_int($series['series_release_year'] ?? null) ? $series['series_release_year'] : null,
            'line' => (string) ($series['series_line'] ?? self::lineForTitle($brand, $title)),
            'listing_kind' => $kind,
            'listing_figure' => $figure,
        ];
    }

    /**
     * Lowercase words and digits, punctuation (and %) as spaces, so a store
     * title and its URL slug compare equal: "Sweetness 100% Vinyl" and
     * "sweetness-100-vinyl".
     */
    public static function normalize(string $text): string
    {
        $text = function_exists('mb_strtolower') ? mb_strtolower($text, 'UTF-8') : strtolower($text);
        $text = str_replace(["'", "\u{2019}", "\u{2018}"], '', $text);
        $text = (string) preg_replace('/[^\p{L}\p{N}]+/u', ' ', $text);
        return trim((string) preg_replace('/\s+/u', ' ', $text));
    }

    /**
     * The series title a store's own URL slug spells out, e.g. TOYSEZ's
     * /collections/nommi-sweetness-100-vinyl-plush-pendant-series for the
     * series the catalog names "Glutinous Rice 100% Sweetness".
     */
    public static function slugTitle(string $url): ?string
    {
        $parts = parse_url($url);
        if (!is_array($parts) || !in_array($parts['host'] ?? '', self::STORE_HOSTS, true)) return null;
        if (preg_match('~/(?:collections|products(?:/\d+)?)/([a-z0-9][a-z0-9-]*)/?$~', (string) ($parts['path'] ?? ''), $found) !== 1) return null;
        $title = self::normalize(str_replace('-', ' ', $found[1]));
        return $title === '' ? null : $title;
    }

    /**
     * The product line a title belongs to. Sonny Angel lines come from its
     * catalog families; these cover the store-fed brands.
     */
    public static function lineForTitle(string $brand, string $title): string
    {
        $text = self::normalize($title);
        if (preg_match('/\bmega\b|\b(?:1000|400|200)\b/u', $text) === 1) return 'large';
        if (preg_match('/\bpendant\b|\bkeychain\b/u', $text) === 1) return 'pendants';
        if (preg_match(self::ACCESSORY, $text) === 1) return 'accessories';
        if (preg_match('/\bplush\b/u', $text) === 1) return 'plush';
        if (preg_match('/\bseries\b|\bfigures\b|\bblind box\b/u', $text) === 1) return 'figures';
        return $brand === 'sonny-angel' ? 'other' : 'standalone';
    }

    /**
     * @param list<array<string, mixed>> $candidates
     * @return array{0: ?array<string, mixed>, 1: string}
     */
    private static function match(array $candidates, string $title): array
    {
        $best = null;
        $bestLength = 0;
        $bestRemainder = '';
        foreach ($candidates as $candidate) {
            foreach (array_merge([(string) $candidate['product_title']], $candidate['aliases'] ?? []) as $prefix) {
                if ($prefix !== '' && ($title === $prefix || str_starts_with($title, $prefix . ' ')) && strlen($prefix) > $bestLength) {
                    $best = $candidate;
                    $bestLength = strlen($prefix);
                    $bestRemainder = trim(substr($title, strlen($prefix)));
                }
            }
            $name = (string) $candidate['name'];
            if ($name === '' || strlen($name) <= $bestLength) continue;
            // The name, then within a few words the word "series".
            if (preg_match('/(?:^|\s)' . preg_quote($name, '/') . '((?:\s\S+){0,5}?)\sseries(?:\s(.*))?$/u', $title, $found) === 1) {
                $best = $candidate;
                $bestLength = strlen($name);
                $bestRemainder = trim($found[2] ?? '');
            }
        }
        return [$best, $bestRemainder];
    }

    /**
     * What a listing of a known series sells, from the words after the series.
     *
     * @param list<string> $figures
     * @return array{0: string, 1: ?string}
     */
    private static function listingKind(string $remainder, array $figures): array
    {
        if (preg_match('/\bwhole set\b|\bfull set\b|\bset of \d+\b/u', $remainder) === 1) return ['whole-set', null];
        // A remainder that is exactly a figure's name is that figure, even if
        // the name contains a word like "Bag"; otherwise accessory words win
        // ("Mini Bag-The Sugar Tongs" is a bag in a figure's style).
        $bare = trim((string) preg_replace('/\s+/u', ' ', (string) preg_replace('/\b(?:confirmed style|secret|opened box|opened|brand new with plastic|brand new|sealed)\b|\b\d+ \d+\b/u', ' ', $remainder)));
        foreach ($figures as $name) {
            if (self::normalize($name) === $bare && $bare !== '') return ['figure', $name];
        }
        if (preg_match(self::ACCESSORY, $remainder) === 1) return ['accessory', null];
        $figure = null;
        $figureLength = 0;
        foreach ($figures as $name) {
            $key = self::normalize($name);
            if ($key !== '' && strlen($key) > $figureLength && preg_match('/(?:^|\s)' . preg_quote($key, '/') . '(?:\s|$)/u', $remainder) === 1) {
                $figure = $name;
                $figureLength = strlen($key);
            }
        }
        if ($figure !== null) return ['figure', $figure];
        if (preg_match('/\bconfirmed style\b|\bsecret\b/u', $remainder) === 1) return ['figure', null];
        return ['box', null];
    }
}
