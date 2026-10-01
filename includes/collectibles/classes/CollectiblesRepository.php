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
        if (!in_array($brand, ['skullpanda', 'nommi'], true)) {
            throw new InvalidArgumentException('The brand must be skullpanda or nommi.');
        }

        foreach ($products as $product) {
            $this->assertHttpsUrl($product['product_url']);
            $this->assertHttpsUrl($product['image_url']);
            foreach ($product['variants'] as $variant) {
                $this->assertHttpsUrl($variant['image_url']);
            }
        }

        $productStatement = $this->pdo->prepare(<<<'SQL'
            INSERT INTO collectible_products (
                brand,
                source_key,
                external_id,
                title,
                product_url,
                image_url,
                price_cents,
                currency
            ) VALUES (
                :brand,
                :source_key,
                :external_id,
                :title,
                :product_url,
                :image_url,
                :price_cents,
                :currency
            )
            ON CONFLICT (source_key, external_id) DO UPDATE SET
                title = EXCLUDED.title,
                product_url = EXCLUDED.product_url,
                image_url = EXCLUDED.image_url,
                price_cents = EXCLUDED.price_cents,
                currency = EXCLUDED.currency,
                last_seen_at = now()
            RETURNING id
        SQL);
        $deleteVariantsStatement = $this->pdo->prepare(<<<'SQL'
            DELETE FROM collectible_variants
            WHERE product_id = :product_id
        SQL);
        $variantStatement = $this->pdo->prepare(<<<'SQL'
            INSERT INTO collectible_variants (
                product_id,
                name,
                is_secret,
                image_url,
                price_cents,
                currency,
                position
            ) VALUES (
                :product_id,
                :name,
                :is_secret,
                :image_url,
                :price_cents,
                :currency,
                :position
            )
        SQL);

        $variantCount = 0;
        $this->pdo->beginTransaction();
        try {
            foreach ($products as $product) {
                $productStatement->execute([
                    'brand' => $brand,
                    'source_key' => $sourceKey,
                    'external_id' => $product['external_id'],
                    'title' => $product['title'],
                    'product_url' => $product['product_url'],
                    'image_url' => $product['image_url'],
                    'price_cents' => $product['price_cents'],
                    'currency' => $product['currency'],
                ]);
                $productId = $productStatement->fetchColumn();
                if ($productId === false) {
                    throw new \RuntimeException('The collectible product row could not be saved.');
                }

                if ($product['variants'] === []) {
                    continue;
                }

                $deleteVariantsStatement->execute(['product_id' => (string) $productId]);
                foreach ($product['variants'] as $position => $variant) {
                    $variantStatement->bindValue(':product_id', (string) $productId, PDO::PARAM_STR);
                    $variantStatement->bindValue(':name', $variant['name'], PDO::PARAM_STR);
                    $variantStatement->bindValue(':is_secret', $variant['is_secret'], PDO::PARAM_BOOL);
                    $variantStatement->bindValue(':image_url', $variant['image_url'], $variant['image_url'] === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
                    $variantStatement->bindValue(':price_cents', $variant['price_cents'], $variant['price_cents'] === null ? PDO::PARAM_NULL : PDO::PARAM_INT);
                    $variantStatement->bindValue(':currency', $variant['currency'], $variant['currency'] === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
                    $variantStatement->bindValue(':position', $position, PDO::PARAM_INT);
                    $variantStatement->execute();
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
     * @return array{
     *     items: list<array<string, mixed>>,
     *     total: int,
     *     last_synced_at: ?string
     * }
     */
    public function search(?string $query, ?string $brand, int $limit, int $offset): array
    {
        $conditions = [];
        $parameters = [];
        if ($query !== null && $query !== '') {
            $pattern = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $query) . '%';
            $conditions[] = <<<'SQL'
                (
                    p.title ILIKE :query_title ESCAPE '\'
                    OR EXISTS (
                        SELECT 1
                        FROM collectible_variants search_variant
                        WHERE search_variant.product_id = p.id
                          AND search_variant.name ILIKE :query_variant ESCAPE '\'
                    )
                )
            SQL;
            $parameters['query_title'] = $pattern;
            $parameters['query_variant'] = $pattern;
        }
        if ($brand !== null && $brand !== '') {
            $conditions[] = 'p.brand = :brand';
            $parameters['brand'] = $brand;
        }
        $where = $conditions === [] ? '' : 'WHERE ' . implode(' AND ', $conditions);

        $summaryStatement = $this->pdo->prepare(sprintf(<<<'SQL'
            SELECT
                count(*) AS total,
                (SELECT max(last_seen_at) FROM collectible_products) AS last_synced_at
            FROM collectible_products p
            %s
        SQL, $where));
        $this->bindSearchParameters($summaryStatement, $parameters);
        $summaryStatement->execute();
        $summary = $summaryStatement->fetch(PDO::FETCH_ASSOC) ?: [];

        $itemsStatement = $this->pdo->prepare(sprintf(<<<'SQL'
            SELECT
                p.id,
                p.brand,
                p.title,
                p.product_url,
                p.image_url,
                p.price_cents,
                p.currency,
                p.source_key,
                p.last_seen_at
            FROM collectible_products p
            %s
            ORDER BY p.brand, p.title, p.id
            LIMIT :limit
            OFFSET :offset
        SQL, $where));
        $this->bindSearchParameters($itemsStatement, $parameters);
        $itemsStatement->bindValue(':limit', $limit, PDO::PARAM_INT);
        $itemsStatement->bindValue(':offset', $offset, PDO::PARAM_INT);
        $itemsStatement->execute();

        $items = [];
        $itemIndexes = [];
        foreach ($itemsStatement->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
            $id = (string) $row['id'];
            $itemIndexes[$id] = count($items);
            $items[] = [
                'id' => $id,
                'brand' => (string) $row['brand'],
                'title' => (string) $row['title'],
                'product_url' => (string) $row['product_url'],
                'image_url' => $row['image_url'] === null ? null : (string) $row['image_url'],
                'price_cents' => $row['price_cents'] === null ? null : (int) $row['price_cents'],
                'currency' => $row['currency'] === null ? null : (string) $row['currency'],
                'source_key' => (string) $row['source_key'],
                'last_seen_at' => $this->formatTimestamp((string) $row['last_seen_at']),
                'variants' => [],
            ];
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
                    currency
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
                $items[$itemIndex]['variants'][] = [
                    'name' => (string) $row['name'],
                    'is_secret' => $this->databaseBoolean($row['is_secret']),
                    'image_url' => $row['image_url'] === null ? null : (string) $row['image_url'],
                    'price_cents' => $row['price_cents'] === null ? null : (int) $row['price_cents'],
                    'currency' => $row['currency'] === null ? null : (string) $row['currency'],
                ];
            }
        }

        return [
            'items' => $items,
            'total' => (int) ($summary['total'] ?? 0),
            'last_synced_at' => isset($summary['last_synced_at'])
                ? $this->formatTimestamp((string) $summary['last_synced_at'])
                : null,
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

    /** @param array<string, string> $parameters */
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

    private function databaseBoolean(mixed $value): bool
    {
        return $value === true || $value === 1 || $value === '1' || $value === 't' || $value === 'true';
    }
}
