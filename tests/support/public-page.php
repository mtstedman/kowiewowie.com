<?php

declare(strict_types=1);

function public_ux_assert(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, $message . PHP_EOL);
        exit(1);
    }
}

function render_public_page(string $root, string $scriptPath, ?string $requestUri): string
{
    $script = $root . '/' . $scriptPath;
    $requestUriCode = $requestUri === null
        ? 'unset($_SERVER["REQUEST_URI"]);'
        : '$_SERVER["REQUEST_URI"] = ' . var_export($requestUri, true) . ';';
    $code = $requestUriCode
        . '$_SERVER["REQUEST_METHOD"] = "GET";'
        . 'require ' . var_export($script, true) . ';';
    $process = proc_open(
        [PHP_BINARY, '-d', 'display_errors=1', '-r', $code],
        [
            1 => ['pipe', 'w'],
            2 => ['pipe', 'w'],
        ],
        $pipes,
        $root
    );

    public_ux_assert(is_resource($process), 'Unable to render ' . $scriptPath);

    $html = stream_get_contents($pipes[1]);
    $errorOutput = stream_get_contents($pipes[2]);
    fclose($pipes[1]);
    fclose($pipes[2]);

    $status = proc_close($process);
    public_ux_assert($status === 0, $scriptPath . ' failed to render: ' . trim($errorOutput));

    return $html;
}
