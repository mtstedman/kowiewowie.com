<?php

declare(strict_types=1);

namespace Wowie\Api\Collectibles;

use InvalidArgumentException;
use JsonException;
use RuntimeException;

/** Validated adapter for the versioned Skullpanda and Nommi catalog supplements. */
final class CollectibleCatalogSupplement
{
    /** @var array<string, array<string, mixed>> */
    private static array $mappingCache = [];

    public function __construct(private readonly string $catalogPath)
    {
    }

    public function sourceKey(): string
    {
        return $this->catalog()['sourceKey'];
    }

    public function brand(): string
    {
        return $this->catalog()['brand'];
    }

    /** @return list<array<string, mixed>> */
    public function fetchProducts(): array
    {
        $catalog = $this->catalog();
        $products = [];
        foreach ($catalog['series'] as $series) {
            $variants = [];
            foreach ($series['figures'] as $figure) {
                $variants[] = [
                    'name' => $figure['name'],
                    'is_secret' => $figure['isSecret'],
                    'image_url' => null,
                    'price_cents' => null,
                    'currency' => null,
                    'price_kind' => null,
                    'price_source_url' => null,
                    'price_observed_on' => null,
                ];
            }
            $products[] = [
                'external_id' => $series['product']['externalId'],
                'title' => $series['product']['title'],
                'product_url' => $series['product']['url'],
                'image_url' => null,
                'price_cents' => null,
                'currency' => null,
                'price_kind' => null,
                'price_source_url' => null,
                'price_observed_on' => null,
                'release_year' => $series['releaseYear'],
                'variants' => $variants,
                'preserve_existing' => true,
            ];
        }
        return $products;
    }

    /**
     * Series lookups for the shelf: exact store identities and URLs, plus a
     * title index the listing classifier matches unmapped store listings
     * against (see CollectibleListingClassifier).
     *
     * @return array{identity: array<string, array<string, mixed>>, url: array<string, array<string, mixed>>, titles: array<string, list<array<string, mixed>>>}
     */
    public static function mappings(string $projectRoot): array
    {
        if (isset(self::$mappingCache[$projectRoot])) return self::$mappingCache[$projectRoot];
        $maps = ['identity' => [], 'url' => [], 'titles' => []];
        foreach (['skullpanda-catalog.json', 'nommi-catalog.json'] as $file) {
            $source = new self($projectRoot . '/htdocs/assets/data/' . $file);
            $catalog = $source->catalog();
            foreach ($catalog['series'] as $series) {
                $value = [
                    'series_id' => $catalog['brand'] . ':' . $series['id'],
                    'series_title' => $series['name'],
                    'series_roster_status' => $series['rosterStatus'],
                    'series_release_year' => $series['releaseYear'],
                    'series_line' => CollectibleListingClassifier::lineForTitle($catalog['brand'], $series['product']['title']),
                    'series_product_external_id' => $series['product']['externalId'],
                ];
                $maps['titles'][$catalog['sourceKey']][] = [
                    'value' => $value,
                    'product_title' => CollectibleListingClassifier::normalize($series['product']['title']),
                    'name' => CollectibleListingClassifier::normalize($series['name']),
                    // The store's own collection/product slugs, cited as sources.
                    'aliases' => array_values(array_unique(array_filter(array_map(
                        static fn (array $source): ?string => CollectibleListingClassifier::slugTitle($source['url']),
                        array_merge($series['sources'], [['url' => $series['product']['url']]]),
                    )))),
                    'figures' => array_map(static fn (array $figure): string => $figure['name'], $series['figures']),
                ];
                $maps['identity'][$catalog['sourceKey'] . "\0" . $series['product']['externalId']] = $value;
                $maps['url'][$catalog['sourceKey'] . "\0" . $series['product']['url']] = $value;
                foreach ($series['members'] as $member) {
                    if ($member['externalId'] !== null) $maps['identity'][$catalog['sourceKey'] . "\0" . $member['externalId']] = $value;
                    $maps['url'][$catalog['sourceKey'] . "\0" . $member['url']] = $value;
                }
            }
        }
        $raw = file_get_contents($projectRoot . '/htdocs/assets/data/sonny-angels.json');
        try { $sonny = is_string($raw) ? json_decode($raw, true, 512, JSON_THROW_ON_ERROR) : null; } catch (JsonException) { $sonny = null; }
        if (is_array($sonny) && is_array($sonny['series'] ?? null)) {
            $counts = [];
            foreach (is_array($sonny['figures'] ?? null) ? $sonny['figures'] : [] as $figure) if (is_array($figure) && is_string($figure['seriesId'] ?? null)) $counts[$figure['seriesId']] = ($counts[$figure['seriesId']] ?? 0) + 1;
            foreach ($sonny['series'] as $series) if (is_array($series) && is_string($series['id'] ?? null) && is_string($series['name'] ?? null)) {
                $maps['identity'][SonnyAngelCatalogSource::SOURCE_KEY . "\0" . $series['id']] = [
                    'series_id' => 'sonny-angel:' . $series['id'],
                    'series_title' => $series['name'],
                    'series_roster_status' => ($counts[$series['id']] ?? 0) > 0 ? 'partial' : 'unknown',
                    'series_release_year' => is_int($series['releaseYear'] ?? null) ? $series['releaseYear'] : null,
                    // Sonny Angel's own archive families are its lines.
                    'series_line' => is_string($series['family'] ?? null) && $series['family'] !== '' ? $series['family'] : 'other',
                    'series_product_external_id' => $series['id'],
                ];
            }
        }
        return self::$mappingCache[$projectRoot] = $maps;
    }

    /** @return array<string, mixed> */
    private function catalog(): array
    {
        $raw = file_get_contents($this->catalogPath);
        if ($raw === false) throw new RuntimeException('The collectible catalog supplement could not be read.');
        try { $data = json_decode($raw, true, 512, JSON_THROW_ON_ERROR); } catch (JsonException $e) { throw new RuntimeException('The collectible catalog supplement is invalid JSON.', 0, $e); }

        if (!is_array($data) || !self::hasKeys($data, ['schemaVersion', 'checkedAt', 'brand', 'sourceKey', 'coverage', 'series'])) throw new InvalidArgumentException('The collectible catalog supplement has an invalid shape.');
        $sourceKeys = ['skullpanda' => 'popmart-us', 'nommi' => 'toysez-nommi'];
        if (($data['schemaVersion'] ?? null) !== 1 || !self::date($data['checkedAt'] ?? null) || !is_string($data['brand'] ?? null) || !isset($sourceKeys[$data['brand']]) || ($data['sourceKey'] ?? null) !== $sourceKeys[$data['brand']]) throw new InvalidArgumentException('The collectible catalog supplement has an invalid shape.');
        $coverage = $data['coverage'];
        if (!is_array($coverage) || !self::hasKeys($coverage, ['summary', 'gaps']) || !self::nonEmptyString($coverage['summary'] ?? null) || !is_array($coverage['gaps'] ?? null) || !array_is_list($coverage['gaps']) || $coverage['gaps'] === []) throw new InvalidArgumentException('The collectible catalog supplement has invalid coverage.');
        foreach ($coverage['gaps'] as $gap) if (!self::nonEmptyString($gap)) throw new InvalidArgumentException('The collectible catalog supplement has invalid coverage.');
        if (!is_array($data['series'] ?? null) || !array_is_list($data['series']) || $data['series'] === []) throw new InvalidArgumentException('The collectible catalog supplement has an invalid shape.');

        $seriesIds = []; $figureIds = []; $mappedIdentities = []; $mappedUrls = [];
        foreach ($data['series'] as $series) {
            if (!is_array($series) || !self::hasKeys($series, ['id', 'name', 'releaseYear', 'rosterStatus', 'sources', 'product', 'members', 'figures'])) throw new InvalidArgumentException('The collectible catalog supplement contains an invalid series.');
            $seriesId = $series['id'] ?? null;
            if (!is_string($seriesId) || preg_match('/^[a-z0-9]+(?:-[a-z0-9]+)*$/D', $seriesId) !== 1 || isset($seriesIds[$seriesId]) || !self::nonEmptyString($series['name'] ?? null) || (!is_int($series['releaseYear'] ?? null) && ($series['releaseYear'] ?? null) !== null) || !in_array($series['rosterStatus'] ?? null, ['complete', 'partial', 'unknown'], true) || !is_array($series['sources'] ?? null) || !array_is_list($series['sources']) || $series['sources'] === [] || !is_array($series['members'] ?? null) || !array_is_list($series['members']) || !is_array($series['figures'] ?? null) || !array_is_list($series['figures'])) throw new InvalidArgumentException('The collectible catalog supplement contains an invalid series.');
            if (($series['rosterStatus'] === 'complete' && $series['figures'] === []) || ($series['rosterStatus'] === 'unknown' && $series['figures'] !== [])) throw new InvalidArgumentException('The collectible catalog supplement contains an invalid roster.');
            $seriesIds[$seriesId] = true;

            $seriesSources = [];
            foreach ($series['sources'] as $source) {
                $sourceKey = self::sourceFingerprint($source);
                if ($sourceKey === null || isset($seriesSources[$sourceKey])) throw new InvalidArgumentException('The collectible catalog supplement contains an invalid source.');
                $seriesSources[$sourceKey] = true;
            }

            $product = $series['product'];
            if (!is_array($product) || !self::hasKeys($product, ['externalId', 'title', 'url']) || !self::nonEmptyString($product['externalId'] ?? null) || !self::nonEmptyString($product['title'] ?? null) || !self::https($product['url'] ?? null)) throw new InvalidArgumentException('The collectible catalog supplement contains an invalid product.');
            self::registerMapping($data['sourceKey'], $product['externalId'], $product['url'], $seriesId, $mappedIdentities, $mappedUrls);

            foreach ($series['members'] as $member) {
                if (!is_array($member) || !self::hasKeys($member, ['externalId', 'url']) || (($member['externalId'] ?? null) !== null && !self::nonEmptyString($member['externalId'])) || !self::https($member['url'] ?? null)) throw new InvalidArgumentException('The collectible catalog supplement contains an invalid member.');
                self::registerMapping($data['sourceKey'], $member['externalId'], $member['url'], $seriesId, $mappedIdentities, $mappedUrls);
            }

            $figureNames = [];
            foreach ($series['figures'] as $figure) {
                if (!is_array($figure) || !self::hasKeys($figure, ['id', 'name', 'isSecret', 'sources']) || !is_string($figure['id'] ?? null) || !str_starts_with($figure['id'], $seriesId . ':') || isset($figureIds[$figure['id']]) || !self::nonEmptyString($figure['name'] ?? null) || !is_bool($figure['isSecret'] ?? null) || !is_array($figure['sources'] ?? null) || !array_is_list($figure['sources']) || $figure['sources'] === []) throw new InvalidArgumentException('The collectible catalog supplement contains an invalid figure.');
                $nameKey = function_exists('mb_strtolower') ? mb_strtolower(trim($figure['name']), 'UTF-8') : strtolower(trim($figure['name']));
                if (isset($figureNames[$nameKey])) throw new InvalidArgumentException('The collectible catalog supplement contains duplicate figure names.');
                $figureNames[$nameKey] = true; $figureIds[$figure['id']] = true;
                $figureSources = [];
                foreach ($figure['sources'] as $source) {
                    $sourceKey = self::sourceFingerprint($source);
                    if ($sourceKey === null || !isset($seriesSources[$sourceKey]) || isset($figureSources[$sourceKey])) throw new InvalidArgumentException('The collectible catalog supplement contains an invalid source.');
                    $figureSources[$sourceKey] = true;
                }
            }
        }
        return $data;
    }

    /** @param list<string> $keys */
    private static function hasKeys(array $value, array $keys): bool
    {
        $actual = array_keys($value); sort($actual); sort($keys);
        return $actual === $keys;
    }

    private static function nonEmptyString(mixed $value): bool
    {
        return is_string($value) && trim($value) !== '';
    }

    private static function date(mixed $value): bool
    {
        if (!is_string($value) || preg_match('/^\d{4}-\d{2}-\d{2}$/D', $value) !== 1) return false;
        [$year, $month, $day] = array_map('intval', explode('-', $value));
        return checkdate($month, $day, $year);
    }

    private static function sourceFingerprint(mixed $source): ?string
    {
        if (!is_array($source) || !self::hasKeys($source, ['url', 'tier', 'checkedAt']) || !self::https($source['url'] ?? null) || !in_array($source['tier'] ?? null, ['official', 'secondary'], true) || !self::date($source['checkedAt'] ?? null)) return null;
        return $source['url'] . "\0" . $source['tier'] . "\0" . $source['checkedAt'];
    }

    /** @param array<string, string> $identities @param array<string, string> $urls */
    private static function registerMapping(string $sourceKey, ?string $externalId, string $url, string $seriesId, array &$identities, array &$urls): void
    {
        if ($externalId !== null) {
            $identity = $sourceKey . "\0" . $externalId;
            if (isset($identities[$identity])) throw new InvalidArgumentException('The collectible catalog supplement contains an identity collision.');
            $identities[$identity] = $seriesId;
        }
        $urlKey = $sourceKey . "\0" . $url;
        if (isset($urls[$urlKey])) throw new InvalidArgumentException('The collectible catalog supplement contains a URL collision.');
        $urls[$urlKey] = $seriesId;
    }

    private static function https(mixed $url): bool
    {
        return is_string($url) && filter_var($url, FILTER_VALIDATE_URL) !== false && strtolower((string) parse_url($url, PHP_URL_SCHEME)) === 'https';
    }
}
