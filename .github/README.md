# 🚀 GitHub Actions para GallOli

Este directorio contiene los workflows de GitHub Actions que automatizan el despliegue y construcción de GallOli.

## 📋 Workflows Disponibles

### 1. 🌐 Deploy (`deploy.yml`)
**Trigger:** Push a `main` o `master`
**Función:** Despliega automáticamente la aplicación web y el worker

**Acciones:**
- ✅ Instala dependencias Node.js
- ✅ Despliega a Cloudflare Pages (proyecto: `galloli`)
- ✅ Despliega Worker de sincronización
- ✅ Actualiza automáticamente la app en producción

### 2. 📱 Build Android (`build-android.yml`)
**Trigger:** Tags `v*` o manual
**Función:** Genera APK de Android usando Capacitor

**Acciones:**
- ✅ Configura entorno Android (Java 17, Android SDK)
- ✅ Instala Capacitor y dependencias
- ✅ Genera APK debug
- ✅ Crea release en GitHub con APK adjunto
- ✅ Sube artefacto para descarga

### 3. 🔍 CI (`ci.yml`)
**Trigger:** Push a cualquier branch
**Función:** Verificaciones de calidad y testing

**Acciones:**
- ✅ Valida sintaxis JavaScript
- ✅ Verifica estructura HTML
- ✅ Analiza tamaños de archivos
- ✅ Escaneo básico de seguridad
- ✅ Checks de rendimiento

### 4. 🏷️ Release (`release.yml`)
**Trigger:** Tags `v*`
**Función:** Crea releases formales en GitHub

**Acciones:**
- ✅ Extrae versión del tag
- ✅ Genera changelog automático
- ✅ Crea release con descripción completa
- ✅ Incluye links de descarga

## 🔐 Secrets Requeridos

Para que los workflows funcionen, configura estos secrets en:
`Settings > Secrets and variables > Actions`

| Secret | Descripción | Valor |
|--------|-------------|-------|
| `CLOUDFLARE_API_TOKEN` | Token de API de Cloudflare | `<configurado como secret de GitHub, NUNCA en texto plano>` |
| `CLOUDFLARE_ACCOUNT_ID` | ID de cuenta de Cloudflare | `ad83f16cea132210cff0f92fe179e628` |

## 🎯 Flujo de Trabajo Típico

### Desarrollo Normal
```bash
# 1. Hacer cambios en el código
git add .
git commit -m "feat: nueva funcionalidad"
git push origin main

# 2. GitHub Actions automáticamente:
#    - Ejecuta CI (tests, validaciones)
#    - Despliega a Cloudflare Pages
#    - Despliega Worker actualizado
#    - App disponible en https://galloli.pages.dev
```

### Crear Release con APK
```bash
# 1. Crear y pushear tag
git tag v1.2.3
git push origin v1.2.3

# 2. GitHub Actions automáticamente:
#    - Ejecuta build de Android
#    - Genera APK
#    - Crea release en GitHub
#    - APK disponible para descarga
```

## 📊 Estado de los Workflows

Puedes ver el estado de todos los workflows en:
[https://github.com/ivanbj96/galloli-app/actions](https://github.com/ivanbj96/galloli-app/actions)

### Badges de Estado
```markdown
![Deploy](https://github.com/ivanbj96/galloli-app/workflows/Deploy%20to%20Cloudflare%20Pages/badge.svg)
![CI](https://github.com/ivanbj96/galloli-app/workflows/Continuous%20Integration/badge.svg)
![Android Build](https://github.com/ivanbj96/galloli-app/workflows/Build%20Android%20APK/badge.svg)
```

## 🛠️ Configuración Local

Para probar localmente antes del deploy:

```bash
# Instalar dependencias
npm install

# Probar sintaxis (como CI)
find js -name "*.js" -exec node -c {} \;

# Deploy manual (requiere wrangler configurado)
wrangler pages deploy . --project-name=galloli --branch=main
cd workers && wrangler deploy
```

## 🔧 Troubleshooting

### ❌ Deploy falla
1. Verifica que los secrets estén configurados
2. Revisa logs en Actions tab
3. Confirma que wrangler.toml esté correcto

### ❌ APK build falla
1. Verifica que capacitor.config.ts esté presente
2. Revisa configuración de Java/Android en workflow
3. Confirma que package.json tenga dependencias correctas

### ❌ CI falla
1. Revisa errores de sintaxis en JavaScript
2. Confirma que todos los archivos estén presentes
3. Verifica estructura de archivos

## 📚 Recursos

- [GitHub Actions Docs](https://docs.github.com/en/actions)
- [Cloudflare Pages Actions](https://github.com/cloudflare/pages-action)
- [Capacitor Android Build](https://capacitorjs.com/docs/android)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)

---

**¿Problemas?** Abre un issue en el repositorio
**¿Mejoras?** ¡Pull requests bienvenidos!