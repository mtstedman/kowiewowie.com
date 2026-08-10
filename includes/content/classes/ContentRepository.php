<?php

declare(strict_types=1);

namespace Wowie\Api\Content;

use PDO;
use Throwable;
use Wowie\Api\ApiException;

final class ContentRepository
{
    private const RESOURCES = ['recipes', 'decks', 'guides', 'games', 'music'];

    public function __construct(private readonly PDO $pdo)
    {
    }

    /** @return list<array<string, mixed>> */
    public function list(string $resource, int $limit = 100, int $offset = 0, bool $includeUnpublished = false): array
    {
        $this->assertResource($resource);
        $limit = max(1, min(100, $limit));
        $offset = max(0, $offset);

        return match ($resource) {
            'recipes' => $this->listRecipes(null, $limit, $offset, $includeUnpublished),
            'decks' => $this->listDecks(null, $limit, $offset, $includeUnpublished),
            'guides' => $this->listGuides(null, $limit, $offset, $includeUnpublished),
            'games' => $this->listGames(null, $limit, $offset, $includeUnpublished),
            'music' => $this->listMusic(null, $limit, $offset, $includeUnpublished),
        };
    }

    /** @return array<string, mixed> */
    public function find(string $resource, string $slug, bool $includeUnpublished = false): array
    {
        $this->assertResource($resource);
        $items = match ($resource) {
            'recipes' => $this->listRecipes($slug, 1, 0, $includeUnpublished),
            'decks' => $this->listDecks($slug, 1, 0, $includeUnpublished),
            'guides' => $this->listGuides($slug, 1, 0, $includeUnpublished),
            'games' => $this->listGames($slug, 1, 0, $includeUnpublished),
            'music' => $this->listMusic($slug, 1, 0, $includeUnpublished),
        };
        if ($items === []) {
            throw new ApiException(404, 'not_found', 'The requested API resource does not exist.');
        }

        return $items[0];
    }

    /** @param array<string, mixed> $input @return array{created: bool, item: array<string, mixed>} */
    public function save(string $resource, array $input, ?string $actorId = null): array
    {
        $this->assertResource($resource);
        $slug = requiredSlug($input);
        $created = !$this->exists($resource, $slug);

        $this->pdo->beginTransaction();
        try {
            match ($resource) {
                'recipes' => $this->saveRecipe($input, $actorId),
                'decks' => $this->saveDeck($input, $actorId),
                'guides' => $this->saveGuide($input, $actorId),
                'games' => $this->saveGame($input, $actorId),
                'music' => $this->saveMusic($input, $actorId),
            };
            $this->pdo->commit();
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $error;
        }

        return ['created' => $created, 'item' => $this->find($resource, $slug, true)];
    }

    public function delete(string $resource, string $slug): void
    {
        $tables = [
            'recipes' => 'recipes',
            'decks' => 'magic_decks',
            'guides' => 'magic_guides',
            'games' => 'games',
            'music' => 'music_entries',
        ];
        $this->assertResource($resource);
        $statement = $this->pdo->prepare("DELETE FROM {$tables[$resource]} WHERE slug = :slug");
        $statement->execute(['slug' => $slug]);
        if ($statement->rowCount() === 0) {
            throw new ApiException(404, 'not_found', 'The requested API resource does not exist.');
        }
    }

    private function exists(string $resource, string $slug): bool
    {
        $tables = [
            'recipes' => 'recipes',
            'decks' => 'magic_decks',
            'guides' => 'magic_guides',
            'games' => 'games',
            'music' => 'music_entries',
        ];
        $statement = $this->pdo->prepare("SELECT 1 FROM {$tables[$resource]} WHERE slug = :slug");
        $statement->execute(['slug' => $slug]);

        return $statement->fetchColumn() !== false;
    }

    /** @return list<array<string, mixed>> */
    private function listRecipes(?string $slug, int $limit, int $offset, bool $includeUnpublished): array
    {
        $rows = $this->contentRows(
            'SELECT slug, title, summary, image_url, ingredients, instructions, status, published_at, updated_at FROM recipes',
            $slug,
            $limit,
            $offset,
            $includeUnpublished,
        );

        return array_map(fn (array $row): array => [
            'slug' => $row['slug'],
            'title' => $row['title'],
            'summary' => $row['summary'],
            'image' => $row['image_url'],
            'ingredients' => $this->decodeJsonList($row['ingredients']),
            'instructions' => $this->decodeJsonList($row['instructions']),
            'status' => $row['status'],
            'published_at' => $row['published_at'],
            'updated_at' => $row['updated_at'],
        ], $rows);
    }

    /** @return list<array<string, mixed>> */
    private function listDecks(?string $slug, int $limit, int $offset, bool $includeUnpublished): array
    {
        $rows = $this->contentRows(
            'SELECT id, slug, name, format, colors, commander, card_count, summary, strategy, status, published_at, updated_at FROM magic_decks',
            $slug,
            $limit,
            $offset,
            $includeUnpublished,
        );
        foreach ($rows as &$row) {
            $cards = $this->pdo->prepare(<<<'SQL'
                SELECT section, quantity, card_name
                FROM magic_deck_cards
                WHERE deck_id = :deck_id
                ORDER BY section_position, card_position
            SQL);
            $cards->execute(['deck_id' => $row['id']]);
            $decklist = [];
            foreach ($cards->fetchAll() as $card) {
                $decklist[(string) $card['section']][] = [
                    'quantity' => (int) $card['quantity'],
                    'name' => (string) $card['card_name'],
                ];
            }
            $row = [
                'slug' => $row['slug'],
                'name' => $row['name'],
                'format' => $row['format'],
                'colors' => $this->decodeJsonList($row['colors']),
                'commander' => $row['commander'],
                'card_count' => (int) $row['card_count'],
                'summary' => $row['summary'],
                'strategy' => $row['strategy'],
                'decklist' => $decklist,
                'status' => $row['status'],
                'published_at' => $row['published_at'],
                'updated_at' => $row['updated_at'],
            ];
        }
        unset($row);

        return $rows;
    }

    /** @return list<array<string, mixed>> */
    private function listGuides(?string $slug, int $limit, int $offset, bool $includeUnpublished): array
    {
        $rows = $this->contentRows(
            'SELECT mg.id, mg.slug, mg.title, md.slug AS deck_slug, mg.summary, mg.status, mg.published_at, mg.updated_at FROM magic_guides mg LEFT JOIN magic_decks md ON md.id = mg.deck_id',
            $slug,
            $limit,
            $offset,
            $includeUnpublished,
            'mg',
        );
        foreach ($rows as &$row) {
            $sections = $this->pdo->prepare(<<<'SQL'
                SELECT heading, body
                FROM magic_guide_sections
                WHERE guide_id = :guide_id
                ORDER BY position
            SQL);
            $sections->execute(['guide_id' => $row['id']]);
            $row = [
                'slug' => $row['slug'],
                'title' => $row['title'],
                'deck_slug' => $row['deck_slug'],
                'summary' => $row['summary'],
                'published' => $row['published_at'] !== null ? substr((string) $row['published_at'], 0, 10) : null,
                'sections' => array_map(static fn (array $section): array => [
                    'heading' => $section['heading'],
                    'body' => $section['body'],
                ], $sections->fetchAll()),
                'status' => $row['status'],
                'published_at' => $row['published_at'],
                'updated_at' => $row['updated_at'],
            ];
        }
        unset($row);

        return $rows;
    }

    /** @return list<array<string, mixed>> */
    private function listGames(?string $slug, int $limit, int $offset, bool $includeUnpublished): array
    {
        $rows = $this->contentRows(
            'SELECT slug, name, short_description, strategy_notes, status, published_at, updated_at FROM games',
            $slug,
            $limit,
            $offset,
            $includeUnpublished,
        );

        return array_map(fn (array $row): array => [
            'slug' => $row['slug'],
            'name' => $row['name'],
            'shortDescription' => $row['short_description'],
            'strategyNotes' => $this->decodeJsonList($row['strategy_notes']),
            'status' => $row['status'],
            'published_at' => $row['published_at'],
            'updated_at' => $row['updated_at'],
        ], $rows);
    }

    /** @return list<array<string, mixed>> */
    private function listMusic(?string $slug, int $limit, int $offset, bool $includeUnpublished): array
    {
        $rows = $this->contentRows(
            'SELECT slug, title, artist, spotify_url, notes, status, published_at, updated_at FROM music_entries',
            $slug,
            $limit,
            $offset,
            $includeUnpublished,
        );

        return array_map(static fn (array $row): array => [
            'slug' => $row['slug'],
            'title' => $row['title'],
            'artist' => $row['artist'],
            'spotify_url' => $row['spotify_url'],
            'notes' => $row['notes'],
            'status' => $row['status'],
            'published_at' => $row['published_at'],
            'updated_at' => $row['updated_at'],
        ], $rows);
    }

    /** @return list<array<string, mixed>> */
    private function contentRows(
        string $select,
        ?string $slug,
        int $limit,
        int $offset,
        bool $includeUnpublished,
        string $alias = '',
    ): array {
        $prefix = $alias !== '' ? $alias . '.' : '';
        $conditions = [];
        $params = [];
        if (!$includeUnpublished) {
            $conditions[] = $prefix . "status = 'published'";
        }
        if ($slug !== null) {
            $conditions[] = $prefix . 'slug = :slug';
            $params['slug'] = $slug;
        }
        $where = $conditions !== [] ? ' WHERE ' . implode(' AND ', $conditions) : '';
        $statement = $this->pdo->prepare($select . $where . " ORDER BY {$prefix}created_at DESC, {$prefix}slug LIMIT :limit OFFSET :offset");
        foreach ($params as $name => $value) {
            $statement->bindValue($name, $value);
        }
        $statement->bindValue('limit', $limit, PDO::PARAM_INT);
        $statement->bindValue('offset', $offset, PDO::PARAM_INT);
        $statement->execute();

        return $statement->fetchAll();
    }

    /** @param array<string, mixed> $input */
    private function saveRecipe(array $input, ?string $actorId): void
    {
        $statement = $this->pdo->prepare(<<<'SQL'
            INSERT INTO recipes (slug, title, summary, image_url, ingredients, instructions, status, created_by, updated_by, published_at)
            VALUES (:slug, :title, :summary, :image_url, CAST(:ingredients AS jsonb), CAST(:instructions AS jsonb), :status, :actor, :actor,
                    CASE WHEN :status = 'published' THEN now() ELSE NULL END)
            ON CONFLICT (slug) DO UPDATE SET
                title = EXCLUDED.title, summary = EXCLUDED.summary, image_url = EXCLUDED.image_url,
                ingredients = EXCLUDED.ingredients, instructions = EXCLUDED.instructions,
                status = EXCLUDED.status, updated_by = EXCLUDED.updated_by,
                published_at = CASE WHEN EXCLUDED.status = 'published' THEN COALESCE(recipes.published_at, now()) ELSE recipes.published_at END
        SQL);
        $status = contentStatus($input);
        $statement->execute([
            'slug' => requiredSlug($input),
            'title' => requiredString($input, 'title'),
            'summary' => requiredString($input, 'summary', 2_000),
            'image_url' => optionalString($input, 'image', 2_000),
            'ingredients' => json_encode(stringList($input, 'ingredients'), JSON_THROW_ON_ERROR),
            'instructions' => json_encode(stringList($input, 'instructions'), JSON_THROW_ON_ERROR),
            'status' => $status,
            'actor' => $actorId,
        ]);
    }

    /** @param array<string, mixed> $input */
    private function saveDeck(array $input, ?string $actorId): void
    {
        $decklist = $input['decklist'] ?? null;
        if (!is_array($decklist) || array_is_list($decklist)) {
            throw new ApiException(422, 'validation_failed', 'decklist must be an object keyed by card section.');
        }
        $cards = [];
        $cardCount = 0;
        foreach ($decklist as $section => $entries) {
            if (!is_string($section) || trim($section) === '' || !is_array($entries) || !array_is_list($entries)) {
                throw new ApiException(422, 'validation_failed', 'Every decklist section must contain an array of cards.');
            }
            foreach ($entries as $position => $entry) {
                if (!is_array($entry)) {
                    throw new ApiException(422, 'validation_failed', 'Every decklist card must be an object.');
                }
                $quantity = filter_var($entry['quantity'] ?? null, FILTER_VALIDATE_INT);
                $name = trim(is_string($entry['name'] ?? null) ? $entry['name'] : '');
                if ($quantity === false || $quantity < 1 || $quantity > 999 || $name === '' || mb_strlen($name) > 255) {
                    throw new ApiException(422, 'validation_failed', 'Every card needs a valid quantity and name.');
                }
                $cards[] = [$section, (int) $position, (int) $quantity, $name];
                $cardCount += (int) $quantity;
            }
        }

        $status = contentStatus($input);
        $statement = $this->pdo->prepare(<<<'SQL'
            INSERT INTO magic_decks (slug, name, format, colors, commander, card_count, summary, strategy, status, created_by, updated_by, published_at)
            VALUES (:slug, :name, :format, CAST(:colors AS jsonb), :commander, :card_count, :summary, :strategy, :status, :actor, :actor,
                    CASE WHEN :status = 'published' THEN now() ELSE NULL END)
            ON CONFLICT (slug) DO UPDATE SET
                name = EXCLUDED.name, format = EXCLUDED.format, colors = EXCLUDED.colors,
                commander = EXCLUDED.commander, card_count = EXCLUDED.card_count,
                summary = EXCLUDED.summary, strategy = EXCLUDED.strategy, status = EXCLUDED.status,
                updated_by = EXCLUDED.updated_by,
                published_at = CASE WHEN EXCLUDED.status = 'published' THEN COALESCE(magic_decks.published_at, now()) ELSE magic_decks.published_at END
            RETURNING id
        SQL);
        $statement->execute([
            'slug' => requiredSlug($input),
            'name' => requiredString($input, 'name'),
            'format' => requiredString($input, 'format', 120),
            'colors' => json_encode(stringList($input, 'colors', 80), JSON_THROW_ON_ERROR),
            'commander' => optionalString($input, 'commander', 255),
            'card_count' => $cardCount,
            'summary' => requiredString($input, 'summary', 2_000),
            'strategy' => requiredString($input, 'strategy', 10_000),
            'status' => $status,
            'actor' => $actorId,
        ]);
        $deckId = (string) $statement->fetchColumn();
        $this->pdo->prepare('DELETE FROM magic_deck_cards WHERE deck_id = :deck_id')->execute(['deck_id' => $deckId]);
        $insertCard = $this->pdo->prepare(<<<'SQL'
            INSERT INTO magic_deck_cards (deck_id, section, section_position, card_position, quantity, card_name)
            VALUES (:deck_id, :section, :section_position, :card_position, :quantity, :card_name)
        SQL);
        $sectionPositions = [];
        foreach ($cards as [$section, $position, $quantity, $name]) {
            $sectionPositions[$section] ??= count($sectionPositions);
            $insertCard->execute([
                'deck_id' => $deckId,
                'section' => $section,
                'section_position' => $sectionPositions[$section],
                'card_position' => $position,
                'quantity' => $quantity,
                'card_name' => $name,
            ]);
        }
    }

    /** @param array<string, mixed> $input */
    private function saveGuide(array $input, ?string $actorId): void
    {
        $deckSlug = requiredString($input, 'deck_slug', 160);
        $deck = $this->pdo->prepare('SELECT id FROM magic_decks WHERE slug = :slug');
        $deck->execute(['slug' => $deckSlug]);
        $deckId = $deck->fetchColumn();
        if (!is_string($deckId)) {
            throw new ApiException(422, 'validation_failed', 'deck_slug must reference an existing Magic deck.');
        }
        $sections = objectList($input, 'sections');
        $status = contentStatus($input);
        $published = optionalString($input, 'published', 10);
        if ($published !== null && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $published)) {
            throw new ApiException(422, 'validation_failed', 'published must use YYYY-MM-DD.');
        }

        $statement = $this->pdo->prepare(<<<'SQL'
            INSERT INTO magic_guides (deck_id, slug, title, summary, status, created_by, updated_by, published_at)
            VALUES (:deck_id, :slug, :title, :summary, :status, :actor, :actor,
                    CASE WHEN :status = 'published' THEN COALESCE(CAST(:published AS timestamptz), now()) ELSE NULL END)
            ON CONFLICT (slug) DO UPDATE SET
                deck_id = EXCLUDED.deck_id, title = EXCLUDED.title, summary = EXCLUDED.summary,
                status = EXCLUDED.status, updated_by = EXCLUDED.updated_by,
                published_at = CASE WHEN EXCLUDED.status = 'published' THEN COALESCE(EXCLUDED.published_at, magic_guides.published_at, now()) ELSE magic_guides.published_at END
            RETURNING id
        SQL);
        $statement->execute([
            'deck_id' => $deckId,
            'slug' => requiredSlug($input),
            'title' => requiredString($input, 'title'),
            'summary' => requiredString($input, 'summary', 2_000),
            'status' => $status,
            'actor' => $actorId,
            'published' => $published,
        ]);
        $guideId = (string) $statement->fetchColumn();
        $this->pdo->prepare('DELETE FROM magic_guide_sections WHERE guide_id = :guide_id')->execute(['guide_id' => $guideId]);
        $insertSection = $this->pdo->prepare(<<<'SQL'
            INSERT INTO magic_guide_sections (guide_id, position, heading, body)
            VALUES (:guide_id, :position, :heading, :body)
        SQL);
        foreach ($sections as $position => $section) {
            $insertSection->execute([
                'guide_id' => $guideId,
                'position' => $position,
                'heading' => requiredString($section, 'heading'),
                'body' => requiredString($section, 'body', 20_000),
            ]);
        }
    }

    /** @param array<string, mixed> $input */
    private function saveGame(array $input, ?string $actorId): void
    {
        $status = contentStatus($input);
        $statement = $this->pdo->prepare(<<<'SQL'
            INSERT INTO games (slug, name, short_description, strategy_notes, status, created_by, updated_by, published_at)
            VALUES (:slug, :name, :description, CAST(:notes AS jsonb), :status, :actor, :actor,
                    CASE WHEN :status = 'published' THEN now() ELSE NULL END)
            ON CONFLICT (slug) DO UPDATE SET
                name = EXCLUDED.name, short_description = EXCLUDED.short_description,
                strategy_notes = EXCLUDED.strategy_notes, status = EXCLUDED.status,
                updated_by = EXCLUDED.updated_by,
                published_at = CASE WHEN EXCLUDED.status = 'published' THEN COALESCE(games.published_at, now()) ELSE games.published_at END
        SQL);
        $statement->execute([
            'slug' => requiredSlug($input),
            'name' => requiredString($input, 'name'),
            'description' => requiredString($input, 'shortDescription', 2_000),
            'notes' => json_encode(stringList($input, 'strategyNotes', 5_000), JSON_THROW_ON_ERROR),
            'status' => $status,
            'actor' => $actorId,
        ]);
    }

    /** @param array<string, mixed> $input */
    private function saveMusic(array $input, ?string $actorId): void
    {
        $spotifyUrl = requiredString($input, 'spotify_url', 2_000);
        if (!filter_var($spotifyUrl, FILTER_VALIDATE_URL) || parse_url($spotifyUrl, PHP_URL_SCHEME) !== 'https') {
            throw new ApiException(422, 'validation_failed', 'spotify_url must be a valid HTTPS URL.');
        }
        $status = contentStatus($input);
        $statement = $this->pdo->prepare(<<<'SQL'
            INSERT INTO music_entries (slug, title, artist, spotify_url, notes, status, created_by, updated_by, published_at)
            VALUES (:slug, :title, :artist, :spotify_url, :notes, :status, :actor, :actor,
                    CASE WHEN :status = 'published' THEN now() ELSE NULL END)
            ON CONFLICT (slug) DO UPDATE SET
                title = EXCLUDED.title, artist = EXCLUDED.artist, spotify_url = EXCLUDED.spotify_url,
                notes = EXCLUDED.notes, status = EXCLUDED.status, updated_by = EXCLUDED.updated_by,
                published_at = CASE WHEN EXCLUDED.status = 'published' THEN COALESCE(music_entries.published_at, now()) ELSE music_entries.published_at END
        SQL);
        $statement->execute([
            'slug' => requiredSlug($input),
            'title' => requiredString($input, 'title'),
            'artist' => requiredString($input, 'artist'),
            'spotify_url' => $spotifyUrl,
            'notes' => optionalString($input, 'notes', 10_000),
            'status' => $status,
            'actor' => $actorId,
        ]);
    }

    /** @return list<mixed> */
    private function decodeJsonList(mixed $value): array
    {
        if (is_array($value)) {
            return array_values($value);
        }
        $decoded = json_decode((string) $value, true);

        return is_array($decoded) ? array_values($decoded) : [];
    }

    private function assertResource(string $resource): void
    {
        if (!in_array($resource, self::RESOURCES, true)) {
            throw new ApiException(404, 'not_found', 'The requested API resource does not exist.');
        }
    }
}
