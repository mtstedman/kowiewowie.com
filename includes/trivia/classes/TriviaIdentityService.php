<?php

declare(strict_types=1);

namespace Wowie\Api\Trivia;

use PDO;
use Wowie\Api\Chess\ChessIdentityService;

final class TriviaIdentityService
{
    private readonly ChessIdentityService $guests;

    public function __construct(PDO $pdo)
    {
        $this->guests = new ChessIdentityService($pdo);
    }

    /**
     * @param array<string, mixed>|null $user
     * @return array{guest_profile: array<string, mixed>, user: array<string, mixed>|null, response_headers: array<string, string>}
     */
    public function resolve(?array $user = null): array
    {
        return $this->guests->resolve($user);
    }
}
