<?php

declare(strict_types=1);

namespace Wowie\Api\Collectibles;

use PDO;
use Wowie\Api\ApiException;

/**
 * Which collectible figures a visitor owns, keyed as the shelf keys them: a listing id and a
 * figure name. A collection belongs to a signed-in user, or to the guest browser holding the
 * long-lived wowie_collection cookie. A guest collection is created only when its browser first
 * saves a figure, and merges into the account the next time that browser reads it signed in.
 *
 * An owner is ['type' => 'user'|'guest', 'id' => uuid].
 */
final class CollectibleCollectionRepository
{
    public const COOKIE_NAME = 'wowie_collection';
    /** 400 days, the longest any browser keeps a cookie; every collection request renews it. */
    public const COOKIE_TTL_SECONDS = 34_560_000;
    public const MAX_FIGURES = 10_000;
    public const MAX_QUANTITY = 1_000_000;
    public const MAX_MERGE_FIGURES = 5_000;

    public function __construct(private readonly PDO $pdo)
    {
    }

    /** The raw token in this request's collection cookie, when it is well formed. */
    public function cookieToken(): ?string
    {
        $token = isset($_COOKIE[self::COOKIE_NAME]) && is_string($_COOKIE[self::COOKIE_NAME])
            ? trim($_COOKIE[self::COOKIE_NAME])
            : '';

        return preg_match('/\A[A-Za-z0-9_-]{43}\z/', $token) === 1 ? $token : null;
    }

    /** The guest collection a token names, marking it seen; null when there is none. */
    public function findGuest(string $token): ?string
    {
        $statement = $this->pdo->prepare(<<<'SQL'
            UPDATE collectible_guest_collections
            SET last_seen_at = now()
            WHERE cookie_token_hash = :token_hash
            RETURNING id
        SQL);
        $statement->execute(['token_hash' => hash('sha256', $token)]);
        $id = $statement->fetchColumn();

        return is_string($id) ? $id : null;
    }

    /** @return array{id: string, token: string} */
    public function createGuest(): array
    {
        $token = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
        $statement = $this->pdo->prepare(<<<'SQL'
            INSERT INTO collectible_guest_collections (cookie_token_hash)
            VALUES (:token_hash)
            RETURNING id
        SQL);
        $statement->execute(['token_hash' => hash('sha256', $token)]);

        return ['id' => (string) $statement->fetchColumn(), 'token' => $token];
    }

    public static function cookieHeader(string $token, bool $secure): string
    {
        return self::cookie($token, self::COOKIE_TTL_SECONDS, $secure);
    }

    public static function expiredCookieHeader(bool $secure): string
    {
        return self::cookie('', 0, $secure);
    }

    /**
     * @param array{type: string, id: string} $owner
     * @return list<array{product_id: string, figure_name: string, quantity: int}>
     */
    public function figures(array $owner): array
    {
        $column = self::ownerColumn($owner);
        $statement = $this->pdo->prepare(<<<SQL
            SELECT product_id, figure_name, quantity
            FROM collectible_owned_figures
            WHERE {$column} = :owner
            ORDER BY product_id, figure_name
        SQL);
        $statement->execute(['owner' => $owner['id']]);

        return array_map(self::figureRow(...), $statement->fetchAll(PDO::FETCH_ASSOC) ?: []);
    }

    /**
     * Sets how many of one figure the owner has; zero removes it.
     *
     * @param array{type: string, id: string} $owner
     * @param array{product_id: string, figure_name: string, quantity: int} $figure from validFigure()
     * @return array{product_id: string, figure_name: string, quantity: int}
     */
    public function setFigure(array $owner, array $figure): array
    {
        $column = self::ownerColumn($owner);
        if ($figure['quantity'] === 0) {
            $this->pdo->prepare(<<<SQL
                DELETE FROM collectible_owned_figures
                WHERE {$column} = :owner AND product_id = :product_id AND figure_name = :figure_name
            SQL)->execute(['owner' => $owner['id'], 'product_id' => $figure['product_id'], 'figure_name' => $figure['figure_name']]);

            return $figure;
        }

        $this->pdo->beginTransaction();
        try {
            $this->upsert($owner, $figure, false);
            $this->requireRoom($owner);
            $this->pdo->commit();
        } catch (\Throwable $error) {
            $this->pdo->rollBack();
            throw $error;
        }

        return $figure;
    }

    /**
     * Adds figures recorded elsewhere (such as an older copy kept in the browser); where the
     * owner already has a figure, the larger quantity wins. Returns how many figures changed.
     *
     * @param array{type: string, id: string} $owner
     * @param list<array{product_id: string, figure_name: string, quantity: int}> $figures from validMergeFigures()
     */
    public function mergeFigures(array $owner, array $figures): int
    {
        $this->pdo->beginTransaction();
        try {
            $changed = 0;
            foreach ($figures as $figure) {
                $changed += $this->upsert($owner, $figure, true);
            }
            $this->requireRoom($owner);
            $this->pdo->commit();
        } catch (\Throwable $error) {
            $this->pdo->rollBack();
            throw $error;
        }

        return $changed;
    }

    /**
     * Moves a guest collection into a user's (the larger quantity wins) and deletes the guest
     * collection. Returns how many figures the guest collection held.
     */
    public function adoptGuest(string $guestId, string $userId): int
    {
        $this->pdo->beginTransaction();
        try {
            $count = $this->pdo->prepare('SELECT count(*) FROM collectible_owned_figures WHERE guest_collection_id = :guest');
            $count->execute(['guest' => $guestId]);
            $adopted = (int) $count->fetchColumn();
            $this->pdo->prepare(<<<'SQL'
                INSERT INTO collectible_owned_figures (user_id, product_id, figure_name, quantity)
                SELECT :user, product_id, figure_name, quantity
                FROM collectible_owned_figures
                WHERE guest_collection_id = :guest
                ON CONFLICT (user_id, product_id, figure_name) WHERE user_id IS NOT NULL
                DO UPDATE SET quantity = GREATEST(collectible_owned_figures.quantity, EXCLUDED.quantity)
            SQL)->execute(['user' => $userId, 'guest' => $guestId]);
            $this->pdo->prepare('DELETE FROM collectible_guest_collections WHERE id = :guest')
                ->execute(['guest' => $guestId]);
            $this->pdo->commit();
        } catch (\Throwable $error) {
            $this->pdo->rollBack();
            throw $error;
        }

        return $adopted;
    }

    /**
     * Inserts or updates one figure. When merging, an existing larger quantity is kept.
     * Returns 1 when the row changed.
     *
     * @param array{type: string, id: string} $owner
     * @param array{product_id: string, figure_name: string, quantity: int} $figure
     */
    private function upsert(array $owner, array $figure, bool $keepLarger): int
    {
        $column = self::ownerColumn($owner);
        $update = $keepLarger
            ? 'quantity = GREATEST(collectible_owned_figures.quantity, EXCLUDED.quantity) WHERE collectible_owned_figures.quantity < EXCLUDED.quantity'
            : 'quantity = EXCLUDED.quantity';
        $statement = $this->pdo->prepare(<<<SQL
            INSERT INTO collectible_owned_figures ({$column}, product_id, figure_name, quantity)
            VALUES (:owner, :product_id, :figure_name, :quantity)
            ON CONFLICT ({$column}, product_id, figure_name) WHERE {$column} IS NOT NULL
            DO UPDATE SET {$update}
        SQL);
        $statement->execute([
            'owner' => $owner['id'],
            'product_id' => $figure['product_id'],
            'figure_name' => $figure['figure_name'],
            'quantity' => $figure['quantity'],
        ]);

        return $statement->rowCount() > 0 ? 1 : 0;
    }

    /** @param array{type: string, id: string} $owner */
    private function requireRoom(array $owner): void
    {
        $column = self::ownerColumn($owner);
        $statement = $this->pdo->prepare("SELECT count(*) FROM collectible_owned_figures WHERE {$column} = :owner");
        $statement->execute(['owner' => $owner['id']]);
        if ((int) $statement->fetchColumn() > self::MAX_FIGURES) {
            throw new ApiException(422, 'collection_full', 'A collection holds up to ' . number_format(self::MAX_FIGURES) . ' different figures.');
        }
    }

    /**
     * A merge body's figures, validated, without zero quantities or repeats.
     *
     * @return list<array{product_id: string, figure_name: string, quantity: int}>
     */
    public static function validMergeFigures(mixed $input): array
    {
        if (!is_array($input) || !array_is_list($input) || count($input) > self::MAX_MERGE_FIGURES) {
            throw new ApiException(422, 'validation_error', 'figures must be a list of up to ' . self::MAX_MERGE_FIGURES . ' figures.', [
                'figures' => 'Send a list of {product_id, figure_name, quantity}.',
            ]);
        }
        $figures = [];
        foreach ($input as $index => $entry) {
            $figure = self::validFigure($entry, "figures[{$index}].quantity");
            if ($figure['quantity'] > 0) {
                $figures[json_encode([$figure['product_id'], $figure['figure_name']])] = $figure;
            }
        }

        return array_values($figures);
    }

    /**
     * @return array{product_id: string, figure_name: string, quantity: int}
     */
    public static function validFigure(mixed $input, string $quantityField = 'quantity'): array
    {
        $productId = is_array($input) ? ($input['product_id'] ?? null) : null;
        $figureName = is_array($input) ? ($input['figure_name'] ?? null) : null;
        $quantity = is_array($input) ? ($input['quantity'] ?? null) : null;
        $details = [];
        if (!is_string($productId) || preg_match('/\A[A-Za-z0-9:._-]{1,200}\z/', $productId) !== 1) {
            $details['product_id'] = 'Use the listing id the shelf shows (1-200 letters, digits, or :._-).';
        }
        if (!is_string($figureName) || mb_strlen($figureName) > 300 || preg_match('//u', $figureName) !== 1) {
            $details['figure_name'] = 'Use the figure name, up to 300 characters.';
        }
        if (!is_int($quantity) || $quantity < 0 || $quantity > self::MAX_QUANTITY) {
            $details[$quantityField] = 'Use a whole number from 0 to ' . number_format(self::MAX_QUANTITY) . '.';
        }
        if ($details !== []) {
            throw new ApiException(422, 'validation_error', 'That figure could not be saved.', $details);
        }

        return ['product_id' => $productId, 'figure_name' => $figureName, 'quantity' => $quantity];
    }

    /** @param array<string, mixed> $row @return array{product_id: string, figure_name: string, quantity: int} */
    private static function figureRow(array $row): array
    {
        return [
            'product_id' => (string) $row['product_id'],
            'figure_name' => (string) $row['figure_name'],
            'quantity' => (int) $row['quantity'],
        ];
    }

    /** @param array{type: string, id: string} $owner */
    private static function ownerColumn(array $owner): string
    {
        return match ($owner['type']) {
            'user' => 'user_id',
            'guest' => 'guest_collection_id',
            default => throw new \InvalidArgumentException('A collection owner is a user or a guest.'),
        };
    }

    private static function cookie(string $value, int $lifetime, bool $secure): string
    {
        $parts = [
            self::COOKIE_NAME . '=' . $value,
            'Path=/',
            'HttpOnly',
            'SameSite=Lax',
            'Max-Age=' . $lifetime,
            'Expires=' . gmdate(DATE_RFC7231, $lifetime === 0 ? 0 : time() + $lifetime),
        ];
        if ($secure) {
            $parts[] = 'Secure';
        }

        return implode('; ', $parts);
    }
}
