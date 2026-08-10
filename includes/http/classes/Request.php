<?php

declare(strict_types=1);

namespace Wowie\Api\Http;

use Wowie\Api\ApiException;

final class Request
{
    /**
     * @param array<string, string> $headers
     * @param array<string, string> $query
     */
    public function __construct(
        public readonly string $method,
        public readonly string $path,
        public readonly array $headers,
        public readonly array $query,
        private readonly string $rawBody,
        public readonly ?string $remoteAddress = null,
    ) {
    }

    public static function fromGlobals(): self
    {
        $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
        $rawPath = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
        $path = is_string($rawPath) ? rtrim($rawPath, '/') ?: '/' : '/';
        $path = preg_replace('#^/api(?=/|$)#', '', $path) ?: '/';

        $headers = [];
        foreach ($_SERVER as $name => $value) {
            if (!is_string($value)) {
                continue;
            }
            if (str_starts_with($name, 'HTTP_')) {
                $header = strtolower(str_replace('_', '-', substr($name, 5)));
                $headers[$header] = $value;
            }
        }
        if (isset($_SERVER['CONTENT_TYPE'])) {
            $headers['content-type'] = (string) $_SERVER['CONTENT_TYPE'];
        }

        $query = [];
        foreach ($_GET as $name => $value) {
            if (is_string($name) && is_scalar($value)) {
                $query[$name] = (string) $value;
            }
        }

        return new self(
            $method,
            $path,
            $headers,
            $query,
            file_get_contents('php://input') ?: '',
            isset($_SERVER['REMOTE_ADDR']) ? (string) $_SERVER['REMOTE_ADDR'] : null,
        );
    }

    /** @return array<string, mixed> */
    public function json(): array
    {
        if (trim($this->rawBody) === '') {
            return [];
        }

        try {
            $decoded = json_decode($this->rawBody, true, 128, JSON_THROW_ON_ERROR);
        } catch (\JsonException $error) {
            throw new ApiException(400, 'invalid_json', 'The request body must contain valid JSON.', [
                'reason' => $error->getMessage(),
            ]);
        }

        if (!is_array($decoded) || array_is_list($decoded)) {
            throw new ApiException(400, 'invalid_json', 'The request body must be a JSON object.');
        }

        return $decoded;
    }

    public function header(string $name): ?string
    {
        return $this->headers[strtolower($name)] ?? null;
    }

    public function bearerToken(): string
    {
        $authorization = $this->header('authorization') ?? '';
        if (!preg_match('/^Bearer\s+(.+)$/i', $authorization, $matches)) {
            throw new ApiException(401, 'authentication_required', 'A Bearer access token is required.');
        }

        return trim($matches[1]);
    }
}
