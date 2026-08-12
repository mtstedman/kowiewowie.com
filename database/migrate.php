#!/usr/bin/env php
<?php

declare(strict_types=1);

// Backward-compatible entry point. The canonical version minter and complete
// update chain live with the versioned PostgreSQL documentation.
require __DIR__ . '/../docs/postgres/db-version-minter.php';
