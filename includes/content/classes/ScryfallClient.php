<?php

declare(strict_types=1);

namespace Wowie\Api\Content;

use Wowie\Api\ApiException;

final class ScryfallClient
{
    private const SEARCH_ENDPOINT = 'https://api.scryfall.com/cards/search';

    /**
     * @return list<array{
     *   scryfall_id: string,
     *   name: string,
     *   image_url: ?string,
     *   mana_cost: ?string,
     *   type_line: ?string,
     *   set_name: ?string,
     *   set_code: ?string,
     *   collector_number: ?string
     * }>
     */
    public function search(string $query): array
    {
        $result = $this->requestJson(self::SEARCH_ENDPOINT . '?' . http_build_query([
            'q' => $query,
            'unique' => 'prints',
            'order' => 'released',
        ], '', '&', PHP_QUERY_RFC3986));

        $cards = $result['data'] ?? null;
        if (!is_array($cards)) {
            throw new ApiException(502, 'scryfall_invalid_response', 'The card search service returned an invalid response.');
        }

        $normalized = [];
        foreach ($cards as $card) {
            if (!is_array($card)) {
                continue;
            }

            $id = $this->stringOrNull($card['id'] ?? null);
            $name = $this->stringOrNull($card['name'] ?? null);
            if ($id === null || $name === null) {
                continue;
            }

            $normalized[] = [
                'scryfall_id' => $id,
                'name' => $name,
                'image_url' => $this->imageUrl($card),
                'mana_cost' => $this->stringOrNull($card['mana_cost'] ?? null) ?? $this->faceString($card, 'mana_cost'),
                'type_line' => $this->stringOrNull($card['type_line'] ?? null) ?? $this->faceString($card, 'type_line'),
                'set_name' => $this->stringOrNull($card['set_name'] ?? null),
                'set_code' => $this->stringOrNull($card['set'] ?? null),
                'collector_number' => $this->stringOrNull($card['collector_number'] ?? null),
            ];
        }

        return $normalized;
    }

    /** @return array<string, mixed> */
    private function requestJson(string $url): array
    {
        $curl = curl_init($url);
        if ($curl === false) {
            throw new ApiException(502, 'scryfall_unavailable', 'The card search service is temporarily unavailable.');
        }

        $defaults = [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT => 15,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
            CURLOPT_HTTPHEADER => ['Accept: application/json'],
            CURLOPT_USERAGENT => 'wowiekowie-api/1.0',
        ];
        curl_setopt_array($curl, $defaults);
        $body = curl_exec($curl);
        $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        $error = curl_error($curl);
        curl_close($curl);

        if (!is_string($body)) {
            error_log("Scryfall request failed with HTTP {$status}: {$error}");
            throw new ApiException(502, 'scryfall_unavailable', 'The card search service is temporarily unavailable.');
        }

        if ($status === 404) {
            try {
                $decoded = json_decode($body, true, 128, JSON_THROW_ON_ERROR);
            } catch (\JsonException) {
                error_log("Scryfall request failed with HTTP {$status}: {$error}");
                throw new ApiException(502, 'scryfall_unavailable', 'The card search service is temporarily unavailable.');
            }

            if (is_array($decoded) && ($decoded['code'] ?? null) === 'not_found') {
                return ['data' => []];
            }

            error_log("Scryfall request failed with HTTP {$status}: {$error}");
            throw new ApiException(502, 'scryfall_unavailable', 'The card search service is temporarily unavailable.');
        }

        if ($status < 200 || $status >= 300) {
            error_log("Scryfall request failed with HTTP {$status}: {$error}");
            throw new ApiException(502, 'scryfall_unavailable', 'The card search service is temporarily unavailable.');
        }

        try {
            $decoded = json_decode($body, true, 128, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            throw new ApiException(502, 'scryfall_invalid_response', 'The card search service returned invalid JSON.');
        }

        if (!is_array($decoded)) {
            throw new ApiException(502, 'scryfall_invalid_response', 'The card search service returned an invalid response.');
        }

        return $decoded;
    }

    /** @param array<string, mixed> $card */
    private function imageUrl(array $card): ?string
    {
        $imageUris = $card['image_uris'] ?? null;
        if (is_array($imageUris)) {
            $normal = $this->stringOrNull($imageUris['normal'] ?? null);
            if ($normal !== null) {
                return $normal;
            }
        }

        $faces = $card['card_faces'] ?? null;
        if (!is_array($faces) || $faces === []) {
            return null;
        }

        $firstFace = $faces[0] ?? null;
        if (!is_array($firstFace)) {
            return null;
        }

        $faceUris = $firstFace['image_uris'] ?? null;
        if (!is_array($faceUris)) {
            return null;
        }

        return $this->stringOrNull($faceUris['normal'] ?? null);
    }

    /** @param array<string, mixed> $card */
    private function faceString(array $card, string $field): ?string
    {
        $faces = $card['card_faces'] ?? null;
        if (!is_array($faces) || $faces === []) {
            return null;
        }

        $firstFace = $faces[0] ?? null;
        if (!is_array($firstFace)) {
            return null;
        }

        return $this->stringOrNull($firstFace[$field] ?? null);
    }

    private function stringOrNull(mixed $value): ?string
    {
        return is_string($value) && $value !== '' ? $value : null;
    }
}
