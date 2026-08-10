<?php

declare(strict_types=1);

namespace Wowie\Api\Auth;

use PDO;
use Throwable;
use Wowie\Api\ApiException;
use Wowie\Api\Config;

final class OAuthService
{
    public function __construct(
        private readonly PDO $pdo,
        private readonly AuthService $auth,
        private readonly Config $config,
    ) {
    }

    /** @return array<string, mixed> */
    public function start(string $providerName, ?string $returnTo = null): array
    {
        $provider = $this->provider($providerName);
        $state = self::randomToken(32);
        $verifier = self::randomToken(64);
        $challenge = self::base64Url(hash('sha256', $verifier, true));
        $redirectUri = $provider['redirect_uri'];
        $safeReturnTo = $this->safeReturnTo($returnTo);

        $statement = $this->pdo->prepare(<<<'SQL'
            INSERT INTO oauth_authorization_requests (
                state_hash, provider, code_verifier, redirect_uri, return_to, expires_at
            ) VALUES (
                :state_hash, :provider, :code_verifier, :redirect_uri, :return_to, now() + interval '10 minutes'
            )
        SQL);
        $statement->execute([
            'state_hash' => hash('sha256', $state),
            'provider' => $providerName,
            'code_verifier' => $verifier,
            'redirect_uri' => $redirectUri,
            'return_to' => $safeReturnTo,
        ]);

        $query = [
            'client_id' => $provider['client_id'],
            'redirect_uri' => $redirectUri,
            'response_type' => 'code',
            'scope' => $provider['scope'],
            'state' => $state,
            'code_challenge' => $challenge,
            'code_challenge_method' => 'S256',
        ];
        if ($providerName === 'google') {
            $query['access_type'] = 'online';
            $query['prompt'] = 'select_account';
        }

        return [
            'provider' => $providerName,
            'authorization_url' => $provider['authorize_url'] . '?' . http_build_query($query, '', '&', PHP_QUERY_RFC3986),
            'expires_in' => 600,
        ];
    }

    /** @return array<string, mixed> */
    public function complete(
        string $providerName,
        string $code,
        string $state,
        ?string $ip,
        ?string $userAgent,
    ): array {
        if ($code === '' || $state === '') {
            throw new ApiException(400, 'oauth_callback_invalid', 'The OAuth callback is missing code or state.');
        }
        $provider = $this->provider($providerName);
        $request = $this->consumeAuthorizationRequest($providerName, $state);

        $token = $this->postForm($provider['token_url'], [
            'client_id' => $provider['client_id'],
            'client_secret' => $provider['client_secret'],
            'code' => $code,
            'redirect_uri' => $request['redirect_uri'],
            'grant_type' => 'authorization_code',
            'code_verifier' => $request['code_verifier'],
        ], $providerName === 'github' ? ['Accept: application/json'] : []);
        $accessToken = $token['access_token'] ?? null;
        if (!is_string($accessToken) || $accessToken === '') {
            throw new ApiException(502, 'oauth_exchange_failed', 'The OAuth provider did not return an access token.');
        }

        $identity = $providerName === 'google'
            ? $this->googleIdentity($provider, $accessToken)
            : $this->githubIdentity($provider, $accessToken);
        $user = $this->resolveUser($providerName, $identity);
        $tokens = $this->auth->issueForUser($user, $ip, $userAgent);
        $tokens['oauth_provider'] = $providerName;
        $tokens['return_to'] = $request['return_to'];

        return $tokens;
    }

    /** @return array<string, string> */
    private function consumeAuthorizationRequest(string $provider, string $state): array
    {
        $this->pdo->beginTransaction();
        try {
            $statement = $this->pdo->prepare(<<<'SQL'
                DELETE FROM oauth_authorization_requests
                WHERE state_hash = :state_hash AND provider = :provider
                RETURNING code_verifier, redirect_uri, return_to, expires_at
            SQL);
            $statement->execute([
                'state_hash' => hash('sha256', $state),
                'provider' => $provider,
            ]);
            $request = $statement->fetch();
            $this->pdo->commit();
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $error;
        }

        if (!is_array($request) || strtotime((string) $request['expires_at']) <= time()) {
            throw new ApiException(400, 'oauth_state_invalid', 'The OAuth state is invalid or expired.');
        }

        return [
            'code_verifier' => (string) $request['code_verifier'],
            'redirect_uri' => (string) $request['redirect_uri'],
            'return_to' => (string) $request['return_to'],
        ];
    }

    /** @return array<string, mixed> */
    private function googleIdentity(array $provider, string $accessToken): array
    {
        $profile = $this->getJson($provider['userinfo_url'], $accessToken);
        $subject = $profile['sub'] ?? null;
        $email = $profile['email'] ?? null;
        if (!is_string($subject) || !is_string($email) || ($profile['email_verified'] ?? false) !== true) {
            throw new ApiException(403, 'oauth_identity_unverified', 'Google did not return a verified email identity.');
        }

        return [
            'subject' => $subject,
            'email' => mb_strtolower($email),
            'email_verified' => true,
            'display_name' => is_string($profile['name'] ?? null) ? $profile['name'] : explode('@', $email)[0],
            'avatar_url' => is_string($profile['picture'] ?? null) ? $profile['picture'] : null,
            'profile' => $profile,
        ];
    }

    /** @return array<string, mixed> */
    private function githubIdentity(array $provider, string $accessToken): array
    {
        $profile = $this->getJson($provider['userinfo_url'], $accessToken);
        $emails = $this->getJsonList('https://api.github.com/user/emails', $accessToken);
        $verifiedEmail = null;
        foreach ($emails as $candidate) {
            if (($candidate['verified'] ?? false) === true && ($candidate['primary'] ?? false) === true && is_string($candidate['email'] ?? null)) {
                $verifiedEmail = $candidate['email'];
                break;
            }
        }
        if ($verifiedEmail === null) {
            foreach ($emails as $candidate) {
                if (($candidate['verified'] ?? false) === true && is_string($candidate['email'] ?? null)) {
                    $verifiedEmail = $candidate['email'];
                    break;
                }
            }
        }
        $subject = $profile['id'] ?? null;
        if ((!is_int($subject) && !is_string($subject)) || $verifiedEmail === null) {
            throw new ApiException(403, 'oauth_identity_unverified', 'GitHub did not return a verified email identity.');
        }

        $displayName = $profile['name'] ?? $profile['login'] ?? explode('@', $verifiedEmail)[0];
        return [
            'subject' => (string) $subject,
            'email' => mb_strtolower($verifiedEmail),
            'email_verified' => true,
            'display_name' => (string) $displayName,
            'avatar_url' => is_string($profile['avatar_url'] ?? null) ? $profile['avatar_url'] : null,
            'profile' => $profile,
        ];
    }

    /** @param array<string, mixed> $identity @return array<string, mixed> */
    private function resolveUser(string $provider, array $identity): array
    {
        $this->pdo->beginTransaction();
        try {
            $existing = $this->pdo->prepare(<<<'SQL'
                SELECT u.id
                FROM oauth_accounts oa
                JOIN users u ON u.id = oa.user_id
                WHERE oa.provider = :provider AND oa.provider_subject = :subject
                FOR UPDATE OF oa, u
            SQL);
            $existing->execute(['provider' => $provider, 'subject' => $identity['subject']]);
            $userId = $existing->fetchColumn();

            if (!is_string($userId)) {
                $byEmail = $this->pdo->prepare(<<<'SQL'
                    SELECT id, email_verified_at
                    FROM users
                    WHERE lower(email) = lower(:email)
                    FOR UPDATE
                SQL);
                $byEmail->execute(['email' => $identity['email']]);
                $emailUser = $byEmail->fetch();
                if (is_array($emailUser) && $emailUser['email_verified_at'] === null) {
                    throw new ApiException(
                        409,
                        'oauth_account_link_required',
                        'An unverified password account already uses this email. Verify or explicitly link that account before using OAuth.',
                    );
                }
                $userId = is_array($emailUser) ? $emailUser['id'] : false;
                if (!is_string($userId)) {
                    $insertUser = $this->pdo->prepare(<<<'SQL'
                        INSERT INTO users (email, display_name, email_verified_at)
                        VALUES (:email, :display_name, now())
                        RETURNING id
                    SQL);
                    $insertUser->execute([
                        'email' => $identity['email'],
                        'display_name' => mb_substr((string) $identity['display_name'], 0, 120),
                    ]);
                    $userId = (string) $insertUser->fetchColumn();
                }

                $insertAccount = $this->pdo->prepare(<<<'SQL'
                    INSERT INTO oauth_accounts (
                        user_id, provider, provider_subject, provider_email, profile
                    ) VALUES (
                        :user_id, :provider, :subject, :email, CAST(:profile AS jsonb)
                    )
                SQL);
                $insertAccount->execute([
                    'user_id' => $userId,
                    'provider' => $provider,
                    'subject' => $identity['subject'],
                    'email' => $identity['email'],
                    'profile' => json_encode($identity['profile'], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES),
                ]);
            } else {
                $updateAccount = $this->pdo->prepare(<<<'SQL'
                    UPDATE oauth_accounts
                    SET provider_email = :email, profile = CAST(:profile AS jsonb), updated_at = now()
                    WHERE provider = :provider AND provider_subject = :subject
                SQL);
                $updateAccount->execute([
                    'email' => $identity['email'],
                    'profile' => json_encode($identity['profile'], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES),
                    'provider' => $provider,
                    'subject' => $identity['subject'],
                ]);
            }

            $this->pdo->prepare(<<<'SQL'
                UPDATE users
                SET email_verified_at = COALESCE(email_verified_at, now()), last_login_at = now()
                WHERE id = :id
            SQL)->execute(['id' => $userId]);
            $this->pdo->commit();
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $error;
        }

        return $this->auth->userById($userId);
    }

    /** @return array<string, string> */
    private function provider(string $name): array
    {
        $apiBase = rtrim($this->config->get('WOWIE_API_BASE_URL', 'https://api.wowiekowie.com') ?? 'https://api.wowiekowie.com', '/');
        $providers = [
            'google' => [
                'client_id' => $this->config->get('WOWIE_OAUTH_GOOGLE_CLIENT_ID'),
                'client_secret' => $this->config->get('WOWIE_OAUTH_GOOGLE_CLIENT_SECRET'),
                'authorize_url' => 'https://accounts.google.com/o/oauth2/v2/auth',
                'token_url' => 'https://oauth2.googleapis.com/token',
                'userinfo_url' => 'https://openidconnect.googleapis.com/v1/userinfo',
                'scope' => 'openid email profile',
            ],
            'github' => [
                'client_id' => $this->config->get('WOWIE_OAUTH_GITHUB_CLIENT_ID'),
                'client_secret' => $this->config->get('WOWIE_OAUTH_GITHUB_CLIENT_SECRET'),
                'authorize_url' => 'https://github.com/login/oauth/authorize',
                'token_url' => 'https://github.com/login/oauth/access_token',
                'userinfo_url' => 'https://api.github.com/user',
                'scope' => 'read:user user:email',
            ],
        ];

        if (!isset($providers[$name])) {
            throw new ApiException(404, 'oauth_provider_unknown', 'The requested OAuth provider is not supported.');
        }
        $provider = $providers[$name];
        if (!is_string($provider['client_id']) || $provider['client_id'] === '' || !is_string($provider['client_secret']) || $provider['client_secret'] === '') {
            throw new ApiException(503, 'oauth_provider_unconfigured', "OAuth provider {$name} has not been configured.");
        }
        $provider['redirect_uri'] = $apiBase . '/v1/auth/oauth/' . $name . '/callback';

        /** @var array<string, string> $provider */
        return $provider;
    }

    /** @param array<string, string> $fields @param list<string> $headers @return array<string, mixed> */
    private function postForm(string $url, array $fields, array $headers = []): array
    {
        return $this->requestJson($url, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => http_build_query($fields, '', '&', PHP_QUERY_RFC3986),
            CURLOPT_HTTPHEADER => ['Content-Type: application/x-www-form-urlencoded', ...$headers],
        ]);
    }

    /** @return array<string, mixed> */
    private function getJson(string $url, string $accessToken): array
    {
        $result = $this->requestJson($url, [
            CURLOPT_HTTPHEADER => [
                'Authorization: Bearer ' . $accessToken,
                'Accept: application/json',
            ],
        ]);
        if (array_is_list($result)) {
            throw new ApiException(502, 'oauth_profile_invalid', 'The OAuth provider returned an invalid profile.');
        }

        return $result;
    }

    /** @return list<array<string, mixed>> */
    private function getJsonList(string $url, string $accessToken): array
    {
        $result = $this->requestJson($url, [
            CURLOPT_HTTPHEADER => [
                'Authorization: Bearer ' . $accessToken,
                'Accept: application/json',
            ],
        ]);

        return array_values(array_filter($result, 'is_array'));
    }

    /** @param array<int, mixed> $options @return array<string, mixed>|list<array<string, mixed>> */
    private function requestJson(string $url, array $options): array
    {
        $curl = curl_init($url);
        if ($curl === false) {
            throw new ApiException(502, 'oauth_provider_unavailable', 'The OAuth provider request could not be initialized.');
        }
        $defaults = [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT => 15,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
            CURLOPT_USERAGENT => 'wowiekowie-api/1.0',
        ];
        curl_setopt_array($curl, $options + $defaults);
        $body = curl_exec($curl);
        $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        $error = curl_error($curl);
        curl_close($curl);

        if (!is_string($body) || $status < 200 || $status >= 300) {
            error_log("OAuth provider request failed with HTTP {$status}: {$error}");
            throw new ApiException(502, 'oauth_provider_unavailable', 'The OAuth provider request failed.');
        }
        try {
            $decoded = json_decode($body, true, 128, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            throw new ApiException(502, 'oauth_provider_invalid_response', 'The OAuth provider returned invalid JSON.');
        }
        if (!is_array($decoded)) {
            throw new ApiException(502, 'oauth_provider_invalid_response', 'The OAuth provider returned an invalid response.');
        }

        return $decoded;
    }

    private function safeReturnTo(?string $returnTo): string
    {
        if ($returnTo === null || $returnTo === '') {
            return '/';
        }
        if (!str_starts_with($returnTo, '/') || str_starts_with($returnTo, '//') || strlen($returnTo) > 2048) {
            throw new ApiException(422, 'return_to_invalid', 'return_to must be a local absolute path.');
        }

        return $returnTo;
    }

    private static function randomToken(int $bytes): string
    {
        return self::base64Url(random_bytes($bytes));
    }

    private static function base64Url(string $value): string
    {
        return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
    }
}
