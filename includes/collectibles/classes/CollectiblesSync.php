<?php

declare(strict_types=1);

namespace Wowie\Api\Collectibles;

use InvalidArgumentException;
use PDOException;
use Throwable;

/**
 * Pulls the Skullpanda, Nommi, and Sonny Angel catalogs from their sources and
 * stores them through CollectiblesRepository::upsertSourceCatalog.
 *
 * Sources run independently: one that fails or returns no products is reported
 * as failed, writes nothing, and never stops the remaining sources.
 */
final class CollectiblesSync
{
    public const NOMMI_SOURCE_KEY = 'toysez-nommi';
    public const NOMMI_COLLECTION_URL = 'https://toysez.com/collections/nommi';
    public const NOMMI_HOST = 'toysez.com';
    public const NOMMI_CURRENCY = 'USD';
    public const NOMMI_KEYWORD = 'nommi';

    private const MAX_TEXT_LENGTH = 300;
    private const MAX_EXTERNAL_ID_LENGTH = 200;
    private const MAX_URL_BYTES = 2000;

    private CollectiblesRepository $repository;

    /** @var list<PopMartCollectionSource|ShopifyCollectionSource|SonnyAngelCatalogSource|CollectibleCatalogSupplement> */
    private array $sources;

    /**
     * @param list<PopMartCollectionSource|ShopifyCollectionSource|SonnyAngelCatalogSource>|null $sources Defaults to defaultSources().
     */
    public function __construct(CollectiblesRepository $repository, ?array $sources = null)
    {
        $sources ??= self::defaultSources();
        foreach ($sources as $source) {
            if (!$source instanceof PopMartCollectionSource && !$source instanceof ShopifyCollectionSource && !$source instanceof SonnyAngelCatalogSource && !$source instanceof CollectibleCatalogSupplement) {
                throw new InvalidArgumentException('Unsupported collectible source.');
            }
        }

        $this->repository = $repository;
        $this->sources = array_values($sources);
    }

    /**
     * Two storefront sources and the versioned local Sonny Angel catalog.
     *
     * @return list<PopMartCollectionSource|ShopifyCollectionSource|SonnyAngelCatalogSource>
     */
    public static function defaultSources(?CollectibleHttpClient $http = null): array
    {
        $http ??= new CollectibleHttpClient([PopMartCollectionSource::HOST, self::NOMMI_HOST]);

        return [
            new PopMartCollectionSource($http),
            new ShopifyCollectionSource(
                $http,
                self::NOMMI_SOURCE_KEY,
                'nommi',
                self::NOMMI_COLLECTION_URL,
                self::NOMMI_CURRENCY,
                self::NOMMI_KEYWORD,
            ),
            new SonnyAngelCatalogSource(dirname(__DIR__, 3) . '/htdocs/assets/data/sonny-angels.json'),
            ...self::supplementSources(),
        ];
    }

    /** @return list<SonnyAngelCatalogSource|CollectibleCatalogSupplement> */
    public static function catalogSources(): array
    {
        return [
            new SonnyAngelCatalogSource(dirname(__DIR__, 3) . '/htdocs/assets/data/sonny-angels.json'),
            ...self::supplementSources(),
        ];
    }

    /** @return list<CollectibleCatalogSupplement> */
    private static function supplementSources(): array
    {
        $root = dirname(__DIR__, 3) . '/htdocs/assets/data/';
        return [new CollectibleCatalogSupplement($root . 'skullpanda-catalog.json'), new CollectibleCatalogSupplement($root . 'nommi-catalog.json')];
    }

    /**
     * @return list<string>
     */
    public function sourceKeys(): array
    {
        $keys = [];
        foreach ($this->sources as $source) {
            $keys[] = $source->sourceKey();
        }

        return $keys;
    }

    /**
     * Run every source, or only the one whose source_key matches $only.
     *
     * @return list<array{source_key: string, brand: string, status: string, products: int, variants: int, error: ?string}>
     */
    public function run(?string $only = null): array
    {
        $results = [];
        foreach ($this->sources as $source) {
            if ($only !== null && $source->sourceKey() !== $only) {
                continue;
            }

            $result = [
                'source_key' => $source->sourceKey(),
                'brand' => $source->brand(),
                'status' => 'failed',
                'products' => 0,
                'variants' => 0,
                'error' => null,
                // Set when a store asked us to slow down, so a scheduler can back off.
                'rate_limited' => false,
                'retry_after' => null,
            ];

            try {
                $products = self::normalizeProducts($source->fetchProducts());
                if ($products === []) {
                    // Nothing is written, so stored rows stay exactly as they were.
                    $result['error'] = 'The source returned no usable products.';
                } else {
                    $saved = $this->repository->upsertSourceCatalog($result['source_key'], $result['brand'], $products);
                    $result['status'] = 'ok';
                    $result['products'] = (int) $saved['products'];
                    $result['variants'] = (int) $saved['variants'];
                    // A catalog owns its rows: one it no longer lists (a
                    // merged or retired series) leaves the shelf. Supplements
                    // own only their catalog:-prefixed rows, never store
                    // listings; the Sonny Angel catalog owns all of its rows.
                    if ($source instanceof CollectibleCatalogSupplement || $source instanceof SonnyAngelCatalogSource) {
                        $result['retired'] = $this->repository->retireCatalogProducts(
                            $result['source_key'],
                            array_column($products, 'external_id'),
                            $source instanceof CollectibleCatalogSupplement ? 'catalog:' : '',
                        );
                    }
                }
            } catch (PDOException $error) {
                error_log("Collectibles sync for {$result['source_key']} failed to save: " . $error);
                $result['error'] = 'The catalog could not be saved to the database.';
            } catch (Throwable $error) {
                if ($error instanceof CollectibleRateLimitedException) {
                    $result['rate_limited'] = true;
                    $result['retry_after'] = $error->retryAfterSeconds;
                }
                error_log("Collectibles sync for {$result['source_key']} failed: " . $error);
                $result['error'] = self::cleanText($error->getMessage(), self::MAX_TEXT_LENGTH);
                if ($result['error'] === '') {
                    $result['error'] = 'The source could not be read.';
                }
            }

            $results[] = $result;
        }

        return $results;
    }

    /**
     * Normalize raw source products into the upsertSourceCatalog shape.
     *
     * Text is entity-decoded, tag-stripped, whitespace-collapsed and capped at
     * 300 characters; product URLs must be absolute https while images may be
     * absolute https or a safe local Sonny asset; currencies are
     * upper-case ISO codes; variants are de-duplicated by name per product.
     *
     * @param array<mixed> $products
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
    public static function normalizeProducts(array $products): array
    {
        $normalized = [];
        foreach ($products as $product) {
            if (!is_array($product)) {
                continue;
            }

            $externalId = self::cleanText($product['external_id'] ?? null, self::MAX_EXTERNAL_ID_LENGTH);
            $title = self::cleanText($product['title'] ?? null, self::MAX_TEXT_LENGTH);
            $productUrl = self::httpsUrlOrNull($product['product_url'] ?? null);
            if ($externalId === '' || $title === '' || $productUrl === null || isset($normalized[$externalId])) {
                continue;
            }

            $variants = [];
            $seenNames = [];
            foreach (is_array($product['variants'] ?? null) ? $product['variants'] : [] as $variant) {
                if (!is_array($variant)) {
                    continue;
                }

                $name = self::cleanText($variant['name'] ?? null, self::MAX_TEXT_LENGTH);
                $nameKey = function_exists('mb_strtolower') ? mb_strtolower($name, 'UTF-8') : strtolower($name);
                if ($name === '' || isset($seenNames[$nameKey])) {
                    continue;
                }

                $seenNames[$nameKey] = true;
                $variants[] = [
                    'name' => $name,
                    'is_secret' => ($variant['is_secret'] ?? false) === true,
                    'image_url' => self::imageUrlOrNull($variant['image_url'] ?? null),
                    'price_cents' => self::centsOrNull($variant['price_cents'] ?? null),
                    'currency' => self::currencyOrNull($variant['currency'] ?? null),
                    'price_kind' => self::priceKindOrNull($variant['price_kind'] ?? null),
                    'price_source_url' => self::httpsUrlOrNull($variant['price_source_url'] ?? null),
                    'price_observed_on' => self::dateOrNull($variant['price_observed_on'] ?? null),
                    'sku' => self::skuOrNull($variant['sku'] ?? null),
                    'barcode' => self::barcodeOrNull($variant['barcode'] ?? null),
                ];
            }

            $normalized[$externalId] = [
                'external_id' => $externalId,
                'title' => $title,
                'product_url' => $productUrl,
                'image_url' => self::imageUrlOrNull($product['image_url'] ?? null),
                'price_cents' => self::centsOrNull($product['price_cents'] ?? null),
                'currency' => self::currencyOrNull($product['currency'] ?? null),
                'price_kind' => self::priceKindOrNull($product['price_kind'] ?? null),
                'price_source_url' => self::httpsUrlOrNull($product['price_source_url'] ?? null),
                'price_observed_on' => self::dateOrNull($product['price_observed_on'] ?? null),
                'release_year' => self::releaseYearOrNull($product['release_year'] ?? null),
                'sku' => self::skuOrNull($product['sku'] ?? null),
                'barcode' => self::barcodeOrNull($product['barcode'] ?? null),
                'preserve_existing' => ($product['preserve_existing'] ?? false) === true,
                'variants' => $variants,
            ];
        }

        return array_values($normalized);
    }

    /** A store SKU: printable text, 1-64 characters after cleaning. */
    public static function skuOrNull(mixed $value): ?string
    {
        if (!is_string($value) && !is_int($value)) return null;
        $sku = self::cleanText((string) $value, 64);
        return $sku === '' || preg_match('/^[\p{L}\p{N}][\p{L}\p{N} ._\/#+-]*$/u', $sku) !== 1 ? null : $sku;
    }

    /** A product barcode: UPC/EAN/JAN digits (8-14), spaces and dashes dropped. */
    public static function barcodeOrNull(mixed $value): ?string
    {
        if (!is_string($value) && !is_int($value)) return null;
        $digits = (string) preg_replace('/[\s-]+/', '', (string) $value);
        return preg_match('/^[0-9]{8,14}$/', $digits) === 1 ? $digits : null;
    }

    /**
     * Convert a listing price such as "19.99", "$1,299.90" or 37.42 to integer
     * minor units. Anything that is not clearly a price yields null, never 0.
     * Two-decimal currencies are assumed, which holds for the configured sources.
     */
    public static function priceToCents(mixed $value): ?int
    {
        if (is_int($value)) {
            $value = (string) $value;
        } elseif (is_float($value)) {
            if (!is_finite($value) || $value < 0) {
                return null;
            }
            $value = number_format($value, 2, '.', '');
        }
        if (!is_string($value)) {
            return null;
        }

        $pattern = '/^(?:[A-Z]{0,3}\s?[$€£¥]?\s?)(\d{1,3}(?:,\d{3})+|\d{1,9})(?:\.(\d{1,2}))?(?:\s?[A-Z]{3})?$/iu';
        if (preg_match($pattern, trim($value), $match) !== 1) {
            return null;
        }

        $whole = str_replace(',', '', $match[1]);
        if (strlen($whole) > 9) {
            return null;
        }

        return ((int) $whole) * 100 + (int) str_pad($match[2] ?? '', 2, '0');
    }

    /**
     * Decode entities, strip tags, collapse whitespace and cap the length.
     */
    public static function cleanText(mixed $value, int $maxLength = self::MAX_TEXT_LENGTH): string
    {
        if (is_int($value)) {
            $value = (string) $value;
        }
        if (!is_string($value) || $maxLength < 1) {
            return '';
        }

        $text = self::validUtf8($value);
        // Strip again after decoding so encoded markup cannot survive as tags.
        $text = strip_tags(html_entity_decode(strip_tags($text), ENT_QUOTES | ENT_HTML5, 'UTF-8'));
        $text = trim(preg_replace('/[\s\x{00A0}\x00-\x1F\x7F]+/u', ' ', $text) ?? '');

        if (preg_match('/^.{0,' . $maxLength . '}/us', $text, $match) !== 1) {
            return '';
        }

        return rtrim($match[0]);
    }

    /**
     * Return the URL when it is an absolute https URL the repository accepts.
     */
    public static function httpsUrlOrNull(mixed $value): ?string
    {
        if (!is_string($value)) {
            return null;
        }

        $url = trim($value);
        if (str_starts_with($url, '//')) {
            $url = 'https:' . $url;
        }
        if ($url === '' || strlen($url) > self::MAX_URL_BYTES || filter_var($url, FILTER_VALIDATE_URL) === false) {
            return null;
        }

        return strtolower((string) parse_url($url, PHP_URL_SCHEME)) === 'https' ? $url : null;
    }

    public static function imageUrlOrNull(mixed $value): ?string
    {
        if (is_string($value)
            && preg_match('#^/assets/images/sonny-angels/[A-Za-z0-9_./()@%+,&-]+$#D', $value) === 1
            && !str_contains($value, '/../') && !str_contains($value, '/./')) {
            return $value;
        }

        return self::httpsUrlOrNull($value);
    }

    private static function centsOrNull(mixed $value): ?int
    {
        return is_int($value) && $value >= 0 ? $value : null;
    }

    private static function currencyOrNull(mixed $value): ?string
    {
        if (!is_string($value)) {
            return null;
        }

        $currency = strtoupper(trim($value));

        return preg_match('/^[A-Z]{3}$/', $currency) === 1 ? $currency : null;
    }

    private static function priceKindOrNull(mixed $value): ?string
    {
        return is_string($value) && in_array($value, ['retail', 'asking', 'sold'], true) ? $value : null;
    }

    private static function dateOrNull(mixed $value): ?string
    {
        if (!is_string($value) || preg_match('/^\d{4}-\d{2}-\d{2}$/D', $value) !== 1) {
            return null;
        }
        [$year, $month, $day] = array_map('intval', explode('-', $value));

        return checkdate($month, $day, $year) ? $value : null;
    }

    private static function releaseYearOrNull(mixed $value): ?int
    {
        return is_int($value) && $value >= 2000 && $value <= 2100 ? $value : null;
    }

    private static function validUtf8(string $value): string
    {
        if (preg_match('//u', $value) === 1) {
            return $value;
        }
        if (function_exists('mb_convert_encoding')) {
            return (string) mb_convert_encoding($value, 'UTF-8', 'UTF-8');
        }

        return preg_replace('/[^\x20-\x7E]/', '', $value) ?? '';
    }
}
