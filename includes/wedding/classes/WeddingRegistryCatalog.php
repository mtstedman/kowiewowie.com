<?php

declare(strict_types=1);

namespace Wowie\Api\Wedding;

/**
 * Curated, static catalog of the three supported wedding registries and a short list of popular
 * products for each. None of these retailers offers a signup or add-to-registry API, so the site
 * only links out: the couple creates each registry on the retailer's own signup page and adds the
 * picked products there.
 *
 * Sources (researched 2026-10):
 * - Amazon: signup entry https://www.amazon.com/wedding/home; products are Amazon's most-registered
 *   gifts as reported by TODAY (2017-06-14, https://www.today.com/today/amp/tdna111255).
 *   NOTE: these Amazon ASIN URLs are unverified (the list dates from 2017 and the ASINs were not
 *   checked live); they are kept exactly as given in that source.
 * - Target: signup https://www.target.com/gift-registry/create-wedding-registry; products from
 *   Target's official "Top Wedding Registry Gifts for Your Kitchen" page
 *   (https://www.target.com/c/top-kitchen-registry-gift-ideas/-/N-8s116).
 * - Zola: signup https://www.zola.com/onboard/new; products from the "Most-loved wedding registry
 *   gifts" section of https://www.zola.com/wedding-registry.
 */
final class WeddingRegistryCatalog
{
    public const KEYS = ['amazon', 'target', 'zola'];

    private const REGISTRIES = [
        'amazon' => [
            'key' => 'amazon',
            'name' => 'Amazon',
            'tagline' => 'Register for products sold on Amazon, from small kitchen tools to large appliances.',
            'signup_url' => 'https://www.amazon.com/wedding/home',
            'signup_help' => 'Amazon does not accept signups prefilled by other sites. Sign in to Amazon, open Account & Lists > Registry & Gifting > Create a registry, choose "I\'m getting married", and enter the names, wedding date and address you saved here.',
            'add_product_help' => 'Open each product on Amazon and use the "Add to registry" control (the "Add to Registry & Gifting" menu) on the product page. Amazon no longer supports adding items from other stores.',
            'products' => [
                ['key' => 'kitchenaid-hand-mixer', 'name' => 'KitchenAid Hand Mixer', 'brand' => 'KitchenAid', 'category' => 'Small appliances', 'url' => 'https://www.amazon.com/dp/B009VUHLHA'],
                ['key' => 'instant-pot-6-qt', 'name' => 'Instant Pot 6 Qt Multi-Use Pressure Cooker', 'brand' => 'Instant Pot', 'category' => 'Small appliances', 'url' => 'https://www.amazon.com/dp/B00FLYWNYQ'],
                ['key' => 'cuisinart-knife-set', 'name' => 'Cuisinart Knife Set', 'brand' => 'Cuisinart', 'category' => 'Cutlery', 'url' => 'https://www.amazon.com/dp/B00GIBKC3K'],
                ['key' => 'lodge-cast-iron-skillet', 'name' => 'Lodge Cast Iron Skillet', 'brand' => 'Lodge', 'category' => 'Cookware', 'url' => 'https://www.amazon.com/dp/B00006JSUA'],
                ['key' => 'hamilton-beach-food-processor', 'name' => 'Hamilton Beach Food Processor', 'brand' => 'Hamilton Beach', 'category' => 'Small appliances', 'url' => 'https://www.amazon.com/dp/B008J8MJIQ'],
                ['key' => 'oxo-mixing-bowls', 'name' => 'OXO Good Grips Mixing Bowls', 'brand' => 'OXO', 'category' => 'Kitchen tools', 'url' => 'https://www.amazon.com/dp/B002BFQR3G'],
                ['key' => 'pyrex-measuring-cups', 'name' => 'Pyrex Glass Measuring Cups', 'brand' => 'Pyrex', 'category' => 'Kitchen tools', 'url' => 'https://www.amazon.com/dp/B00M2J7PCI'],
                ['key' => 'nutribullet-blender', 'name' => 'NutriBullet Personal Blender', 'brand' => 'NutriBullet', 'category' => 'Small appliances', 'url' => 'https://www.amazon.com/dp/B007TIE0GQ'],
            ],
        ],
        'target' => [
            'key' => 'target',
            'name' => 'Target',
            'tagline' => 'Register for home and kitchen essentials at Target, online, in the app or in store.',
            'signup_url' => 'https://www.target.com/gift-registry/create-wedding-registry',
            'signup_help' => 'Target does not accept signups prefilled by other sites. Sign in to your Target account, create a wedding registry from Registry & Wish List, and enter the names, wedding date and address you saved here.',
            'add_product_help' => 'Open each product on Target.com or in the Target app and use the "Add to registry" control next to the item. Target does not support adding items from other websites.',
            'products' => [
                ['key' => 'kitchenaid-5-qt-stand-mixer', 'name' => 'KitchenAid 5qt 10-Speed Stand Mixer with Copper Bowl - Hearth & Hand with Magnolia', 'brand' => 'KitchenAid', 'category' => 'Small appliances', 'url' => 'https://www.target.com/p/kitchenaid-5qt-10-speed-stand-mixer-with-copper-bowl-french-linen-hearth-38-hand-8482-with-magnolia/-/A-90064793'],
                ['key' => 'ninja-foodi-dualzone-air-fryer', 'name' => 'Ninja Foodi 8qt DualZone 2-Basket Air Fryer DZ201', 'brand' => 'Ninja', 'category' => 'Small appliances', 'url' => 'https://www.target.com/p/ninja-foodi-8qt-original-dualzone-2-basket-air-fryer-with-6-functions-dz201/-/A-79991380'],
                ['key' => 'breville-smart-oven-air-fryer-pro', 'name' => 'Breville Smart Oven Air Fryer Pro', 'brand' => 'Breville', 'category' => 'Small appliances', 'url' => 'https://www.target.com/p/breville-smart-oven-air-fryer-pro/-/A-90673373'],
                ['key' => 'nespresso-vertuo-pop-plus', 'name' => 'Nespresso Vertuo Pop+ Coffee Maker and Espresso Machine', 'brand' => 'Nespresso', 'category' => 'Coffee & espresso', 'url' => 'https://www.target.com/p/nespresso-vertuo-pop-coffee-maker-and-espresso-machine/-/A-89259414'],
                ['key' => 'ge-profile-opal-nugget-ice-maker', 'name' => 'GE Profile Opal Nugget Ice Maker - Hearth & Hand with Magnolia', 'brand' => 'GE Profile', 'category' => 'Small appliances', 'url' => 'https://www.target.com/p/ge-profile-opal-nugget-ice-maker-hearth-38-hand-8482-with-magnolia/-/A-92318499'],
                ['key' => 'breville-barista-express', 'name' => 'Breville Barista Express Espresso Machine BES870XL', 'brand' => 'Breville', 'category' => 'Coffee & espresso', 'url' => 'https://www.target.com/p/breville-stainless-steel-barista-express-espresso-machine-light-silver-bes870xl/-/A-88306830'],
                ['key' => 'crock-pot-6-qt-cook-and-carry', 'name' => 'Crock-Pot 6qt Cook & Carry Programmable Slow Cooker', 'brand' => 'Crock-Pot', 'category' => 'Small appliances', 'url' => 'https://www.target.com/p/crock-pot-6qt-cook-carry-programmable-slow-cooker/-/A-1013475678'],
                ['key' => 'ninja-luxe-cafe-premier', 'name' => 'Ninja Luxe Café Premier Series 3-in-1 Espresso, Coffee and Cold Brew Machine', 'brand' => 'Ninja', 'category' => 'Coffee & espresso', 'url' => 'https://www.target.com/p/ninja-luxe-caf-premier-series-3-in-1-espresso-coffee-and-cold-brew-machine/-/A-95006484'],
            ],
        ],
        'zola' => [
            'key' => 'zola',
            'name' => 'Zola',
            'tagline' => 'Register for gifts from the Zola shop and add items from other stores to one registry.',
            'signup_url' => 'https://www.zola.com/onboard/new',
            'signup_help' => 'Zola does not accept signups prefilled by other sites. Start your free registry on Zola and enter the names, wedding date and address you saved here.',
            'add_product_help' => 'Open each product in the Zola shop and add it to your registry. For items sold elsewhere, use Zola\'s "Add from another store" option (paste the product link) or the "Add to Zola" browser button.',
            'products' => [
                ['key' => 'lodge-logic-cast-iron-skillet', 'name' => 'Lodge Logic Cast Iron Skillet 10.25"', 'brand' => 'Lodge', 'category' => 'Cookware', 'url' => 'https://www.zola.com/shop/product/lodge_logic_cast_iron_skillet_10.25'],
                ['key' => 'mackenzie-childs-courtly-check-tea-kettle', 'name' => 'MacKenzie-Childs Courtly Check Tea Kettle', 'brand' => 'MacKenzie-Childs', 'category' => 'Kitchen', 'url' => 'https://www.zola.com/shop/product/mackenziechilds_courtly_check_tea_kettle_1'],
                ['key' => 'zwiesel-pure-sauvignon-blanc-glasses', 'name' => 'Zwiesel Pure Sauvignon Blanc Glasses, Set of 6', 'brand' => 'Zwiesel', 'category' => 'Glassware', 'url' => 'https://www.zola.com/shop/product/zwiesel_puresauvignonblanc6'],
                ['key' => 'miele-triflex-hx2-cordless-vacuum', 'name' => 'Miele Triflex HX2 Cordless Stick Vacuum', 'brand' => 'Miele', 'category' => 'Home care', 'url' => 'https://www.zola.com/shop/product/miele_triflex_hx2_cordless_stick_vacuum'],
                ['key' => 'rachael-ray-cucina-12-piece-cookware-set', 'name' => 'Rachael Ray Cucina 12-Piece Cookware Set, Agave Blue', 'brand' => 'Rachael Ray', 'category' => 'Cookware', 'url' => 'https://www.zola.com/shop/product/rachaelray_cucina_12piece_cookwareset_agaveblue'],
                ['key' => 'all-clad-ha1-nonstick-sauce-pan', 'name' => 'All-Clad HA1 Expert Nonstick Sauce Pan with Lid', 'brand' => 'All-Clad', 'category' => 'Cookware', 'url' => 'https://www.zola.com/shop/product/allclad_ha1_expert_nonstick_sauce_pan_with_lid'],
                ['key' => 'sonos-move-2-speaker', 'name' => 'Sonos Move 2 Portable Wi-Fi and Bluetooth Speaker, White', 'brand' => 'Sonos', 'category' => 'Electronics', 'url' => 'https://www.zola.com/shop/product/sonos_move_2_portable_wifi_bluetooth_speaker_white'],
                ['key' => 'aura-carver-digital-photo-frame', 'name' => 'Aura Carver Digital Photo Frame, Gravel', 'brand' => 'Aura', 'category' => 'Home decor', 'url' => 'https://www.zola.com/shop/product/auraframes_carver_digital_photo_frame_gravel'],
            ],
        ],
    ];

    /**
     * Every registry in the fixed order amazon, target, zola.
     *
     * @return list<array{key: string, name: string, tagline: string, signup_url: string, signup_help: string, add_product_help: string, products: list<array{key: string, name: string, brand: string, category: string, url: string}>}>
     */
    public static function registries(): array
    {
        return array_map(static fn (string $key): array => self::REGISTRIES[$key], self::KEYS);
    }

    /** @return array<string, mixed>|null */
    public static function registry(string $key): ?array
    {
        return self::REGISTRIES[$key] ?? null;
    }

    /** @return array{key: string, name: string, brand: string, category: string, url: string}|null */
    public static function product(string $registryKey, string $productKey): ?array
    {
        foreach (self::REGISTRIES[$registryKey]['products'] ?? [] as $product) {
            if ($product['key'] === $productKey) {
                return $product;
            }
        }

        return null;
    }
}
