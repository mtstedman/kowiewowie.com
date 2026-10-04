<?php

declare(strict_types=1);

namespace Wowie\Api\Collectibles;

/**
 * Local figure pictures for the store-fed lines, matched by set and figure
 * name. The manifest (htdocs/assets/data/collectible-figure-images.json) and
 * its images are written by tools/collectible-figure-images.mjs and ship with
 * the application, so pictures need no request at read time.
 */
final class CollectibleFigureImages
{
    public const PATH_PATTERN = '#^/assets/images/collectibles/[a-z0-9-]+/[a-z0-9-]+/[a-z0-9-]+\.webp$#D';

    /** @var array<string, array<string, mixed>> */
    private static array $cache = [];

    /** @param array<string, mixed> $images series id => normalized figure name => entry */
    public function __construct(private readonly array $images)
    {
    }

    public static function load(string $projectRoot): self
    {
        $path = $projectRoot . '/htdocs/assets/data/collectible-figure-images.json';
        if (!array_key_exists($path, self::$cache)) {
            $raw = is_file($path) ? file_get_contents($path) : false;
            $data = is_string($raw) ? json_decode($raw, true) : null;
            self::$cache[$path] = is_array($data) && is_array($data['images'] ?? null) ? $data['images'] : [];
        }
        return new self(self::$cache[$path]);
    }

    /** The manifest's figure key; mirrors figureKey() in the download tool. */
    public static function key(string $name): string
    {
        $text = class_exists(\Normalizer::class) ? (string) \Normalizer::normalize($name, \Normalizer::FORM_KC) : $name;
        $text = str_replace(["\u{2018}", "\u{2019}", '`', "\u{00B4}", "\u{FF08}", "\u{FF09}"], ["'", "'", "'", "'", '(', ')'], $text);
        $text = (string) preg_replace('/\(\s*(?:super\s+)?secret\s*\)/iu', '', $text);
        $text = (string) preg_replace(['/\s*\(\s*/u', '/\s*\)/u'], [' (', ')'], $text);
        return strtolower(trim((string) preg_replace('/\s+/u', ' ', $text)));
    }

    public function forFigure(?string $seriesId, ?string $name): ?string
    {
        if ($seriesId === null || $name === null || $name === '') return null;
        $path = $this->images[$seriesId][self::key($name)]['path'] ?? null;
        return is_string($path) && preg_match(self::PATH_PATTERN, $path) === 1 ? $path : null;
    }
}
