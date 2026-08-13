<?php

declare(strict_types=1);

namespace Wowie\Api\Chess;

use PDO;

final class ChessIdentityService
{
    private const COOKIE_NAME = 'wowie_chess_guest';
    private const COOKIE_TTL_SECONDS = 7_776_000;

    public function __construct(private readonly PDO $pdo)
    {
    }

    /**
     * @param array<string, mixed>|null $user
     * @return array{guest_profile: array<string, mixed>, user: array<string, mixed>|null, response_headers: array<string, string>}
     */
    public function resolve(?array $user = null): array
    {
        $rawToken = isset($_COOKIE[self::COOKIE_NAME]) && is_string($_COOKIE[self::COOKIE_NAME])
            ? trim($_COOKIE[self::COOKIE_NAME])
            : '';

        if ($rawToken !== '' && strlen($rawToken) <= 512) {
            $profile = $this->findActiveProfile(hash('sha256', $rawToken));
            if ($profile !== null) {
                return [
                    'guest_profile' => $this->refreshProfile((string) $profile['id']),
                    'user' => $user,
                    'response_headers' => ['Set-Cookie' => $this->cookieHeader($rawToken)],
                ];
            }
        }

        $rawToken = $this->newToken();
        $profile = $this->createProfile(hash('sha256', $rawToken));

        return [
            'guest_profile' => $profile,
            'user' => $user,
            'response_headers' => ['Set-Cookie' => $this->cookieHeader($rawToken)],
        ];
    }

    /** @return array<string, mixed>|null */
    private function findActiveProfile(string $tokenHash): ?array
    {
        $statement = $this->pdo->prepare(<<<'SQL'
            SELECT id, cookie_token_hash, display_name, last_seen_at, expires_at, created_at, updated_at
            FROM chess_guest_profiles
            WHERE cookie_token_hash = :token_hash
              AND expires_at > now()
            LIMIT 1
        SQL);
        $statement->execute(['token_hash' => $tokenHash]);
        $profile = $statement->fetch(PDO::FETCH_ASSOC);

        return is_array($profile) ? $profile : null;
    }

    /** @return array<string, mixed> */
    private function refreshProfile(string $profileId): array
    {
        $statement = $this->pdo->prepare(<<<'SQL'
            UPDATE chess_guest_profiles
            SET last_seen_at = now(),
                expires_at = now() + interval '90 days',
                updated_at = now()
            WHERE id = :id
            RETURNING id, cookie_token_hash, display_name, last_seen_at, expires_at, created_at, updated_at
        SQL);
        $statement->execute(['id' => $profileId]);
        $profile = $statement->fetch(PDO::FETCH_ASSOC);

        if (!is_array($profile)) {
            throw new \RuntimeException('The refreshed chess guest profile is unavailable.');
        }

        return $profile;
    }

    /** @return array<string, mixed> */
    private function createProfile(string $tokenHash): array
    {
        $statement = $this->pdo->prepare(<<<'SQL'
            INSERT INTO chess_guest_profiles (cookie_token_hash, display_name)
            VALUES (:token_hash, :display_name)
            RETURNING id, cookie_token_hash, display_name, last_seen_at, expires_at, created_at, updated_at
        SQL);
        $statement->execute([
            'token_hash' => $tokenHash,
            'display_name' => $this->newDisplayName(),
        ]);
        $profile = $statement->fetch(PDO::FETCH_ASSOC);

        if (!is_array($profile)) {
            throw new \RuntimeException('The new chess guest profile could not be created.');
        }

        return $profile;
    }

    private function newToken(): string
    {
        return rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
    }

    private function newDisplayName(): string
    {
        return 'Guest ' . strtoupper(substr(bin2hex(random_bytes(2)), 0, 4));
    }

    private function cookieHeader(string $rawToken): string
    {
        $parts = [
            sprintf('%s=%s', self::COOKIE_NAME, $rawToken),
            'Path=/',
            'HttpOnly',
            'SameSite=Lax',
            'Max-Age=' . self::COOKIE_TTL_SECONDS,
            'Expires=' . gmdate(DATE_RFC7231, time() + self::COOKIE_TTL_SECONDS),
        ];
        if ($this->isSecureCookie()) {
            $parts[] = 'Secure';
        }

        return implode('; ', $parts);
    }

    private function isSecureCookie(): bool
    {
        if (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') {
            return true;
        }

        return strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https';
    }
}
