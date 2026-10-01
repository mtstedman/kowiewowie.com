<?php

declare(strict_types=1);

namespace Wowie\Api\Collectibles;

use RuntimeException;

/**
 * Adapts the curated Sonny Angel catalog to the shared collectibles schema.
 * The source file and its images ship with the application, so a sync is
 * deterministic and does not make a network request.
 */
final class SonnyAngelCatalogSource
{
    public const SOURCE_KEY = 'sonny-angels-catalog';
    public const BRAND = 'sonny-angel';

    public function __construct(private readonly string $catalogPath)
    {
    }

    public function sourceKey(): string
    {
        return self::SOURCE_KEY;
    }

    public function brand(): string
    {
        return self::BRAND;
    }

    /** @return list<array<string, mixed>> */
    public function fetchProducts(): array
    {
        $raw = file_get_contents($this->catalogPath);
        if ($raw === false) {
            throw new RuntimeException('The Sonny Angel catalog could not be read.');
        }

        $catalog = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
        if (!is_array($catalog) || !is_array($catalog['series'] ?? null) || !is_array($catalog['figures'] ?? null)) {
            throw new RuntimeException('The Sonny Angel catalog has an invalid shape.');
        }

        $figuresBySeries = [];
        foreach ($catalog['figures'] as $figure) {
            if (!is_array($figure) || !is_string($figure['seriesId'] ?? null)) {
                continue;
            }
            $figuresBySeries[$figure['seriesId']][] = $figure;
        }

        $products = [];
        foreach ($catalog['series'] as $series) {
            if (!is_array($series)) {
                continue;
            }
            $id = is_string($series['id'] ?? null) ? trim($series['id']) : '';
            $name = is_string($series['name'] ?? null) ? trim($series['name']) : '';
            if ($id === '' || $name === '') {
                continue;
            }

            $figures = $figuresBySeries[$id] ?? [];
            $variants = [];
            foreach ($figures as $figure) {
                $price = self::representativePrice(is_array($figure['prices'] ?? null) ? $figure['prices'] : []);
                $variants[] = [
                    'name' => (string) ($figure['name'] ?? ''),
                    'is_secret' => strtolower((string) ($figure['variant'] ?? '')) === 'secret',
                    'image_url' => self::firstImage($figure['images'] ?? []),
                    'price_cents' => $price['price_cents'],
                    'currency' => $price['currency'],
                    'price_kind' => $price['price_kind'],
                    'price_source_url' => $price['price_source_url'],
                    'price_observed_on' => $price['price_observed_on'],
                ];
            }

            $retail = self::lowestRetailPrice($figures);
            $productImage = self::firstImage($series['images'] ?? []);
            if ($productImage === null) {
                foreach ($variants as $variant) {
                    if ($variant['image_url'] !== null) {
                        $productImage = $variant['image_url'];
                        break;
                    }
                }
            }

            $products[] = [
                'external_id' => $id,
                'title' => $name,
                'product_url' => self::preferredSource($series['sources'] ?? []),
                'image_url' => $productImage,
                'price_cents' => $retail['price_cents'],
                'currency' => $retail['currency'],
                'price_kind' => $retail['price_cents'] === null ? null : 'retail',
                'price_source_url' => $retail['price_source_url'],
                'price_observed_on' => $retail['price_observed_on'],
                'release_year' => is_int($series['releaseYear'] ?? null) ? $series['releaseYear'] : null,
                'variants' => $variants,
            ];
        }

        return $products;
    }

    /** @param array<mixed> $prices
     *  @return array{price_cents: ?int, currency: ?string, price_kind: ?string, price_source_url: ?string, price_observed_on: ?string}
     */
    private static function representativePrice(array $prices): array
    {
        $rank = ['sold' => 3, 'asking' => 2, 'retail' => 1];
        $best = null;
        foreach ($prices as $price) {
            if (!is_array($price) || !isset($rank[$price['kind'] ?? '']) || !is_numeric($price['amount'] ?? null)) {
                continue;
            }
            $candidate = [
                'price_cents' => (int) round((float) $price['amount'] * 100),
                'currency' => is_string($price['currency'] ?? null) ? strtoupper($price['currency']) : null,
                'price_kind' => (string) $price['kind'],
                'price_source_url' => is_string($price['sourceUrl'] ?? null) ? $price['sourceUrl'] : null,
                'price_observed_on' => is_string($price['date'] ?? null) ? $price['date'] : null,
            ];
            if (
                $best === null
                || $rank[$candidate['price_kind']] > $rank[$best['price_kind']]
                || ($rank[$candidate['price_kind']] === $rank[$best['price_kind']]
                    && strcmp((string) $candidate['price_observed_on'], (string) $best['price_observed_on']) > 0)
            ) {
                $best = $candidate;
            }
        }

        return $best ?? [
            'price_cents' => null,
            'currency' => null,
            'price_kind' => null,
            'price_source_url' => null,
            'price_observed_on' => null,
        ];
    }

    /** @param list<array<mixed>> $figures
     *  @return array{price_cents: ?int, currency: ?string, price_source_url: ?string, price_observed_on: ?string}
     */
    private static function lowestRetailPrice(array $figures): array
    {
        $best = null;
        foreach ($figures as $figure) {
            foreach (is_array($figure['prices'] ?? null) ? $figure['prices'] : [] as $price) {
                if (!is_array($price) || ($price['kind'] ?? null) !== 'retail' || !is_numeric($price['amount'] ?? null)) {
                    continue;
                }
                $candidate = [
                    'price_cents' => (int) round((float) $price['amount'] * 100),
                    'currency' => is_string($price['currency'] ?? null) ? strtoupper($price['currency']) : null,
                    'price_source_url' => is_string($price['sourceUrl'] ?? null) ? $price['sourceUrl'] : null,
                    'price_observed_on' => is_string($price['date'] ?? null) ? $price['date'] : null,
                ];
                if ($best === null || $candidate['price_cents'] < $best['price_cents']) {
                    $best = $candidate;
                }
            }
        }

        return $best ?? ['price_cents' => null, 'currency' => null, 'price_source_url' => null, 'price_observed_on' => null];
    }

    private static function firstImage(mixed $images): ?string
    {
        foreach (is_array($images) ? $images : [] as $image) {
            $url = is_array($image) && is_string($image['url'] ?? null) ? $image['url'] : '';
            if (preg_match('#^/assets/images/sonny-angels/[A-Za-z0-9_./()@%+,&-]+$#D', $url) === 1
                && !str_contains($url, '/../') && !str_contains($url, '/./')) {
                return $url;
            }
        }
        return null;
    }

    private static function preferredSource(mixed $sources): string
    {
        $fallback = 'https://www.sonnyangel.com/en/products/';
        foreach (is_array($sources) ? $sources : [] as $source) {
            if (!is_string($source) || filter_var($source, FILTER_VALIDATE_URL) === false) {
                continue;
            }
            if (str_contains($source, 'sonnyangelusa.com/collections/')) {
                return $source;
            }
            $fallback = $source;
        }
        return $fallback;
    }
}
