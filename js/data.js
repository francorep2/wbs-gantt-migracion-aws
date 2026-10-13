/*
 * Datos iniciales del proyecto "Migración a AWS - Mercado Hogar S.R.L."
 *
 * - La estructura (fases y paquetes) sale de la WBS del Equipo 04.
 * - Los tiempos se alinean con las fases e hitos del Anexo I / Project Charter
 *   (26 semanas: hitos en semanas 3, 6, 10, 15, 20, 23, 24 y 26).
 * - `start` es el día de inicio relativo al comienzo del proyecto (día 0 = lunes de la semana 1).
 * - `duration` está en días corridos.
 * - `deps` son dependencias Fin-Comienzo (FC) hacia otros códigos.
 * - `loe: true` marca tareas de nivel de esfuerzo (duran todo el proyecto, no entran en la ruta crítica).
 */
const W = (week, day = 0) => (week - 1) * 7 + day; // semana (1..26) + día dentro de la semana (0 = lunes)

window.DEFAULT_PROJECT = {
  name: "Migración a AWS - Mercado Hogar S.R.L.",
  startDate: "2026-09-14",
  phases: [
    {
      code: "1", name: "Iniciación & Relevamiento", color: "#3b82f6",
      tasks: [
        { code: "1.1", name: "Kick-off y roles", start: W(1), duration: 7, deps: [] },
        { code: "1.2", name: "Relevamiento infraestructura on-premise", start: W(2), duration: 14, deps: ["1.1"] },
        { code: "1.3", name: "Análisis PostgreSQL", start: W(2), duration: 14, deps: ["1.1"] },
        { code: "1.4", name: "Inventario aplicaciones", start: W(2), duration: 7, deps: ["1.1"] },
        { code: "1.5", name: "Mapeo dependencias", start: W(3), duration: 7, deps: ["1.4"] },
        { code: "1.6", name: "Documentación", start: W(3), duration: 7, deps: ["1.4"] },
      ],
    },
    {
      code: "2", name: "Diseño Arquitectura AWS", color: "#8b5cf6",
      tasks: [
        { code: "2.1", name: "Diseño VPC y seguridad", start: W(4), duration: 14, deps: ["1.2", "1.6"] },
        { code: "2.2", name: "Diseño RDS PostgreSQL", start: W(4), duration: 14, deps: ["1.3"] },
        { code: "2.3", name: "Estrategia migración", start: W(4), duration: 14, deps: ["1.5"] },
        { code: "2.4", name: "Dimensionamiento EC2", start: W(4), duration: 7, deps: ["1.2", "1.4"] },
        { code: "2.5", name: "Diseño S3", start: W(5), duration: 7, deps: ["1.6"] },
        { code: "2.6", name: "Documentación arquitectura", start: W(6), duration: 7, deps: ["2.1", "2.2", "2.3", "2.4", "2.5"] },
      ],
    },
    {
      code: "3", name: "Preparación Entorno Cloud", color: "#06b6d4",
      tasks: [
        { code: "3.1", name: "Creación cuenta AWS", start: W(7), duration: 3, deps: ["2.6"] },
        { code: "3.2", name: "VPC, subnets, Security Groups", start: W(7, 3), duration: 7, deps: ["3.1"] },
        { code: "3.3", name: "Provisión RDS PostgreSQL", start: W(8, 3), duration: 7, deps: ["3.2"] },
        { code: "3.4", name: "Buckets S3", start: W(8, 3), duration: 4, deps: ["3.2"] },
        { code: "3.5", name: "IAM y roles", start: W(7, 3), duration: 7, deps: ["3.1"] },
        { code: "3.6", name: "CloudWatch y alertas", start: W(9, 3), duration: 7, deps: ["3.3"] },
        { code: "3.7", name: "Pruebas conectividad", start: W(9, 3), duration: 11, deps: ["3.3", "3.4", "3.5"] },
      ],
    },
    {
      code: "4", name: "Migración Datos & Apps", color: "#f59e0b",
      tasks: [
        { code: "4.1", name: "Migración PostgreSQL (piloto)", start: W(11), duration: 14, deps: ["3.7"] },
        { code: "4.2", name: "Full load 850 GB", start: W(13), duration: 7, deps: ["4.1"] },
        { code: "4.3", name: "Sincronización incremental", start: W(14), duration: 49, deps: ["4.2"] },
        { code: "4.4", name: "Validación integridad", start: W(14), duration: 14, deps: ["4.2"] },
        { code: "4.5", name: "Migración ERP a EC2", start: W(16), duration: 21, deps: ["4.4"] },
        { code: "4.6", name: "Migración e-commerce", start: W(16), duration: 35, deps: ["4.4"] },
        { code: "4.7", name: "Migración POS", start: W(18), duration: 14, deps: ["4.4"] },
        { code: "4.8", name: "Migración archivos a S3", start: W(16), duration: 21, deps: ["4.4"] },
      ],
    },
    {
      code: "5", name: "Pruebas & Validación", color: "#10b981",
      tasks: [
        { code: "5.1", name: "Pruebas funcionales", start: W(21), duration: 7, deps: ["4.5", "4.6", "4.7", "4.8"] },
        { code: "5.2", name: "Pruebas rendimiento", start: W(21), duration: 7, deps: ["4.5", "4.6", "4.7"] },
        { code: "5.3", name: "Pruebas seguridad", start: W(22), duration: 5, deps: ["5.1"] },
        { code: "5.4", name: "Pruebas Disaster Recovery", start: W(22), duration: 7, deps: ["5.1"] },
        { code: "5.5", name: "UAT usuarios", start: W(23), duration: 7, deps: ["5.3", "5.4"] },
      ],
    },
    {
      code: "6", name: "Cutover & Producción", color: "#ef4444",
      tasks: [
        { code: "6.1", name: "Plan cutover", start: W(22), duration: 14, deps: ["5.1"] },
        { code: "6.2", name: "Ventana mantenimiento", start: W(24), duration: 4, deps: ["6.1", "5.5"] },
        { code: "6.3", name: "Sincronización final", start: W(24, 4), duration: 1, deps: ["6.2", "4.3"] },
        { code: "6.4", name: "Cambio DNS", start: W(24, 5), duration: 1, deps: ["6.3"] },
        { code: "6.5", name: "Validación producción", start: W(24, 5), duration: 1, deps: ["6.3"] },
        { code: "6.6", name: "Monitoreo", start: W(24, 6), duration: 1, deps: ["6.4", "6.5"] },
      ],
    },
    {
      code: "7", name: "Estabilización & Optimización", color: "#14b8a6",
      tasks: [
        { code: "7.1", name: "Soporte post-cutover", start: W(25), duration: 14, deps: ["6.6"] },
        { code: "7.2", name: "Help desk usuarios", start: W(25), duration: 14, deps: ["6.6"] },
        { code: "7.3", name: "Monitoreo 24/7", start: W(25), duration: 14, deps: ["6.6"] },
        { code: "7.4", name: "Optimización costos", start: W(26), duration: 5, deps: ["6.6"] },
        { code: "7.5", name: "Desmantelamiento on-premise", start: W(26, 2), duration: 5, deps: ["7.6"] },
        { code: "7.6", name: "Backup final", start: W(26), duration: 2, deps: ["6.6"] },
      ],
    },
    {
      code: "8", name: "Capacitación & Documentación", color: "#ec4899",
      tasks: [
        { code: "8.1", name: "Capacitación IT", start: W(22), duration: 5, deps: ["4.5"] },
        { code: "8.2", name: "Capacitación usuarios", start: W(23), duration: 5, deps: ["8.1"] },
        { code: "8.3", name: "Documentación técnica", start: W(21), duration: 21, deps: ["4.8"] },
        { code: "8.4", name: "Procedimientos backup", start: W(23), duration: 5, deps: ["5.4"] },
        { code: "8.5", name: "Lecciones aprendidas", start: W(26), duration: 7, deps: ["6.6"] },
      ],
    },
    {
      code: "9", name: "Dirección de Proyectos", color: "#64748b",
      tasks: [
        { code: "9.1", name: "Gestión de la Ingeniería de Sistemas", start: W(1), duration: 182, deps: [], loe: true },
        { code: "9.2", name: "Apoyar actividades del PM", start: W(1), duration: 182, deps: [], loe: true },
      ],
    },
  ],
  // Hitos del Project Charter (día = fin de la semana indicada)
  milestones: [
    { id: "H1", name: "Relevamiento finalizado", day: W(3, 7) },
    { id: "H2", name: "Arquitectura AWS aprobada", day: W(6, 7) },
    { id: "H3", name: "Entorno cloud preparado", day: W(10, 7) },
    { id: "H4", name: "Migración piloto validada", day: W(15, 7) },
    { id: "H5", name: "Migración de apps y datos finalizada", day: W(20, 7) },
    { id: "H6", name: "Pruebas y capacitación", day: W(23, 7) },
    { id: "H7", name: "Puesta en producción", day: W(24, 7) },
    { id: "H8", name: "Cierre", day: W(26, 7) },
  ],
};
