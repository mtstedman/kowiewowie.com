<?php

declare(strict_types=1);
?>
<footer>
    <span>© <?= htmlspecialchars($year, ENT_QUOTES, 'UTF-8') ?> wowiekowie.com</span>
    <span class="footer-note">Built by hand, lightly weird, still awake.</span>
</footer>

<?php
$publicShellScriptPath = dirname(__DIR__) . '/assets/js/public-shell.js';
$publicShellScriptVersion = is_file($publicShellScriptPath) ? (string) filemtime($publicShellScriptPath) : '1';
?>
<script src="/assets/js/public-shell.js?v=<?= rawurlencode($publicShellScriptVersion) ?>" defer></script>
