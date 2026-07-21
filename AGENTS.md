<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Proyecto: Informe de Control Horario (Humand)

Este es un **template por cliente**: cada comunidad/empresa que use Humand tiene su propio clon de este repo, con sus propias credenciales y su propio deploy en Vercel. No hay multi-tenant ni base de datos — todo el estado vive en la API de Humand del cliente.

## Setup inicial de un cliente nuevo

Antes de desarrollar, confirma que esto ya se hizo (si no, hazlo primero):

1. `.env.local` con `HUMAND_API_BASE` y `HUMAND_API_KEY` del cliente (pedirlas al cliente o a quien administre su cuenta Humand — nunca inventarlas ni reusar las de otro cliente).
2. Placeholder `[NOMBRE_CLIENTE]` reemplazado por el nombre real en: `app/layout.tsx`, `app/page.tsx`, `app/utils/pdf.ts`.
3. `name` en `package.json` actualizado (opcional, cosmético).

## Arquitectura

- **`app/page.tsx`** (client component): toda la lógica de negocio vive aquí — fetch orquestado, cálculo de entrada/salida/almuerzo/horas, filtros, tabla. Es intencionalmente un solo archivo grande; no lo fragmentes en componentes salvo que el usuario lo pida.
- **`app/api/*/route.ts`**: proxies delgados server-side hacia la API de Humand. Existen para no exponer `HUMAND_API_KEY` al navegador. No agregues lógica de negocio aquí — solo forwarding de params y manejo de errores.
- **`app/utils/export.ts`** / **`app/utils/pdf.ts`**: generación de Excel/CSV y PDF (fichas horarias), consumen `ProcessedRow[]` ya calculado por `page.tsx`.
- **`app/types.ts`**: tipos que reflejan el shape de las respuestas de Humand (`HumandUser`, `DaySummary`, `TimeEntry`) más el shape interno (`ProcessedRow`).

## Comportamientos deliberados (no "simplificar")

- Los empleados se piden en grupos de 25 (`GROUP_SIZE`) y las fechas en chunks de ≤31 días (`splitRange`), disparando todas las combinaciones en paralelo con `Promise.allSettled`. Esto existe porque la API de Humand tiene límites de tamaño de URL y de rango de fechas — no lo cambies a fetch secuencial ni a un solo request sin confirmar que el límite de Humand cambió.
- Paginación de Humand: `limit=50` es el tamaño de página que la API respeta de forma confiable (`PAGE_LIMIT` en `page.tsx`, mismo patrón en las rutas API). No subir el límite sin probarlo contra la API real.
- `AUTO_CLOSE` como `source` de un fichaje significa que Humand cerró automáticamente una jornada sin hora real — por eso se muestra como `00:00` y en rojo, en vez de una hora real.
- Las rutas de time-off y summaries degradan a lista vacía en caso de error (`catch(() => ({ requests: [] })` etc.) en vez de tirar la carga completa — es intencional para que un fallo parcial no rompa todo el informe.

## Desarrollo local

```bash
npm install
npm run dev        # http://localhost:3000, usa .env.local
```

No hay suite de tests. Para validar un cambio: correr `npm run dev`, consultar un rango de fechas real contra la cuenta de Humand del cliente y comparar horas/entradas contra lo que se ve en el panel de Humand.

## Deploy a Vercel

Cada cliente es un **proyecto de Vercel independiente**:

```bash
vercel link                 # o `vercel` la primera vez, crea/linkea el proyecto
vercel env add HUMAND_API_BASE production
vercel env add HUMAND_API_KEY production
# repetir para preview/development si se necesita
vercel --prod                # deploy manual
# o: conectar el repo de GitHub del cliente en el dashboard de Vercel para deploy automático en cada push a main
```

`vercel.json` ya define `maxDuration` extendido para `time-tracking` (60s) y `employees` (30s) porque agregan varias llamadas a Humand — no lo reduzcas sin motivo, esas rutas pueden tardar en cuentas con muchos colaboradores.
