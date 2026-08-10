<?php

declare(strict_types=1);

namespace Wowie\Api\Auth;

use JsonException;
use Wowie\Api\ApiException;
use Wowie\Api\Config;

final class JwtService
{
    private readonly string $secret;
    private readonly string $issuer;
    private readonly string $audience;
    private readonly int $ttl;

    public function __construct(Config $config)
    {
        $configuredSecret = $config->require('WOWIE_JWT_SECRET');
        if (str_starts_with($configuredSecret, 'base64:')) {
            $decoded = base64_decode(substr($configuredSecret, 7), true);
            if ($decoded === false) {
                throw new ApiException(503, 'configuration_invalid', 'WOWIE_JWT_SECRET is not valid base64.');
            }
            $configuredSecret = $decoded;
        }
        if (strlen($configuredSecret) < 32) {
            throw new ApiException(503, 'configuration_invalid', 'WOWIE_JWT_SECRET must contain at least 32 bytes.');
        }

        $this->secret = $configuredSecret;
        $this->issuer = $config->get('WOWIE_JWT_ISSUER', 'https://api.wowiekowie.com') ?? 'https://api.wowiekowie.com';
        $this->audience = $config->get('WOWIE_JWT_AUDIENCE', 'wowiekowie.com') ?? 'wowiekowie.com';
        $this->ttl = max(60, $config->integer('WOWIE_ACCESS_TOKEN_TTL', 900));
    }

    /** @param list<string> $roles */
    public function issue(string $userId, array $roles): string
    {
        $now = time();
        $header = ['alg' => 'HS256', 'typ' => 'JWT'];
        $claims = [
            'iss' => $this->issuer,
            'aud' => $this->audience,
            'sub' => $userId,
            'jti' => bin2hex(random_bytes(16)),
            'roles' => array_values($roles),
            'iat' => $now,
            'nbf' => $now - 5,
            'exp' => $now + $this->ttl,
        ];

        $unsigned = self::encodeJson($header) . '.' . self::encodeJson($claims);
        $signature = hash_hmac('sha256', $unsigned, $this->secret, true);

        return $unsigned . '.' . self::base64UrlEncode($signature);
    }

    /** @return array<string, mixed> */
    public function verify(string $token): array
    {
        $parts = explode('.', $token);
        if (count($parts) !== 3) {
            throw new ApiException(401, 'token_invalid', 'The access token is malformed.');
        }

        [$encodedHeader, $encodedClaims, $encodedSignature] = $parts;
        try {
            $header = json_decode(self::base64UrlDecode($encodedHeader), true, 16, JSON_THROW_ON_ERROR);
            $claims = json_decode(self::base64UrlDecode($encodedClaims), true, 64, JSON_THROW_ON_ERROR);
            $signature = self::base64UrlDecode($encodedSignature);
        } catch (JsonException|\UnexpectedValueException) {
            throw new ApiException(401, 'token_invalid', 'The access token could not be decoded.');
        }

        if (!is_array($header) || ($header['alg'] ?? null) !== 'HS256' || ($header['typ'] ?? null) !== 'JWT') {
            throw new ApiException(401, 'token_invalid', 'The access token uses an unsupported signing format.');
        }
        if (!is_array($claims)) {
            throw new ApiException(401, 'token_invalid', 'The access token claims are invalid.');
        }

        $expected = hash_hmac('sha256', $encodedHeader . '.' . $encodedClaims, $this->secret, true);
        if (!hash_equals($expected, $signature)) {
            throw new ApiException(401, 'token_invalid', 'The access token signature is invalid.');
        }

        $now = time();
        $leeway = 30;
        if (($claims['iss'] ?? null) !== $this->issuer || ($claims['aud'] ?? null) !== $this->audience) {
            throw new ApiException(401, 'token_invalid', 'The access token issuer or audience is invalid.');
        }
        if (!isset($claims['sub'], $claims['exp'], $claims['nbf']) || !is_string($claims['sub'])) {
            throw new ApiException(401, 'token_invalid', 'The access token is missing required claims.');
        }
        if ((int) $claims['exp'] < $now - $leeway) {
            throw new ApiException(401, 'token_expired', 'The access token has expired.');
        }
        if ((int) $claims['nbf'] > $now + $leeway) {
            throw new ApiException(401, 'token_invalid', 'The access token is not active yet.');
        }

        return $claims;
    }

    public function ttl(): int
    {
        return $this->ttl;
    }

    /** @param array<string, mixed> $value */
    private static function encodeJson(array $value): string
    {
        return self::base64UrlEncode(json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES));
    }

    private static function base64UrlEncode(string $value): string
    {
        return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
    }

    private static function base64UrlDecode(string $value): string
    {
        if ($value === '' || preg_match('/[^A-Za-z0-9_-]/', $value)) {
            throw new \UnexpectedValueException('Invalid base64url value.');
        }
        $padding = (4 - strlen($value) % 4) % 4;
        $decoded = base64_decode(strtr($value . str_repeat('=', $padding), '-_', '+/'), true);
        if ($decoded === false) {
            throw new \UnexpectedValueException('Invalid base64url value.');
        }

        return $decoded;
    }
}
