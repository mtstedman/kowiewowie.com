# wowiekowie.com

A small, dependency-free PHP starter for wowiekowie.com.

## Local development

```bash
php -S 127.0.0.1:8080 -t htdocs htdocs/index.php
```

Open <http://127.0.0.1:8080>. The health endpoint is available at
<http://127.0.0.1:8080/health>.

Run the API locally from another terminal:

```bash
php -S 127.0.0.1:8081 -t api api/index.php
```

## Production

- Document root: `/var/www/wowiekowie.com/htdocs`
- API document root: `/var/www/wowiekowie.com/api`
- Web server: Nginx
- Runtime: PHP-FPM
- Nginx source configs: `deploy/nginx/*.conf`

TLS is issued and renewed with Certbot after the domain's DNS records point to
the production server.

## Automatic deployment

This checkout uses the versioned `.githooks/post-commit` hook. Every successful
local commit deploys the exact committed `htdocs/` and `api/` trees to their
production document roots. Run a deployment manually with:

```bash
./deploy/deploy.sh
```
