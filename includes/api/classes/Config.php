<?php

declare(strict_types=1);

namespace Wowie\Api;

final class Config
{
    private function __construct(private readonly string $projectRoot)
    {
    }

    public static function load(string $projectRoot): self
    {
        $config = new self(rtrim($projectRoot, '/'));
        $config->loadEnvironmentFile();

        return $config;
    }

    public function projectRoot(): string
    {
        return $this->projectRoot;
    }

    public function get(string $name, ?string $default = null): ?string
    {
        $value = getenv($name);
        if ($value === false || $value === '') {
            return $default;
        }

        return $value;
    }

    public function require(string $name): string
    {
        $value = $this->get($name);
        if ($value === null) {
            throw new ApiException(503, 'configuration_missing', "Required configuration {$name} is not set.");
        }

        return $value;
    }

    public function integer(string $name, int $default): int
    {
        $value = $this->get($name);
        if ($value === null || filter_var($value, FILTER_VALIDATE_INT) === false) {
            return $default;
        }

        return (int) $value;
    }

    public function boolean(string $name, bool $default = false): bool
    {
        $value = $this->get($name);
        if ($value === null) {
            return $default;
        }

        return filter_var($value, FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE) ?? $default;
    }

    /** @return list<string> */
    public function csv(string $name, array $default = []): array
    {
        $value = $this->get($name);
        if ($value === null) {
            return $default;
        }

        return array_values(array_filter(array_map('trim', explode(',', $value)), static fn (string $item): bool => $item !== ''));
    }

    private function loadEnvironmentFile(): void
    {
        $explicit = getenv('WOWIE_ENV_FILE');
        $configHome = getenv('XDG_CONFIG_HOME');
        if (!is_string($configHome) || $configHome === '') {
            $userHome = getenv('HOME');
            $configHome = is_string($userHome) && $userHome !== '' ? $userHome . '/.config' : null;
        }
        $candidates = array_values(array_filter([
            is_string($explicit) && $explicit !== '' ? $explicit : null,
            '/etc/wowiekowie.com/api.env',
            is_string($configHome) ? $configHome . '/wowiekowie/api.env' : null,
            $this->projectRoot . '/.env',
        ]));

        foreach ($candidates as $path) {
            if (!is_readable($path)) {
                continue;
            }

            $values = parse_ini_file($path, false, INI_SCANNER_RAW);
            if ($values === false) {
                throw new ApiException(503, 'configuration_invalid', "Could not parse environment file {$path}.");
            }

            foreach ($values as $name => $value) {
                if (!is_string($name) || (!is_string($value) && !is_numeric($value))) {
                    continue;
                }
                if (getenv($name) !== false) {
                    continue;
                }

                $stringValue = (string) $value;
                putenv("{$name}={$stringValue}");
                $_ENV[$name] = $stringValue;
            }

            break;
        }
    }
}
