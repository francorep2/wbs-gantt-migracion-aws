# WBS y Gantt · Migración a AWS - Mercado Hogar S.R.L.

Página web interactiva (HTML + CSS + JavaScript puro, sin dependencias) con la **WBS** del proyecto del Equipo 04 (Dirección de Proyectos) y su **diagrama de Gantt**.

## Cómo usarlo

Abrí `index.html` en el navegador (doble clic alcanza, no necesita servidor).

### Vista WBS
- Organigrama con las 9 fases y sus 51 paquetes de trabajo.
- Clic en una fase: contraer/expandir. Doble clic: renombrar.
- Clic en un paquete: editar nombre, fechas, duración, avance, responsable, predecesoras y notas.
- `+ paquete` agrega una tarea a la fase; `+ Fase` agrega una fase nueva.
- Buscador para resaltar paquetes.

### Vista Gantt
- Escala por días, semanas o meses.
- Arrastrar una barra la mueve; arrastrar su borde derecho cambia la duración.
- Con "Mover sucesoras" activado, las tareas que dependen de la movida se empujan solas.
- Flechas de dependencias Fin-Comienzo, **ruta crítica** (holgura 0), hitos del Project Charter y línea de "hoy".
- Se marcan en rojo punteado las dependencias que no se respetan.
- Fecha de inicio del proyecto editable (todas las fechas se recalculan).

### Menú Archivo
- **PDF con colores** (hoja A3 apaisada, dibujado vectorial):
  - *WBS y Gantt*: una hoja con la WBS y otra con el Gantt.
  - *Informe detallado*: resumen (indicadores, fases, hitos, ruta crítica y supuestos), WBS con fechas, Gantt con ruta crítica, dependencias y línea de hoy, y diccionario de la WBS.
- **MS Project (.xml)**: se abre desde Project con *Archivo > Abrir* eligiendo el tipo "Formato XML".
  - *WBS y Gantt*: fases como tareas resumen, paquetes con fechas y duraciones, e hitos.
  - *Detallado*: además predecesoras, % de avance, responsables como recursos, notas con la holgura y campos personalizados "Fase" (Texto1) y "Ruta crítica" (Texto2).
  - El formato XML de Project no guarda colores de barras: para colorear por fase usá *Formato > Estilos de barra* o agrupá por el campo "Fase".
- Exportar / importar JSON (para compartir el cronograma con el equipo).
- Exportar CSV (abre en Excel; separador `;`).
- Imprimir / guardar como PDF la vista actual.
- Restaurar los datos originales.

Los cambios se guardan automáticamente en el navegador (localStorage).

## Estructura

```
index.html        Página
css/styles.css    Estilos (tema claro/oscuro, responsive, impresión)
js/data.js        Datos iniciales: WBS, duraciones, dependencias e hitos
js/export.js      Exportación a PDF (jsPDF) y MS Project (XML)
js/vendor/        jsPDF 2.5.1 (para que funcione sin internet)
js/app.js         Lógica: render WBS, Gantt, arrastre, ruta crítica, import/export
CONTEXTO.md       Contexto, decisiones y bitácora del proyecto
```

Para cambiar los datos "de fábrica" editá `js/data.js`.
