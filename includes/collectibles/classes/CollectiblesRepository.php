<?php

declare(strict_types=1);

namespace Wowie\Api\Collectibles;

use InvalidArgumentException;
use PDO;
use Throwable;

final class CollectiblesRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    /**
     * @param list<array{
     *     external_id: string,
     *     title: string,
     *     product_url: string,
     *     image_url: ?string,
     *     price_cents: ?int,
     *     currency: ?string,
     *     variants: list<array{
     *         name: string,
     *         is_secret: bool,
     *         image_url: ?string,
     *         price_cents: ?int,
     *         currency: ?string
     *     }>
     * }> $products
     * @return array{products: int, variants: int}
     */
    public function upsertSourceCatalog(string $sourceKey, string $brand, array $products): array
    {
        if ($products === []) {
            throw new InvalidArgumentException('The product list must not be empty.');
        }
        if (!in_array($brand, ['skullpanda', 'nommi', 'sonny-angel'], true)) {
            throw new InvalidArgumentException('The brand must be skullpanda, nommi, or sonny-angel.');
        }

        foreach ($products as $product) {
            $this->assertHttpsUrl($product['product_url']);
            $this->assertImageUrl($product['image_url']);
            foreach ($product['variants'] as $variant) {
                $this->assertImageUrl($variant['image_url']);
                $this->assertHttpsUrl($variant['price_source_url'] ?? null);
            }
            $this->assertHttpsUrl($product['price_source_url'] ?? null);
        }

        $resolveProductStatement = $this->pdo->prepare('SELECT external_id FROM collectible_products WHERE source_key = :source_key AND product_url = :product_url ORDER BY id LIMIT 1');
        $productStatement = $this->pdo->prepare(<<<'SQL'
            INSERT INTO collectible_products (
                brand,
                source_key,
                external_id,
                title,
                product_url,
                image_url,
                price_cents,
                currency,
                price_kind,
                price_source_url,
                price_observed_on,
                release_year,
                sku,
                barcode
            ) VALUES (
                :brand,
                :source_key,
                :external_id,
                :title,
                :product_url,
                :image_url,
                :price_cents,
                :currency,
                :price_kind,
                :price_source_url,
                :price_observed_on,
                :release_year,
                :sku,
                :barcode
            )
            ON CONFLICT (source_key, external_id) DO UPDATE SET
                title = EXCLUDED.title,
                product_url = EXCLUDED.product_url,
                image_url = CASE WHEN :preserve_existing THEN COALESCE(collectible_products.image_url, EXCLUDED.image_url) ELSE EXCLUDED.image_url END,
                price_cents = CASE WHEN :preserve_existing THEN COALESCE(collectible_products.price_cents, EXCLUDED.price_cents) ELSE EXCLUDED.price_cents END,
                currency = CASE WHEN :preserve_existing THEN COALESCE(collectible_products.currency, EXCLUDED.currency) ELSE EXCLUDED.currency END,
                price_kind = CASE WHEN :preserve_existing THEN COALESCE(collectible_products.price_kind, EXCLUDED.price_kind) ELSE EXCLUDED.price_kind END,
                price_source_url = CASE WHEN :preserve_existing THEN COALESCE(collectible_products.price_source_url, EXCLUDED.price_source_url) ELSE EXCLUDED.price_source_url END,
                price_observed_on = CASE WHEN :preserve_existing THEN COALESCE(collectible_products.price_observed_on, EXCLUDED.price_observed_on) ELSE EXCLUDED.price_observed_on END,
                release_year = COALESCE(EXCLUDED.release_year, collectible_products.release_year),
                sku = COALESCE(EXCLUDED.sku, collectible_products.sku),
                barcode = COALESCE(EXCLUDED.barcode, collectible_products.barcode),
                last_seen_at = now()
            RETURNING id
        SQL);
        $existingVariantsStatement = $this->pdo->prepare('SELECT id, name FROM collectible_variants WHERE product_id = :product_id ORDER BY id');
        $updateVariantStatement = $this->pdo->prepare(<<<'SQL'
            UPDATE collectible_variants SET
                is_secret = :is_secret,
                image_url = CASE WHEN :preserve_existing THEN COALESCE(image_url, :image_url) ELSE :image_url END,
                price_cents = CASE WHEN :preserve_existing THEN COALESCE(price_cents, :price_cents) ELSE :price_cents END,
                currency = CASE WHEN :preserve_existing THEN COALESCE(currency, :currency) ELSE :currency END,
                price_kind = CASE WHEN :preserve_existing THEN COALESCE(price_kind, :price_kind) ELSE :price_kind END,
                price_source_url = CASE WHEN :preserve_existing THEN COALESCE(price_source_url, :price_source_url) ELSE :price_source_url END,
                price_observed_on = CASE WHEN :preserve_existing THEN COALESCE(price_observed_on, :price_observed_on) ELSE :price_observed_on END,
                sku = COALESCE(:sku, sku),
                barcode = COALESCE(:barcode, barcode),
                position = :position
            WHERE id = :id
        SQL);
        $variantStatement = $this->pdo->prepare(<<<'SQL'
            INSERT INTO collectible_variants (
                product_id,
                name,
                is_secret,
                image_url,
                price_cents,
                currency,
                price_kind,
                price_source_url,
                price_observed_on,
                sku,
                barcode,
                position
            ) VALUES (
                :product_id,
                :name,
                :is_secret,
                :image_url,
                :price_cents,
                :currency,
                :price_kind,
                :price_source_url,
                :price_observed_on,
                :sku,
                :barcode,
                :position
            )
        SQL);

        $variantCount = 0;
        $this->pdo->beginTransaction();
        try {
            foreach ($products as $product) {
                if (str_starts_with($product['external_id'], 'catalog:')) {
                    $resolveProductStatement->execute(['source_key' => $sourceKey, 'product_url' => $product['product_url']]);
                    $resolvedExternalId = $resolveProductStatement->fetchColumn();
                    $resolveProductStatement->closeCursor();
                    if ($resolvedExternalId !== false) $product['external_id'] = (string) $resolvedExternalId;
                }
                $productStatement->execute([
                    'brand' => $brand,
                    'source_key' => $sourceKey,
                    'external_id' => $product['external_id'],
                    'title' => $product['title'],
                    'product_url' => $product['product_url'],
                    'image_url' => $product['image_url'],
                    'price_cents' => $product['price_cents'],
                    'currency' => $product['currency'],
                    'price_kind' => $product['price_kind'] ?? null,
                    'price_source_url' => $product['price_source_url'] ?? null,
                    'price_observed_on' => $product['price_observed_on'] ?? null,
                    'release_year' => $product['release_year'] ?? null,
                    'sku' => $product['sku'] ?? null,
                    'barcode' => $product['barcode'] ?? null,
                    'preserve_existing' => $this->sqlBoolean(($product['preserve_existing'] ?? false) === true),
                ]);
                $productId = $productStatement->fetchColumn();
                // SQLite refuses to commit while a RETURNING cursor is open.
                $productStatement->closeCursor();
                if ($productId === false) {
                    throw new \RuntimeException('The collectible product row could not be saved.');
                }

                $existingVariantsStatement->execute(['product_id' => (string) $productId]);
                $existing = [];
                foreach ($existingVariantsStatement->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
                    $key = function_exists('mb_strtolower') ? mb_strtolower((string) $row['name'], 'UTF-8') : strtolower((string) $row['name']);
                    $existing[$key] ??= (string) $row['id'];
                }
                foreach ($product['variants'] as $position => $variant) {
                    $key = function_exists('mb_strtolower') ? mb_strtolower($variant['name'], 'UTF-8') : strtolower($variant['name']);
                    $values = [
                        'is_secret' => $this->sqlBoolean($this->databaseBoolean($variant['is_secret'])), 'image_url' => $variant['image_url'],
                        'price_cents' => $variant['price_cents'], 'currency' => $variant['currency'],
                        'price_kind' => $variant['price_kind'] ?? null, 'price_source_url' => $variant['price_source_url'] ?? null,
                        'price_observed_on' => $variant['price_observed_on'] ?? null, 'position' => $position,
                        'sku' => $variant['sku'] ?? null, 'barcode' => $variant['barcode'] ?? null,
                    ];
                    if (isset($existing[$key])) {
                        $updateVariantStatement->execute($values + ['id' => $existing[$key], 'preserve_existing' => $this->sqlBoolean(($product['preserve_existing'] ?? false) === true)]);
                    } else {
                        $variantStatement->execute($values + ['product_id' => (string) $productId, 'name' => $variant['name']]);
                    }
                    $variantCount++;
                }
            }
            $this->pdo->commit();
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $error;
        }

        return ['products' => count($products), 'variants' => $variantCount];
    }

    /**
     * Remove a catalog's own rows it no longer lists (their variants cascade).
     * Only rows of $sourceKey whose external_id starts with $prefix are
     * candidates, so store listings sharing a source key are never touched.
     * Called only after that catalog imported successfully.
     *
     * @param list<string> $keepExternalIds
     */
    public function retireCatalogProducts(string $sourceKey, array $keepExternalIds, string $prefix): int
    {
        if ($keepExternalIds === []) return 0;
        $placeholders = [];
        $parameters = ['source_key' => $sourceKey, 'prefix' => str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $prefix) . '%'];
        foreach (array_values($keepExternalIds) as $index => $externalId) {
            $placeholders[] = ':keep_' . $index;
            $parameters['keep_' . $index] = $externalId;
        }
        $retired = sprintf(
            "SELECT id FROM collectible_products WHERE source_key = :source_key AND external_id LIKE :prefix ESCAPE '\\' AND external_id NOT IN (%s)",
            implode(', ', $placeholders),
        );
        // Variants go first and explicitly, so this holds without enforced
        // foreign keys too.
        $this->pdo->beginTransaction();
        try {
            $this->pdo->prepare("DELETE FROM collectible_variants WHERE product_id IN ({$retired})")->execute($parameters);
            $statement = $this->pdo->prepare("DELETE FROM collectible_products WHERE id IN ({$retired})");
            $statement->execute($parameters);
            $this->pdo->commit();
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) $this->pdo->rollBack();
            throw $error;
        }
        return $statement->rowCount();
    }

    /**
     * @return array{
     *     items: list<array<string, mixed>>,
     *     total: int,
     *     last_synced_at: ?string
     * }
     */
    /**
     * Listings matching the text and brand, narrowed to one release year
     * (`all`, `unknown`, or a year) and one set. Series membership and years
     * are decided by the read-time classifier, so every matching listing is
     * classified (a few hundred at most) and only the requested page is
     * loaded in full. Facets describe the year and set choices for the same
     * text and brand: years ignore the year and set filters, sets ignore only
     * the set filter. A set filter may name a set, a set-less group
     * (`unclassified:<brand>:<line>`), or a listing id from older links.
     *
     * @return array{items: list<array<string, mixed>>, total: int, last_synced_at: ?string, series: ?string, facets: array{years: list<array{year: ?int, series: int, listings: int}>, series: list<array{id: string, title: ?string, brand: string, line: string, year: ?int, listings: int}>}}
     */
    public function search(?string $query, ?string $brand, string $sort, int $limit, int $offset, ?string $year = null, ?string $series = null): array
    {
        $conditions = [];
        $parameters = [];
        if ($query !== null && $query !== '') {
            $pattern = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $query) . '%';
            $conditions[] = <<<'SQL'
                (
                    p.title ILIKE :query_title ESCAPE '\'
                    OR p.sku ILIKE :query_sku ESCAPE '\'
                    OR p.barcode = :query_barcode
                    OR EXISTS (
                        SELECT 1
                        FROM collectible_variants search_variant
                        WHERE search_variant.product_id = p.id
                          AND (
                              search_variant.name ILIKE :query_variant ESCAPE '\'
                              OR search_variant.sku ILIKE :query_variant_sku ESCAPE '\'
                              OR search_variant.barcode = :query_variant_barcode
                          )
                    )
                )
            SQL;
            $parameters['query_title'] = $pattern;
            $parameters['query_sku'] = $pattern;
            $parameters['query_variant_sku'] = $pattern;
            $parameters['query_barcode'] = trim($query);
            $parameters['query_variant_barcode'] = trim($query);
            $parameters['query_variant'] = $pattern;
        }
        if ($brand !== null && $brand !== '') {
            $conditions[] = 'p.brand = :brand';
            $parameters['brand'] = $brand;
        }
        $where = $conditions === [] ? '' : 'WHERE ' . implode(' AND ', $conditions);
        $effectivePrice = 'COALESCE(p.price_cents, (SELECT min(sort_variant.price_cents) FROM collectible_variants sort_variant WHERE sort_variant.product_id = p.id))';
        $orderBy = match ($sort) {
            'name-desc' => 'p.title DESC, p.id DESC',
            'price-asc' => $effectivePrice . ' ASC NULLS LAST, p.title, p.id',
            'price-desc' => $effectivePrice . ' DESC NULLS LAST, p.title, p.id',
            'newest' => 'p.release_year DESC NULLS LAST, p.last_seen_at DESC, p.title, p.id',
            'oldest' => 'p.release_year ASC NULLS LAST, p.first_seen_at ASC, p.title, p.id',
            default => 'p.title, p.id',
        };

        $listingStatement = $this->pdo->prepare(sprintf(<<<'SQL'
            SELECT p.id, p.source_key, p.brand, p.external_id, p.product_url, p.title, p.release_year
            FROM collectible_products p
            %s
            ORDER BY %s
        SQL, $where, $orderBy));
        $this->bindSearchParameters($listingStatement, $parameters);
        $listingStatement->execute();
        $catalogMappings = CollectibleCatalogSupplement::mappings(dirname(__DIR__, 3));
        $listings = [];
        foreach ($listingStatement->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
            $mapping = CollectibleListingClassifier::classify(
                $catalogMappings,
                (string) $row['source_key'],
                (string) $row['brand'],
                (string) $row['external_id'],
                (string) $row['product_url'],
                (string) $row['title'],
            );
            $listings[(string) $row['id']] = [
                'id' => (string) $row['id'],
                'brand' => (string) $row['brand'],
                'mapping' => $mapping,
                'group' => $mapping['series_id'] ?? 'unclassified:' . $row['brand'] . ($mapping['line'] === '' ? '' : ':' . $mapping['line']),
                'year' => is_int($mapping['series_release_year'])
                    ? $mapping['series_release_year']
                    : ($row['release_year'] === null ? null : (int) $row['release_year']),
            ];
        }

        $seriesId = $series === null || $series === '' ? null : $series;
        if ($seriesId !== null && isset($listings[$seriesId]) && !in_array($seriesId, array_column($listings, 'group'), true)) {
            $seriesId = $listings[$seriesId]['group'];
        }
        $inYear = static fn (array $listing): bool => match (true) {
            $year === null || $year === 'all' => true,
            $year === 'unknown' => $listing['year'] === null,
            default => $listing['year'] === (int) $year,
        };

        $years = [];
        $seriesFacets = [];
        $selected = [];
        foreach ($listings as $listing) {
            $yearKey = $listing['year'] === null ? 'unknown' : (string) $listing['year'];
            $years[$yearKey] ??= ['year' => $listing['year'], 'series' => [], 'listings' => 0];
            $years[$yearKey]['series'][$listing['group']] = true;
            $years[$yearKey]['listings']++;
            if (!$inYear($listing)) continue;
            $mapping = $listing['mapping'];
            $seriesFacets[$listing['group']] ??= [
                'id' => $listing['group'],
                'title' => $mapping['series_id'] === null ? null : $mapping['series_title'],
                'brand' => $listing['brand'],
                'line' => $mapping['line'],
                'year' => $mapping['series_id'] === null ? null : $listing['year'],
                'listings' => 0,
            ];
            $seriesFacets[$listing['group']]['listings']++;
            if ($seriesId === null || $listing['group'] === $seriesId) $selected[] = $listing;
        }
        $yearFacets = array_map(
            static fn (array $entry): array => ['year' => $entry['year'], 'series' => count($entry['series']), 'listings' => $entry['listings']],
            array_values($years),
        );
        usort($yearFacets, static fn (array $left, array $right): int => ($left['year'] === null) <=> ($right['year'] === null)
            ?: ($right['year'] ?? 0) <=> ($left['year'] ?? 0));
        $seriesFacets = array_values($seriesFacets);
        usort($seriesFacets, static fn (array $left, array $right): int => ($left['title'] === null) <=> ($right['title'] === null)
            ?: strcasecmp((string) $left['title'], (string) $right['title'])
            ?: strcmp($left['id'], $right['id']));

        $page = array_slice($selected, $offset, $limit);
        $items = [];
        $itemIndexes = [];
        if ($page !== []) {
            $pagePlaceholders = [];
            foreach ($page as $index => $listing) {
                $pagePlaceholders['page_' . $index] = $listing['id'];
            }
            $itemsStatement = $this->pdo->prepare(sprintf(<<<'SQL'
                SELECT
                    p.id,
                    p.brand,
                    p.title,
                    p.product_url,
                    p.image_url,
                    p.price_cents,
                    p.currency,
                    p.price_kind,
                    p.price_source_url,
                    p.price_observed_on,
                    p.release_year,
                    p.sku,
                    p.barcode,
                    p.source_key,
                    p.last_seen_at,
                    %s AS sort_price_cents
                FROM collectible_products p
                WHERE p.id IN (%s)
            SQL, $effectivePrice, implode(', ', array_map(static fn (string $name): string => ':' . $name, array_keys($pagePlaceholders)))));
            $this->bindSearchParameters($itemsStatement, $pagePlaceholders);
            $itemsStatement->execute();
            $rows = [];
            foreach ($itemsStatement->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
                $rows[(string) $row['id']] = $row;
            }
            foreach ($page as $listing) {
                $row = $rows[$listing['id']] ?? null;
                if ($row === null) continue;
                $mapping = $listing['mapping'];
                $itemIndexes[$listing['id']] = count($items);
                $items[] = [
                    'id' => $listing['id'],
                    'brand' => (string) $row['brand'],
                    'title' => (string) $row['title'],
                    'product_url' => (string) $row['product_url'],
                    'image_url' => $row['image_url'] === null ? null : (string) $row['image_url'],
                    'price_cents' => $row['price_cents'] === null ? null : (int) $row['price_cents'],
                    'currency' => $row['currency'] === null ? null : (string) $row['currency'],
                    'price_kind' => $row['price_kind'] === null ? null : (string) $row['price_kind'],
                    'price_source_url' => $row['price_source_url'] === null ? null : (string) $row['price_source_url'],
                    'price_observed_on' => $row['price_observed_on'] === null ? null : (string) $row['price_observed_on'],
                    'release_year' => $row['release_year'] === null ? null : (int) $row['release_year'],
                    'sku' => $row['sku'] === null ? null : (string) $row['sku'],
                    'barcode' => $row['barcode'] === null ? null : (string) $row['barcode'],
                    'sort_price_cents' => $row['sort_price_cents'] === null ? null : (int) $row['sort_price_cents'],
                    'source_key' => (string) $row['source_key'],
                    'series_id' => $mapping['series_id'],
                    'series_title' => $mapping['series_title'],
                    'series_roster_status' => $mapping['series_roster_status'],
                    'series_release_year' => $mapping['series_release_year'],
                    'line' => $mapping['line'],
                    'listing_kind' => $mapping['listing_kind'],
                    'listing_figure' => $mapping['listing_figure'],
                    'last_seen_at' => $this->formatTimestamp((string) $row['last_seen_at']),
                    'variants' => [],
                ];
            }
        }

        if ($itemIndexes !== []) {
            $placeholders = [];
            foreach (array_keys($itemIndexes) as $index => $productId) {
                $placeholders['product_' . $index] = $productId;
            }
            $variantStatement = $this->pdo->prepare(sprintf(<<<'SQL'
                SELECT
                    product_id,
                    name,
                    is_secret,
                    image_url,
                    price_cents,
                    currency,
                    price_kind,
                    price_source_url,
                    price_observed_on,
                    sku,
                    barcode
                FROM collectible_variants
                WHERE product_id IN (%s)
                ORDER BY position, id
            SQL, implode(', ', array_map(static fn (string $name): string => ':' . $name, array_keys($placeholders)))));
            foreach ($placeholders as $name => $productId) {
                $variantStatement->bindValue(':' . $name, $productId, PDO::PARAM_STR);
            }
            $variantStatement->execute();
            foreach ($variantStatement->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
                $productId = (string) $row['product_id'];
                $itemIndex = $itemIndexes[$productId];
                if (self::isListingEcho((string) $row['name'], $items[$itemIndex]['brand'], $items[$itemIndex]['title'])) continue;
                $items[$itemIndex]['variants'][] = [
                    'name' => (string) $row['name'],
                    'is_secret' => $this->databaseBoolean($row['is_secret']),
                    'image_url' => $row['image_url'] === null ? null : (string) $row['image_url'],
                    'price_cents' => $row['price_cents'] === null ? null : (int) $row['price_cents'],
                    'currency' => $row['currency'] === null ? null : (string) $row['currency'],
                    'price_kind' => $row['price_kind'] === null ? null : (string) $row['price_kind'],
                    'price_source_url' => $row['price_source_url'] === null ? null : (string) $row['price_source_url'],
                    'price_observed_on' => $row['price_observed_on'] === null ? null : (string) $row['price_observed_on'],
                    'sku' => $row['sku'] === null ? null : (string) $row['sku'],
                    'barcode' => $row['barcode'] === null ? null : (string) $row['barcode'],
                ];
            }
        }

        // Figures without a stored picture take a downloaded one, by name or, for a
        // single-figure listing, by the figure it sells; a set without box art
        // shows its first pictured figure.
        $figureImages = CollectibleFigureImages::load(dirname(__DIR__, 3));
        foreach ($items as &$item) {
            foreach ($item['variants'] as &$variant) {
                $variant['image_url'] ??= $figureImages->forFigure($item['series_id'], $variant['name'])
                    ?? (count($item['variants']) === 1 ? $figureImages->forFigure($item['series_id'], $item['listing_figure']) : null);
            }
            unset($variant);
            if ($item['image_url'] === null) {
                foreach ($item['variants'] as $variant) {
                    if ($variant['image_url'] !== null) {
                        $item['image_url'] = $variant['image_url'];
                        break;
                    }
                }
            }
        }
        unset($item);

        $lastSynced = $this->pdo->query('SELECT max(last_seen_at) FROM collectible_products')->fetchColumn();

        return [
            'items' => $items,
            'total' => count($selected),
            'last_synced_at' => $lastSynced === false || $lastSynced === null ? null : $this->formatTimestamp((string) $lastSynced),
            'series' => $seriesId,
            'facets' => ['years' => $yearFacets, 'series' => $seriesFacets],
        ];
    }

    private function assertHttpsUrl(?string $url): void
    {
        if ($url === null) {
            return;
        }
        if (filter_var($url, FILTER_VALIDATE_URL) === false || strtolower((string) parse_url($url, PHP_URL_SCHEME)) !== 'https') {
            throw new InvalidArgumentException('Collectible product and image URLs must use HTTPS.');
        }
    }

    private function assertImageUrl(?string $url): void
    {
        if ($url === null) {
            return;
        }
        if (preg_match('#^/assets/images/sonny-angels/[A-Za-z0-9_./()@%+,&-]+$#D', $url) === 1
            && !str_contains($url, '/../') && !str_contains($url, '/./')) {
            return;
        }
        $this->assertHttpsUrl($url);
    }

    /** @param array<string, string> $parameters */
    /**
     * Store pages print the brand and the listing's own title near the figure
     * list, and the page scraper has stored both as "figures". Neither is one.
     */
    private static function isListingEcho(string $name, string $brand, string $title): bool
    {
        $normalize = static fn (string $text): string => strtolower(trim((string) preg_replace('/\s+/u', ' ', $text)));
        $candidate = $normalize($name);
        $brandNames = ['skullpanda' => ['skullpanda', 'skull panda'], 'nommi' => ['nommi'], 'sonny-angel' => ['sonny angel', 'sonny angels']][$brand] ?? [];

        return $candidate === $normalize($title) || in_array($candidate, [...$brandNames, 'pop mart', 'popmart'], true);
    }

    private function bindSearchParameters(\PDOStatement $statement, array $parameters): void
    {
        foreach ($parameters as $name => $value) {
            $statement->bindValue(':' . $name, $value, PDO::PARAM_STR);
        }
    }

    private function formatTimestamp(string $timestamp): string
    {
        return (new \DateTimeImmutable($timestamp))->format(DATE_ATOM);
    }

    /**
     * A PHP bool never goes to execute(): with native prepares PDO sends false
     * as '', which PostgreSQL rejects as a boolean (the catalog sync failed on
     * it). '1'/'0' read correctly in PostgreSQL and in the SQLite tests.
     */
    private function sqlBoolean(bool $value): string
    {
        return $value ? '1' : '0';
    }

    private function databaseBoolean(mixed $value): bool
    {
        return $value === true || $value === 1 || $value === '1' || $value === 't' || $value === 'true';
    }
}
