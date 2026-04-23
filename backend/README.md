# metric-planitar backend

Mini backend Express + Sequelize que reemplaza `app/api/cloud-state/route.ts`.

## Setup

```bash
cd backend
npm install
cp .env.example .env
npm run db:migrate
npm run dev
```

Por defecto usa **SQLite** en `./data/metric-planitar.sqlite` (zero-config).

## Migraciones

No se usa `sequelize.sync()` — el schema se maneja con `sequelize-cli`.

```bash
npm run db:migrate          # aplicar pendientes
npm run db:migrate:status   # ver cuáles van aplicadas
npm run db:migrate:undo     # rollback de la última
```

Para crear una nueva:

```bash
npx sequelize-cli migration:generate --name add-something
# editar el archivo recién creado en migrations/
npm run db:migrate
```

**Nunca editar** una migración ya aplicada en otros entornos — crear una nueva.

## Postgres (producción)

1. Instalar Postgres local o usar un servicio (Neon, Supabase, Railway, RDS).
2. Editar `.env`:
   ```
   DB_DIALECT=postgres
   DB_HOST=localhost
   DB_PORT=5432
   DB_NAME=metric_planitar
   DB_USER=postgres
   DB_PASSWORD=postgres
   ```
3. Crear la DB: `createdb metric_planitar` (o desde la UI del servicio).
4. `npm run db:migrate` — aplica el mismo schema pero con tipos nativos
   (`JSONB` en vez de `TEXT`, `ENUM` nativo).
5. `npm start`.

Los modelos detectan el dialecto automáticamente y eligen la columna correcta.

## Endpoints

- `GET  /health` → `{ ok: true }` (público)
- `GET  /cloud-state` → `{ configured, state }` (protegido)
- `POST /cloud-state` (body: `RemoteDashboardState` JSON, validado con zod) → `{ configured, state }` (protegido)
- `GET  /snapshots?limit=N&offset=M` → `{ total, limit, offset, items: [...] }` (protegido, paginado, `limit` máx 100)
- `GET  /snapshots/:id` → snapshot completo con `teams`, `weeklyRows`, `presetDistribution` (protegido, 404 si no existe)

Formato compatible con el frontend actual (`lib/store/remote-dashboard-state.ts`).

## Seguridad

### Auth (X-API-Key)
Si `API_KEY` está seteado en `.env`, toda request a `/cloud-state` debe mandar
`X-API-Key: <valor>`. Sin match → `401 Unauthorized`. `/health` permanece abierto.

Si `API_KEY` está vacío, el backend acepta todo pero loguea una advertencia —
**no desplegar así**.

Generar un key: `openssl rand -hex 32`

### Rate limit
60 requests por minuto por IP en `/cloud-state`. Ajustable en `src/server.js`.

### Validación de payload
`POST /cloud-state` valida el body con zod (`src/middleware/validate.js`) antes
de tocar la DB. Responde `400` con detalle en caso de mismatch.

### Errores
En `NODE_ENV=production` el middleware de errores no expone stacktraces —
devuelve `{ error: "Internal error" }` sin detalles.

## Conectar el frontend

En `.env.local` del proyecto Next:

```
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_API_KEY=<mismo valor que API_KEY del backend>
```

`lib/store/remote-dashboard-state.ts` lee ambos automáticamente y adjunta
`X-API-Key` a cada request. También acepta `localStorage["metric-planitar-api-key"]`
como override (útil si no quieres el key embebido en el bundle).

⚠️ `NEXT_PUBLIC_*` es visible en el bundle del cliente. Para un tool interno
con CORS restringido es aceptable; para público, migrar a login + JWT.

## Modelo (normalizado)

### Snapshot (histórico — append-only)
- `snapshots` — header + summary flattened + JSON blobs para `*ByPreset` y top leaders
- `snapshot_teams` — filas de `teams: TeamComparisonRow[]`
- `snapshot_weekly_rows` — filas de `weeklyRows: WeeklySummaryRow[]`
- `snapshot_preset_distribution` — filas de `presetDistribution`

Cada POST crea un nuevo `Snapshot`. `GET` devuelve el más reciente por `updatedAt`.

### Upload batches (replace-wholesale)
- `upload_batches(id, region, fileName, uploadedAt, rowCount)`
- `upload_rows(id, batchId, rowIndex, data JSON)` — una fila CSV por registro

Cada POST borra todos los batches y los recrea (mismas semánticas que el JSON blob original).

### Campos JSON
En Postgres/MySQL son `JSONB`/`JSON` nativos. En SQLite se serializan como `TEXT`
(manejado por el helper [src/models/\_jsonColumn.js](src/models/_jsonColumn.js)).

## Próximos pasos sugeridos

- Endpoint `GET /snapshots` y `GET /snapshots/:id` para explorar el histórico
- Auth (JWT) + multiusuario (añadir `userId` a Snapshot y UploadBatch)
- Índice compuesto `(region, uploadedAt)` para paginar batches
- Migrar a `sequelize-cli` con migraciones versionadas en vez de `sync()`
