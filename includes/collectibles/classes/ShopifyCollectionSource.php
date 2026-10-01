<?php

declare(strict_types=1);

namespace Wowie\Api\Collectibles;

use InvalidArgumentException;
use RuntimeException;

/**
 * Generic catalog source backed by a Shopify collection's public products.json feed.
 */
final class ShopifyCollectionSource
{
    private const MAX_PAGES = 20;
    private const PAGE_SIZE = 250;

    private CollectibleHttpClient $http;
    private string $sourceKey;
    private string $brand;
    private string $collectionUrl;
    private string $origin;
    private string $currency;
    private string $keyword;

    public function __construct(
        CollectibleHttpClient $http,
        string $sourceKey,
        string $brand,
        string $collectionUrl,
        string $currency,
        string $keyword
    ) {
        $parts = parse_url($collectionUrl);
        if (
            !is_array($parts)
            || strtolower((string) ($parts['scheme'] ?? '')) !== 'https'
            || !is_string($parts['host'] ?? null)
            || $parts['host'] === ''
            || isset($parts['user'])
            || isset($parts['pass'])
            || isset($parts['port'])
            || isset($parts['query'])
            || isset($parts['fragment'])
        ) {
            throw new InvalidArgumentException('A Shopify collection source needs a plain HTTPS collection URL.');
        }
        if (trim($sourceKey) === '' || trim($keyword) === '') {
            throw new InvalidArgumentException('A Shopify collection source needs a source key and a keyword.');
        }

        $this->http = $http;
        $this->sourceKey = trim($sourceKey);
        $this->brand = $brand;
        $this->origin = 'https://' . strtolower($parts['host']);
        $this->collectionUrl = $this->origin . rtrim((string) ($parts['path'] ?? ''), '/');
        $this->currency = strtoupper(trim($currency));
        $this->keyword = trim($keyword);
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
     * Read every page of the collection feed until an empty or short page.
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
        $products = [];
        for ($page = 1; $page <= self::MAX_PAGES; $page++) {
            $body = $this->http->get(
                $this->collectionUrl . '/products.json?limit=' . self::PAGE_SIZE . '&page=' . $page,
                CollectibleHttpClient::ACCEPT_JSON,
            );

            $pageProducts = self::parseProductsPage($body);
            if ($pageProducts === []) {
                break;
            }

            foreach ($pageProducts as $rawProduct) {
                $product = self::mapProduct($rawProduct, $this->origin, $this->currency, $this->keyword);
                if ($product !== null && !isset($products[$product['external_id']])) {
                    $products[$product['external_id']] = $product;
                }
            }

            // Shopify honors limit=250 for this feed. A short page is the
            // final page, so do not make an unnecessary request that can trip
            // a strict storefront rate limit and discard the valid first page.
            if (count($pageProducts) < self::PAGE_SIZE) {
                break;
            }
        }

        return array_values($products);
    }

    /**
     * Decode one products.json page into its raw product records.
     *
     * @return list<array<mixed>>
     * @throws RuntimeException when the body is not Shopify product JSON
     */
    public static function parseProductsPage(string $json): array
    {
        $decoded = json_decode($json, true, 64);
        if (!is_array($decoded) || !is_array($decoded['products'] ?? null)) {
            throw new RuntimeException('The storefront did not return Shopify product JSON.');
        }

        return array_values(array_filter($decoded['products'], 'is_array'));
    }

    /**
     * Map one raw Shopify product to a catalog product, or null when it is
     * unusable or does not match the keyword.
     *
     * @param array<mixed> $product
     * @return array{
     *     external_id: string,
     *     title: string,
     *     product_url: string,
     *     image_url: ?string,
     *     price_cents: ?int,
     *     currency: ?string,
     *     variants: list<array{name: string, is_secret: bool, image_url: ?string, price_cents: ?int, currency: ?string}>
     * }|null
     */
    public static function mapProduct(array $product, string $origin, string $currency, string $keyword): ?array
    {
        $externalId = self::scalarString($product['id'] ?? null);
        $title = self::scalarString($product['title'] ?? null);
        $handle = self::scalarString($product['handle'] ?? null);
        if ($externalId === '' || $title === '' || $handle === '') {
            return null;
        }
        if (!self::matchesKeyword($product, $keyword)) {
            return null;
        }

        $rawVariants = is_array($product['variants'] ?? null)
            ? array_values(array_filter($product['variants'], 'is_array'))
            : [];
        $onlyDefaultVariant = count($rawVariants) === 1
            && strcasecmp(self::scalarString($rawVariants[0]['title'] ?? null), 'Default Title') === 0;

        $lowestPrice = null;
        $variants = [];
        foreach ($rawVariants as $rawVariant) {
            $priceCents = CollectiblesSync::priceToCents($rawVariant['price'] ?? null);
            if ($priceCents !== null && ($lowestPrice === null || $priceCents < $lowestPrice)) {
                $lowestPrice = $priceCents;
            }

            $name = self::scalarString($rawVariant['title'] ?? null);
            if ($onlyDefaultVariant || $name === '') {
                continue;
            }

            $variants[] = [
                'name' => $name,
                'is_secret' => false,
                'image_url' => self::imageSource($rawVariant['featured_image'] ?? null),
                'price_cents' => $priceCents,
                'currency' => $priceCents === null ? null : $currency,
            ];
        }

        $images = is_array($product['images'] ?? null) ? array_values($product['images']) : [];

        return [
            'external_id' => $externalId,
            'title' => $title,
            'product_url' => rtrim($origin, '/') . '/products/' . rawurlencode($handle),
            'image_url' => self::imageSource($images[0] ?? null),
            'price_cents' => $lowestPrice,
            'currency' => $lowestPrice === null ? null : $currency,
            'variants' => $variants,
        ];
    }

    /**
     * @param array<mixed> $product
     */
    private static function matchesKeyword(array $product, string $keyword): bool
    {
        $haystacks = [];
        foreach (['title', 'vendor'] as $field) {
            if (is_string($product[$field] ?? null)) {
                $haystacks[] = $product[$field];
            }
        }

        $tags = $product['tags'] ?? null;
        if (is_string($tags)) {
            $haystacks[] = $tags;
        } elseif (is_array($tags)) {
            foreach ($tags as $tag) {
                if (is_string($tag)) {
                    $haystacks[] = $tag;
                }
            }
        }

        foreach ($haystacks as $haystack) {
            if (stripos($haystack, $keyword) !== false) {
                return true;
            }
        }

        return false;
    }

    private static function imageSource(mixed $image): ?string
    {
        if (!is_array($image) || !is_string($image['src'] ?? null)) {
            return null;
        }

        $source = trim($image['src']);
        if (str_starts_with($source, '//')) {
            $source = 'https:' . $source;
        }

        return $source === '' ? null : $source;
    }

    private static function scalarString(mixed $value): string
    {
        if (is_int($value)) {
            return (string) $value;
        }

        return is_string($value) ? trim($value) : '';
    }
}
