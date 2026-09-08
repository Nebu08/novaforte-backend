# Seguridad — NOVAFORTE SAS Backend

Este documento describe los controles de seguridad implementados y las acciones manuales pendientes.

---

## Controles aplicados en código

| # | Control | Implementación |
|---|---|---|
| 2 | **Forzar HTTPS** | HSTS en `next.config.ts` (`max-age=63072000; includeSubDomains; preload`) |
| 3 | **`.env` fuera de Git** | `.gitignore` excluye `.env` en todos los módulos |
| 4 | **Sin claves hardcodeadas** | Todo via `process.env.*` |
| 6 | **Sin secretos en logs** | Logs verbosos desactivados cuando `NODE_ENV=production` |
| 7 | **Sin secretos en frontend** | Variables `NEXT_PUBLIC_*` no contienen secretos |
| 8 | **Debug desactivado en producción** | Stacks de error ocultos; `X-Powered-By` eliminado |
| 9 | **Rutas de prueba eliminadas** | `/api/test-mail` solo disponible en `NODE_ENV=development` |
| 10 | **CSP + Cabeceras** | `helmet()` en Express; `headers()` en `next.config.ts` con CSP, X-Frame-Options, noSniff, Referrer-Policy, Permissions-Policy |
| 11 | **CORS restringido** | Solo `novafortesas.com` en producción; previews de Vercel solo en dev |
| 12 | **Login seguro** | JWT HttpOnly cookie + bcrypt hash en chatbot |
| 13 | **Rate limiting** | 10 req/15min en `/api/quote` y `/api/contact`; 5 intentos/15min en `/login` |
| 14 | **Permisos validados en servidor** | `requireAuth` middleware en todas las rutas protegidas del chatbot |
| 15 | **Rutas protegidas por defecto** | `POST /api/models` requiere `X-Api-Key: MODELS_API_KEY` |
| 18 | **Validación y sanitización** | `validator.escape()` en todos los inputs antes de inyección en HTML de emails |
| 19 | **Sin SQL/NoSQL injection** | Supabase usa cliente tipado; no hay queries raw |

---

## Variables de entorno a agregar en Render (backend)

```
NODE_ENV=production
MODELS_API_KEY=<valor secreto generado con: openssl rand -hex 32>
```

## Variables de entorno a agregar en Render (chatbot)

```
WHATSAPP_APP_SECRET=<App Secret de tu Meta App>
```
Encuéntralo en: **Meta for Developers → Tu App → Settings → Basic → App Secret**

---

## Acciones manuales requeridas ⚠️

### 🔴 URGENTE — Rotar clave de Gmail expuesta (Punto 5)
El archivo `back/.env` contiene una App Password de Gmail (`huaewlxenljgjszu`) que estuvo en texto plano. Aunque `.gitignore` la excluye del repositorio, si alguna vez se subió accidentalmente, debe rotarse:

1. Ir a [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
2. Revocar la clave existente
3. Crear una nueva App Password
4. Actualizar `back/.env` y la variable en Render

### 🟡 Cloudflare delante (Punto 1)
1. Crear cuenta en [cloudflare.com](https://cloudflare.com)
2. Agregar el dominio `novafortesas.com`
3. Cambiar nameservers en tu registrador de dominio a los de Cloudflare
4. Activar SSL/TLS modo **Full (strict)**
5. Activar **Bot Fight Mode** y reglas de firewall básicas

### 🟡 RLS en Supabase (Punto 17)
1. Ir a Supabase → **Table Editor**
2. Para cada tabla: activar **Row Level Security**
3. Crear políticas que limiten acceso por usuario/rol

### 🟡 2FA en todas las plataformas (Punto 20)
Activar autenticación de dos factores en:
- [ ] Supabase (Settings → Account → MFA)
- [ ] Vercel (Account → Security)
- [ ] Render (Account → Security)
- [ ] GitHub (Settings → Security)
- [ ] Cloudflare (una vez configurado)
- [ ] Cuenta de Google asociada al proyecto

### 🟡 Backups automáticos (Punto 20)
- Supabase Plan gratuito incluye backups diarios de 7 días
- Para producción: activar Point-in-Time Recovery (plan Pro)

---

## Verificación post-deploy

Ejecutar estos checks tras el próximo deploy:

```bash
# Verificar headers de seguridad en producción
curl -I https://novafortesas.com | grep -E "Strict-Transport|X-Frame|Content-Security|X-Content"

# Verificar rate limiting (debe devolver 429 en el intento 11)
for i in {1..11}; do curl -s -o /dev/null -w "%{http_code}\n" -X POST https://novafortebackend.onrender.com/api/contact -H "Content-Type: application/json" -d '{"name":"test"}'; done
```
