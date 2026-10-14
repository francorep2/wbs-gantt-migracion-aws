# WBS y Gantt · Migración a AWS - Mercado Hogar S.R.L.

Página web interactiva (HTML + CSS + JavaScript puro, sin dependencias) con la **WBS** del proyecto del Equipo 04 (Dirección de Proyectos) y su **diagrama de Gantt**.

## Cómo levantarlo en local

No hay nada que instalar ni compilar: es una página estática.

### Opción rápida
Abrí `index.html` con doble clic. Funciona todo, incluso las exportaciones.

### Con servidor local (recomendado para probar)
Así se comporta igual que publicada y no hay problemas con permisos de archivos locales.

1. Cloná el repo y entrá a la carpeta:
   ```bash
   git clone https://github.com/francorep2/wbs-gantt-migracion-aws.git
   cd wbs-gantt-migracion-aws
   ```
2. Levantá un servidor estático en la raíz del repo. Cualquiera de estas opciones sirve:
   ```bash
   python -m http.server 8000      # con Python 3 (en algunos sistemas: python3)
   npx serve -l 8000               # con Node.js
   ```
3. Abrí <http://localhost:8000> en el navegador.
4. Para cortarlo, `Ctrl + C` en la terminal.

Si el puerto 8000 está ocupado, usá otro (por ejemplo `8080`) y abrí esa dirección.

### Si no ves los cambios
- **Archivos viejos en caché**: recargá con `Ctrl + F5` (en Mac, `Cmd + Shift + R`).
- **Datos viejos guardados en el navegador**: los datos se guardan en el navegador (localStorage). Para volver a los datos del repo, usá *Archivo → Restaurar datos originales*.

## Cómo usarlo

### Vista WBS
- Organigrama con las 9 fases y sus 67 paquetes de trabajo, cada uno con su responsable (rol) y la descripción del entregable.
- Clic en una fase: contraer/expandir. Doble clic: renombrar.
- Clic en un paquete: editar nombre, fechas, duración, avance, responsable, predecesoras y notas.
- `+ paquete` agrega una tarea a la fase; `+ Fase` agrega una fase nueva.
- Buscador para resaltar paquetes.

### Vista Gantt
- Escala por días, semanas o meses.
- Arrastrar una barra la mueve; arrastrar su borde derecho cambia la duración.
- Con "Mover sucesoras" activado, las tareas que dependen de la movida se empujan solas.
- **Ruta crítica** (holgura 0) marcada con un subrayado rojo en cada barra, hitos del Project Charter y línea de "hoy".
- Las flechas de dependencias Fin-Comienzo vienen apagadas para no recargar el gráfico; se prenden con "Dependencias".
- Los hitos se ven en una sola fila; clic en "Hitos del Project Charter" los despliega uno por fila con su fecha.
- Se marcan en rojo punteado las dependencias que no se respetan.
- Fecha de inicio del proyecto editable (todas las fechas se recalculan).

### Resumen
Debajo del título: semanas, fechas de inicio y fin, cantidad de paquetes, paquetes críticos y avance ponderado.

### Exportar (botón azul)
Abre un panel para elegir qué sale en el archivo:
- **Formato**: PDF con colores, MS Project (.xml) o draw.io (.drawio).
- **Partir de**: *WBS y Gantt* (lo básico), *Detallado* (todo) o *Vaciar*; después se ajusta a mano.
- **Qué incluir (PDF)**: secciones Resumen, WBS, Gantt y Diccionario de la WBS, cada una con sus opciones (columnas, dependencias, ruta crítica, hitos, línea de hoy, leyenda, fechas en la WBS, etc.).
- **Qué incluir (MS Project)**: dependencias, % de avance, responsables como recursos, notas con holgura, hitos y campos personalizados "Fase" (Texto1) y "Ruta crítica" (Texto2).
- **Qué incluir (draw.io)**: hoja WBS (organigrama, con o sin fechas) y hoja Gantt (tabla + barras por semana), dependencias como conectores, ruta crítica en rojo e hitos. Todo sale como formas editables con el color de cada fase.
- **Fases y paquetes**: se destilda cualquier fase o paquete para dejarlo afuera.
- **Hoja** A3 o A4 apaisada y **nombre del archivo**.

La selección queda guardada en el navegador para la próxima vez.

El `.drawio` se abre en [app.diagrams.net](https://app.diagrams.net) o en draw.io de escritorio con *Archivo > Abrir*; cada hoja es una página del diagrama.

El XML de MS Project se abre desde Project con *Archivo > Abrir* eligiendo "Formato XML". No guarda colores de barras: para colorear por fase usá *Formato > Estilos de barra* o agrupá por el campo "Fase".

### Menú Archivo
- Exportar / importar JSON (para compartir el cronograma con el equipo).
- Exportar CSV (abre en Excel; separador `;`).
- Imprimir la vista actual.
- Restaurar los datos originales.

Los cambios se guardan automáticamente en el navegador (localStorage).

## Estructura

```
index.html        Página
css/styles.css    Estilos (tema claro/oscuro, responsive, impresión)
js/data.js        Datos iniciales: WBS, duraciones, dependencias e hitos
js/export.js      Exportación a PDF (jsPDF), MS Project (XML) y draw.io
js/vendor/        jsPDF 2.5.1 (para que funcione sin internet)
js/app.js         Lógica: render WBS, Gantt, arrastre, ruta crítica, import/export
CONTEXTO.md       Contexto, decisiones y bitácora del proyecto
```

Para cambiar los datos "de fábrica" editá `js/data.js`. Si cambiás la estructura, subí la versión de `STORAGE_KEY` en `app.js` para que los navegadores no sigan mostrando la copia vieja guardada.

