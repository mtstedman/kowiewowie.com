<?php

declare(strict_types=1);

$year = gmdate('Y');
$pageTitle = 'Wedding Registry - wowiekowie.com';
$metaDescription = 'Save your wedding details once, start your Amazon, Target, and Zola registries, and track the most-loved products to add on each.';
$pageStyles = ['/assets/css/wedding-registry.css'];
?>
<?php include __DIR__ . '/../partials/head.php'; ?>
<body>
    <div class="page-shell">
        <?php include __DIR__ . '/../partials/header.php'; ?>

        <main>
            <section class="hero hero-compact wedding-registry-hero" aria-labelledby="wedding-registry-title">
                <p class="eyebrow">Registry desk</p>
                <h1 id="wedding-registry-title">Start your Amazon, Target, and Zola wedding registries in one go.</h1>
                <p class="lede">Save your details once, open all three official signup pages together, and keep a checklist of each store's most-loved gifts while you add them.</p>
            </section>

            <section class="foundation wedding-registry-details" aria-labelledby="wedding-registry-details-title">
                <div class="section-heading">
                    <p class="eyebrow">Step 1</p>
                    <h2 id="wedding-registry-details-title">Your details</h2>
                </div>

                <div class="wedding-registry-disclosure" id="wedding-registry-disclosure">
                    <h3 class="wedding-registry-disclosure-title">How sign-up works</h3>
                    <p>Each registry account is created on the retailer's own site. Amazon, Target, and Zola do not accept signups prefilled by other sites, so nothing here registers you with them directly.</p>
                    <p>We save your details to your wowiekowie.com account so you can copy and paste them into each signup form, open every official signup page with one click, and keep track of which ones you have started. We never ask for your retailer passwords and never sign in to a retailer for you.</p>
                </div>

                <p class="wedding-registry-login" id="wedding-registry-login">
                    <a class="button" href="/login/?return_to=/wedding-registry/">Log in to sign up</a>
                    <span class="wedding-registry-login-note">You can browse the registries and products below without an account.</span>
                </p>

                <form class="wedding-registry-form" id="wedding-registry-form" action="/wedding-registry/" method="post" novalidate>
                    <fieldset class="wedding-registry-fieldset" id="wedding-registry-fieldset" aria-describedby="wedding-registry-disclosure" disabled>
                        <legend class="public-visually-hidden">Wedding details</legend>
                        <div class="wedding-registry-fields">
                            <div class="wedding-registry-field">
                                <label for="wedding-registry-partner-one">Partner one name</label>
                                <input id="wedding-registry-partner-one" name="partner_one_name" type="text" maxlength="120" autocomplete="name" required aria-describedby="wedding-registry-partner-one-error">
                                <p class="wedding-registry-field-error" id="wedding-registry-partner-one-error" data-field-error="partner_one_name" hidden></p>
                            </div>
                            <div class="wedding-registry-field">
                                <label for="wedding-registry-partner-two">Partner two name</label>
                                <input id="wedding-registry-partner-two" name="partner_two_name" type="text" maxlength="120" autocomplete="off" required aria-describedby="wedding-registry-partner-two-error">
                                <p class="wedding-registry-field-error" id="wedding-registry-partner-two-error" data-field-error="partner_two_name" hidden></p>
                            </div>
                            <div class="wedding-registry-field">
                                <label for="wedding-registry-date">Wedding date <span class="wedding-registry-optional">(optional)</span></label>
                                <input id="wedding-registry-date" name="wedding_date" type="date" aria-describedby="wedding-registry-date-error">
                                <p class="wedding-registry-field-error" id="wedding-registry-date-error" data-field-error="wedding_date" hidden></p>
                            </div>
                            <div class="wedding-registry-field">
                                <label for="wedding-registry-email">Contact email</label>
                                <input id="wedding-registry-email" name="contact_email" type="email" maxlength="254" autocomplete="email" required aria-describedby="wedding-registry-email-error">
                                <p class="wedding-registry-field-error" id="wedding-registry-email-error" data-field-error="contact_email" hidden></p>
                            </div>
                            <div class="wedding-registry-field wedding-registry-field-wide">
                                <label for="wedding-registry-address">Shipping address <span class="wedding-registry-optional">(optional)</span></label>
                                <textarea id="wedding-registry-address" name="shipping_address" rows="3" maxlength="500" autocomplete="street-address" aria-describedby="wedding-registry-address-error"></textarea>
                                <p class="wedding-registry-field-error" id="wedding-registry-address-error" data-field-error="shipping_address" hidden></p>
                            </div>
                        </div>

                        <div class="wedding-registry-actions">
                            <button class="button wedding-registry-primary" id="wedding-registry-signup-all" type="button">Sign up for all 3</button>
                            <button class="button" id="wedding-registry-save" type="submit">Save details</button>
                            <button class="button" id="wedding-registry-copy" type="button">Copy my details</button>
                            <button class="button" id="wedding-registry-enroll-all" type="button">Enroll in top products on all 3</button>
                        </div>
                    </fieldset>

                    <p id="wedding-registry-status" class="wedding-registry-status" role="status" aria-live="polite" aria-atomic="true">Loading the registries&hellip;</p>

                    <div class="wedding-registry-copy-fallback" id="wedding-registry-copy-fallback" hidden>
                        <label for="wedding-registry-copy-text">Your saved details</label>
                        <textarea id="wedding-registry-copy-text" rows="6" readonly></textarea>
                    </div>
                </form>
            </section>

            <section class="foundation wedding-registry-library" aria-labelledby="wedding-registry-list-title">
                <div class="section-heading">
                    <p class="eyebrow">Step 2</p>
                    <h2 id="wedding-registry-list-title">Your three registries</h2>
                    <p>Open each official signup page, then tick the top products you want and add them on the retailer's site.</p>
                </div>

                <div id="wedding-registry-registries" class="wedding-registry-grid" aria-busy="true">
                    <p class="wedding-registry-placeholder">Loading Amazon, Target, and Zola&hellip;</p>
                </div>
            </section>
        </main>

        <?php include __DIR__ . '/../partials/footer.php'; ?>
    </div>

    <script type="module" src="/assets/js/wedding-registry.js?v=<?= filemtime(dirname(__DIR__) . '/assets/js/wedding-registry.js') ?>"></script>
</body>
</html>
