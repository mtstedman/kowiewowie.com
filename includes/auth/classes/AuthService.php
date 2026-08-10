<?php

declare(strict_types=1);

namespace Wowie\Api\Auth;

use DateTimeImmutable;
use DateTimeZone;
use PDO;
use PDOException;
use Throwable;
use Wowie\Api\ApiException;
use Wowie\Api\Config;

final class AuthService
{
    private readonly int $refreshTtl;

    public function __construct(
        private readonly PDO $pdo,
        private readonly JwtService $jwt,
        private readonly Config $config,
    ) {
        $this->refreshTtl = max(3600, $config->integer('WOWIE_REFRESH_TOKEN_TTL', 2_592_000));
    }

    /**
     * @param array<string, mixed> $input
     * @return array<string, mixed>
     */
    public function register(array $input, ?string $ip, ?string $userAgent): array
    {
        if (!$this->config->boolean('WOWIE_REGISTRATION_ENABLED', false)) {
            throw new ApiException(403, 'registration_disabled', 'Public registration is currently disabled.');
        }

        $email = $this->normalizeEmail($input['email'] ?? null);
        $displayName = trim((string) ($input['display_name'] ?? ''));
        $password = (string) ($input['password'] ?? '');
        if ($displayName === '' || mb_strlen($displayName) > 120) {
            throw new ApiException(422, 'validation_failed', 'display_name must contain between 1 and 120 characters.');
        }
        if (strlen($password) < 12 || strlen($password) > 1024) {
            throw new ApiException(422, 'validation_failed', 'password must contain between 12 and 1024 characters.');
        }

        $passwordHash = password_hash($password, PASSWORD_ARGON2ID);
        if (!is_string($passwordHash)) {
            throw new ApiException(500, 'password_hash_failed', 'The password could not be secured.');
        }

        try {
            $statement = $this->pdo->prepare(<<<'SQL'
                INSERT INTO users (email, display_name, password_hash)
                VALUES (:email, :display_name, :password_hash)
                RETURNING id, email, display_name, roles, status, email_verified_at, created_at
            SQL);
            $statement->execute([
                'email' => $email,
                'display_name' => $displayName,
                'password_hash' => $passwordHash,
            ]);
            $user = $statement->fetch();
        } catch (PDOException $error) {
            if ($error->getCode() === '23505') {
                throw new ApiException(409, 'email_in_use', 'An account already exists for that email address.');
            }
            throw $error;
        }

        return $this->issueForUser($this->normalizeUser($user), $ip, $userAgent);
    }

    /**
     * @param array<string, mixed> $input
     * @return array<string, mixed>
     */
    public function login(array $input, ?string $ip, ?string $userAgent): array
    {
        $email = $this->normalizeEmail($input['email'] ?? null);
        $password = (string) ($input['password'] ?? '');
        $statement = $this->pdo->prepare(<<<'SQL'
            SELECT id, email, display_name, password_hash, roles, status, email_verified_at, created_at
            FROM users
            WHERE lower(email) = lower(:email)
            LIMIT 1
        SQL);
        $statement->execute(['email' => $email]);
        $row = $statement->fetch();

        if (!is_array($row) || !is_string($row['password_hash'] ?? null) || !password_verify($password, $row['password_hash'])) {
            throw new ApiException(401, 'credentials_invalid', 'The email or password is incorrect.');
        }
        if (($row['status'] ?? null) !== 'active') {
            throw new ApiException(403, 'account_unavailable', 'This account is not active.');
        }

        if (password_needs_rehash($row['password_hash'], PASSWORD_ARGON2ID)) {
            $rehash = password_hash($password, PASSWORD_ARGON2ID);
            if (is_string($rehash)) {
                $update = $this->pdo->prepare('UPDATE users SET password_hash = :hash WHERE id = :id');
                $update->execute(['hash' => $rehash, 'id' => $row['id']]);
            }
        }
        $this->pdo->prepare('UPDATE users SET last_login_at = now() WHERE id = :id')->execute(['id' => $row['id']]);

        unset($row['password_hash']);
        return $this->issueForUser($this->normalizeUser($row), $ip, $userAgent);
    }

    /** @return array<string, mixed> */
    public function refresh(string $refreshToken, ?string $ip, ?string $userAgent): array
    {
        if ($refreshToken === '') {
            throw new ApiException(401, 'refresh_token_invalid', 'A refresh token is required.');
        }

        $hash = hash('sha256', $refreshToken);
        $this->pdo->beginTransaction();
        try {
            $statement = $this->pdo->prepare(<<<'SQL'
                SELECT rt.id AS refresh_id, rt.family_id, rt.expires_at, rt.revoked_at,
                       u.id, u.email, u.display_name, u.roles, u.status,
                       u.email_verified_at, u.created_at
                FROM refresh_tokens rt
                JOIN users u ON u.id = rt.user_id
                WHERE rt.token_hash = :token_hash
                FOR UPDATE OF rt
            SQL);
            $statement->execute(['token_hash' => $hash]);
            $row = $statement->fetch();
            if (!is_array($row)) {
                $this->pdo->rollBack();
                throw new ApiException(401, 'refresh_token_invalid', 'The refresh token is invalid.');
            }

            if ($row['revoked_at'] !== null) {
                $this->pdo->prepare('UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, now()) WHERE family_id = :family_id')
                    ->execute(['family_id' => $row['family_id']]);
                $this->pdo->commit();
                throw new ApiException(401, 'refresh_token_reused', 'Refresh-token reuse was detected; this token family has been revoked.');
            }
            if (strtotime((string) $row['expires_at']) <= time()) {
                $this->pdo->prepare('UPDATE refresh_tokens SET revoked_at = now() WHERE id = :id')
                    ->execute(['id' => $row['refresh_id']]);
                $this->pdo->commit();
                throw new ApiException(401, 'refresh_token_expired', 'The refresh token has expired.');
            }
            if ($row['status'] !== 'active') {
                $this->pdo->rollBack();
                throw new ApiException(403, 'account_unavailable', 'This account is not active.');
            }

            $user = $this->normalizeUser([
                'id' => $row['id'],
                'email' => $row['email'],
                'display_name' => $row['display_name'],
                'roles' => $row['roles'],
                'status' => $row['status'],
                'email_verified_at' => $row['email_verified_at'],
                'created_at' => $row['created_at'],
            ]);
            $next = $this->createRefreshToken((string) $user['id'], (string) $row['family_id'], $ip, $userAgent);
            $update = $this->pdo->prepare('UPDATE refresh_tokens SET revoked_at = now(), replaced_by_id = :replacement WHERE id = :id');
            $update->execute(['replacement' => $next['id'], 'id' => $row['refresh_id']]);
            $this->pdo->commit();

            return $this->tokenPayload($user, $next['token']);
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $error;
        }
    }

    public function logout(string $refreshToken): void
    {
        if ($refreshToken === '') {
            return;
        }
        $statement = $this->pdo->prepare('UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, now()) WHERE token_hash = :token_hash');
        $statement->execute(['token_hash' => hash('sha256', $refreshToken)]);
    }

    /** @return array<string, mixed> */
    public function authenticatedUser(string $accessToken): array
    {
        $claims = $this->jwt->verify($accessToken);
        return $this->userById((string) $claims['sub']);
    }

    /** @return array<string, mixed> */
    public function userById(string $userId): array
    {
        $statement = $this->pdo->prepare(<<<'SQL'
            SELECT id, email, display_name, roles, status, email_verified_at, created_at
            FROM users
            WHERE id = :id
            LIMIT 1
        SQL);
        $statement->execute(['id' => $userId]);
        $user = $statement->fetch();
        if (!is_array($user) || ($user['status'] ?? null) !== 'active') {
            throw new ApiException(401, 'token_invalid', 'The access token user is unavailable.');
        }

        return $this->normalizeUser($user);
    }

    /**
     * @param array<string, mixed> $user
     * @return array<string, mixed>
     */
    public function issueForUser(array $user, ?string $ip, ?string $userAgent): array
    {
        $familyId = $this->uuid();
        $this->pdo->beginTransaction();
        try {
            $refresh = $this->createRefreshToken((string) $user['id'], $familyId, $ip, $userAgent);
            $this->pdo->commit();
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $error;
        }

        return $this->tokenPayload($user, $refresh['token']);
    }

    /** @param array<string, mixed> $user */
    public function requireAnyRole(array $user, array $allowedRoles): void
    {
        $roles = is_array($user['roles'] ?? null) ? $user['roles'] : [];
        if (array_intersect($allowedRoles, $roles) === []) {
            throw new ApiException(403, 'permission_denied', 'This account cannot modify content.');
        }
    }

    /** @return array{id: string, token: string} */
    private function createRefreshToken(string $userId, string $familyId, ?string $ip, ?string $userAgent): array
    {
        $token = rtrim(strtr(base64_encode(random_bytes(48)), '+/', '-_'), '=');
        $expiresAt = (new DateTimeImmutable('now', new DateTimeZone('UTC')))
            ->modify("+{$this->refreshTtl} seconds")
            ->format('Y-m-d H:i:sP');
        $id = $this->uuid();
        $statement = $this->pdo->prepare(<<<'SQL'
            INSERT INTO refresh_tokens (
                id, user_id, family_id, token_hash, expires_at, created_by_ip, user_agent
            ) VALUES (
                :id, :user_id, :family_id, :token_hash, :expires_at, CAST(:created_by_ip AS inet), :user_agent
            )
        SQL);
        $statement->execute([
            'id' => $id,
            'user_id' => $userId,
            'family_id' => $familyId,
            'token_hash' => hash('sha256', $token),
            'expires_at' => $expiresAt,
            'created_by_ip' => $ip !== null && filter_var($ip, FILTER_VALIDATE_IP) ? $ip : null,
            'user_agent' => $userAgent !== null ? mb_substr($userAgent, 0, 500) : null,
        ]);

        return ['id' => $id, 'token' => $token];
    }

    /**
     * @param array<string, mixed> $user
     * @return array<string, mixed>
     */
    private function tokenPayload(array $user, string $refreshToken): array
    {
        $roles = is_array($user['roles'] ?? null) ? $user['roles'] : [];
        return [
            'token_type' => 'Bearer',
            'access_token' => $this->jwt->issue((string) $user['id'], $roles),
            'expires_in' => $this->jwt->ttl(),
            'refresh_token' => $refreshToken,
            'refresh_expires_in' => $this->refreshTtl,
            'user' => $user,
        ];
    }

    private function normalizeEmail(mixed $value): string
    {
        $email = mb_strtolower(trim(is_string($value) ? $value : ''));
        if (strlen($email) > 320 || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            throw new ApiException(422, 'validation_failed', 'A valid email address is required.');
        }

        return $email;
    }

    /** @param array<string, mixed>|false $row @return array<string, mixed> */
    private function normalizeUser(array|false $row): array
    {
        if ($row === false) {
            throw new ApiException(500, 'database_error', 'The user record could not be loaded.');
        }

        return [
            'id' => (string) $row['id'],
            'email' => (string) $row['email'],
            'display_name' => (string) $row['display_name'],
            'roles' => $this->parsePostgresArray($row['roles'] ?? '{}'),
            'status' => (string) $row['status'],
            'email_verified' => $row['email_verified_at'] !== null,
            'created_at' => (string) $row['created_at'],
        ];
    }

    /** @return list<string> */
    private function parsePostgresArray(mixed $value): array
    {
        if (is_array($value)) {
            return array_values(array_map('strval', $value));
        }
        $raw = trim((string) $value, '{}');
        if ($raw === '') {
            return [];
        }

        return array_values(array_map(
            static fn (string $role): string => trim($role, '"'),
            str_getcsv($raw, ',', '"', '\\'),
        ));
    }

    private function uuid(): string
    {
        $bytes = random_bytes(16);
        $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
        $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
        $hex = bin2hex($bytes);

        return sprintf('%s-%s-%s-%s-%s', substr($hex, 0, 8), substr($hex, 8, 4), substr($hex, 12, 4), substr($hex, 16, 4), substr($hex, 20));
    }
}
