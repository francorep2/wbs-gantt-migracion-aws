# CONTEXTO · WBS y Gantt Migración AWS

> Leer este archivo primero al retomar el proyecto.

## Qué es
Trabajo práctico de la materia **Dirección de Proyectos** (2° cuatrimestre 2026, Equipo 04).
Caso: **Migración a AWS de Mercado Hogar S.R.L.** (PostgreSQL ~850 GB, ERP, e-commerce, POS y archivos).
Este repo contiene una página web interactiva con la WBS del equipo y un diagrama de Gantt editable.

## Fuentes usadas
- **WBS** (imagen `wbs.png` enviada por Franco): 9 fases y 51 paquetes de trabajo. En la revisión v2 (13/10) se completó a 67 paquetes con lo que pedían el Charter y el Anexo I.
- **Anexo I - Contexto Mercado Hogar**, sección 10: 26 semanas en 8 fases.
- **Project Charter del Equipo 04**: hitos en semanas 3, 6, 10, 15, 20, 23, 24 y 26.

## Decisiones tomadas
- **Tecnología**: HTML + CSS + JS puro, sin frameworks ni build, para que abra con doble clic.
- **Fecha de inicio por defecto**: lunes 14/09/2026 (el charter está fechado 07/09/2026). Se cambia desde la vista Gantt.
- **Unidad de tiempo**: días corridos; las duraciones por defecto son múltiplos de semana para encadenar sin huecos.
- **Mapeo de las fases de la WBS al Anexo** (el Anexo tiene 8 fases y la WBS 9, con otros cortes):

  | WBS | Semanas | Relación con el Anexo / Charter |
  |---|---|---|
| 2026-10-14 | Se quitó del repo `docs/informe-estado-tp.pdf` y `.html` a pedido de Franco (los informes del TP quedan fuera del repo). | `chore/quitar-informe` |
  | 1. Iniciación & Relevamiento | 1–3 | Fase 1 · Hito "Relevamiento finalizado" (S3) |
  | 2. Diseño Arquitectura AWS | 4–6 | Fase 2 · Hito "Arquitectura aprobada" (S6) |
  | 3. Preparación Entorno Cloud | 7–10 | Fase 3 · Hito "Entorno cloud preparado" (S10) |
  | 4. Migración Datos & Apps | 11–20 | Fases 4 y 5. 4.1–4.4 = piloto PostgreSQL (hito S15); 4.5–4.8 = apps (hito S20) |
  | 5. Pruebas & Validación | 21–23 | Fase 6 (pruebas integrales) |
  | 8. Capacitación & Documentación | 21–23 (+ 8.5 en S26) | Fase 6 (capacitación) · Hito S23 |
  | 6. Cutover & Producción | 22–24 | Fase 7 (puesta en producción, S24); 6.1 Plan cutover se arma en S22–23 |
  | 7. Estabilización & Optimización | 25–26 | Fase 8 · Hito "Cierre" (S26) |
  | 9. Dirección de Proyectos | 1–26 | Transversal, marcada como "nivel de esfuerzo" (no entra en la ruta crítica) |

- **Dependencias**: son una propuesta razonable (Fin-Comienzo) armada a partir de la lógica técnica; no venían en la WBS. Revisar con el equipo.
- **Sin `prompt()`/`confirm()` nativos**: se usan diálogos propios para que funcione también embebido (vista previa publicada en claude.ai, donde esos diálogos están bloqueados).
- **Vista previa online**: el repo es privado (GitHub Pages no aplica gratis), así que se publicó una versión de un solo archivo como Artifact de Claude: https://claude.ai/artifact/6buZvVwtLuF1NGsosveiEZ . Ahí no funcionan exportar e imprimir; esas opciones se ocultan con `window.EMBEDDED_VIEW`.
- **Ruta crítica**: se calcula sobre las fechas planificadas (holgura total = fin tardío − fin planificado).
- **Responsables**: `owner` usa los 11 perfiles del Anexo I (sección 8). Las notas de cada paquete describen el entregable y alimentan el diccionario de la WBS.
- **`STORAGE_KEY` v2**: al cambiar la WBS se subió la versión para que el navegador cargue los datos nuevos (los cambios guardados con la v1 no se migran).

- **Exportación PDF**: se dibuja con jsPDF (vectorial, A3 apaisado) en vez de capturar pantalla, para que salga nítido y con los colores de cada fase. jsPDF va copiado en `js/vendor/` para que ande sin internet; la versión publicada lo carga de cdnjs.
- **Exportación MS Project**: formato MSPDI (XML), con un calendario de 7 días laborables para respetar las duraciones en días corridos y restricción "No comenzar antes del" en cada paquete para conservar las fechas planificadas. El XML no admite colores de barras.
- **Exportación personalizada**: un panel con opciones por sección/columna y un árbol de fases y paquetes para excluir lo que no se quiera. Las opciones viven en `exp` (app.js) y se guardan en localStorage; `export.js` recibe un objeto de opciones en vez de un modo fijo. El filtrado de paquetes se hace en app.js antes de llamar al exportador; la ruta crítica se sigue calculando con el proyecto completo.
- **Exportación draw.io**: archivo `.drawio` (XML de mxGraph sin comprimir) con dos páginas, WBS y Gantt, armadas con formas sueltas (no imagen) para que se puedan editar. Las dependencias son conectores pegados a las barras, así que siguen a la barra si se la mueve.
- En la versión publicada en claude.ai las descargas usan la capacidad `downloads`, que no permite `.xml`: ahí los archivos de MS Project y draw.io se entregan dentro de un `.zip`.

- **Interfaz minimalista (13/10)**: el resumen pasó de 6 tarjetas a una línea bajo el título; la ruta crítica se marca con un subrayado rojo (antes borde rojo en casi todas las barras); las dependencias arrancan apagadas; los hitos ocupan una fila desplegable; se sacaron la columna "%" del Gantt, las barras de avance vacías de la WBS y las opciones de exportar repetidas en el menú Archivo. En el panel de exportación las opciones de una sección solo aparecen si la sección está tildada. La página ya no scrollea entera: scrollean la WBS y el Gantt, con la cabecera fija.
- **Red del cronograma cerrada (13/10)**: toda actividad tiene sucesora salvo el cierre (9.7). Se agregó 8.2 y 8.4 → 5.7 (el Go/No-Go del hito "Pruebas y capacitación" espera la capacitación) y 7.1–7.4 → 9.7. Los datos guardados en el navegador se ajustan solos (`migrate()` en app.js, sin perder ediciones).

## Pendientes / ideas
- Validar con el equipo duraciones y dependencias de detalle.
- Ya hay un responsable (rol) por paquete; falta armar la RACI completa (U07) y cargar el avance real.
- La ruta crítica abarca 51 de 67 paquetes (46 antes de cerrar la red) porque cada fase está ajustada a su hito sin colchón: evaluar una reserva de cronograma.
- Los informes de estado del TP no van en el repo (pedido de Franco, 14/10): se entregan aparte.
- Posible: dependencias de otros tipos (CC, FF), recursos y costos por tarea.

## Bitácora
| Fecha | Cambio | Rama / PR |
|---|---|---|
| 2026-10-13 | Limpieza de UX/UI (resumen en una línea, ruta crítica sutil, dependencias apagadas por defecto, hitos desplegables, panel de exportar más simple) y red del Gantt cerrada (8.2/8.4 → 5.7, 7.1–7.4 → 9.7). | `feature/ux-limpieza` |
| 2026-10-13 | WBS v2: 67 paquetes (staging, EC2, VPN, DMS, AWS Backup, aprobaciones de hitos, integración, rollback, transferencia operativa, fase 9 completa), responsables y descripción por paquete. Informe de estado del TP (quitado del repo el 14/10). | `feature/wbs-v2-informe` |
| 2026-10-13 | Exportar a draw.io (.drawio): páginas WBS y Gantt editables. Se oculta el selector de hoja fuera de PDF. | `feature/exportar-drawio` |
| 2026-10-13 | Panel de exportación personalizada: secciones, columnas, fases/paquetes, hoja A3/A4 y nombre de archivo. | `feature/exportacion-personalizada` |
| 2026-10-13 | Exportar a PDF (WBS y Gantt / informe detallado) y a MS Project XML (simple / detallado). | `feature/exportar-pdf-msproject` |
| 2026-10-13 | Versión inicial: WBS interactiva + Gantt (arrastre, ruta crítica, hitos, import/export JSON/CSV, impresión, tema oscuro). | `feature/wbs-gantt-inicial` |
