# Humand — Informe de Control Horario (plantilla base)

Dashboard de control horario y fichas de tiempo que consume la API de **Humand**. Esta es la plantilla base: no contiene credenciales ni datos de ningún cliente. Úsala como punto de partida para armar el informe de una comunidad/cliente nueva.

## Qué hace

- Trae colaboradores, resúmenes diarios de asistencia y solicitudes de ausencia/vacaciones desde la API de Humand (rutas en `app/api/*`).
- Procesa esos datos en el cliente (`app/page.tsx`): entrada/salida 1 y 2, almuerzo, horas trabajadas, feriados, licencias y método de fichaje (APP, KIOSK, MANUAL, AUTO_CLOSE, INTEGRATION).
- Muestra una tabla filtrable por colaborador y rango de fechas.
- Exporta a Excel, CSV (`app/utils/export.ts`) y PDF con fichas horarias individuales (`app/utils/pdf.ts`).

## Cómo configurar un cliente nuevo

1. **Clona este repo** con el nombre del cliente, ej. `humand-informe-<cliente>`.
2. **Variables de entorno**: copia `.env.local.example` a `.env.local` y completa con las credenciales de Humand de ese cliente:
   ```
   HUMAND_API_BASE=
   HUMAND_API_KEY=
   ```
3. **Nombre del cliente**: busca y reemplaza el placeholder `[NOMBRE_CLIENTE]` en:
   - `app/layout.tsx` (título y descripción de la página)
   - `app/page.tsx` (encabezado del dashboard)
   - `app/utils/pdf.ts` (encabezado de la ficha horaria en PDF)
4. **Nombre del proyecto** (opcional): actualiza el campo `name` en `package.json`.
5. Instala dependencias y corre en local:
   ```bash
   npm install
   npm run dev
   ```
6. Cuando esté listo, despliega en Vercel como un proyecto nuevo y configura las mismas variables de entorno ahí (`HUMAND_API_BASE`, `HUMAND_API_KEY`).

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript
- Tailwind CSS 4
- `xlsx` para exportar Excel/CSV, `jspdf` + `jspdf-autotable` para PDF
- Desplegado en Vercel
