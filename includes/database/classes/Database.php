<?php

declare(strict_types=1);

namespace Wowie\Api\Database;

use PDO;
use Wowie\Api\Config;

final class Database
{
    public static function connect(Config $config): PDO
    {
        $pdo = new PDO(
            $config->require('WOWIE_DB_DSN'),
            $config->require('WOWIE_DB_USER'),
            $config->require('WOWIE_DB_PASSWORD'),
            [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
                PDO::ATTR_STRINGIFY_FETCHES => false,
            ],
        );
        $pdo->exec("SET TIME ZONE 'UTC'");

        return $pdo;
    }
}
