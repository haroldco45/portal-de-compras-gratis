// queries.js — Seguimiento BRINSA (NUMPROVEE=8), por @mes y @numprovee.
// VENTA NETA = facturas (factura1/2_2000) − devoluciones (dev_fac1/2_2000).
// Regla validada peso-a-peso contra el informe G&G de Distrileco.
// Exclusiones fijas: vendedor 12 y nit 901410258-0. Join por referencia.
const { sql, getPool } = require('./db');

const UBIC = `ISNULL(NULLIF(LTRIM(RTRIM(k.ubicacion)),''),'SIN UBICACIÓN')`;

// Movimientos = facturas (venta +) UNION devoluciones (dev +, se restan luego).
// Mismos filtros a ambos lados. {H} = f1 (facturas) / d1 (devoluciones).
function ramaFactura() {
  return `
    SELECT
      ${UBIC}                                       AS ubicacion,
      LTRIM(RTRIM(f1.vendedor))                     AS vendedor,
      k.referencia                                  AS referencia,
      k.nombre_producto                             AS descripcion,
      f1.nit                                        AS nit,
      c.razon_social                                AS cliente,
      c.telefonos                                   AS telefono,
      c.ciudad                                      AS ciudad,
      f1.numero                                     AS numero,
      1                                             AS es_venta,
      CAST(f2.valor * f2.cantidad AS DECIMAL(18,2)) AS bruta,
      CAST(f2.cantidad AS DECIMAL(18,2))            AS bruta_unid,
      CAST(0 AS DECIMAL(18,2))                      AS dev,
      CAST(0 AS DECIMAL(18,2))                      AS dev_unid
    FROM factura1_2000 f1
      INNER JOIN factura2_2000 f2 ON f2.numero    = f1.numero
      INNER JOIN kardex        k  ON k.referencia = f2.referencia
      INNER JOIN clientes      c  ON c.nit        = f1.nit
    WHERE k.NUMPROVEE=@numprovee AND f1.mes=@mes AND f1.anulado=0
      AND c.activo=1 AND k.ACTIVO=1
      AND LTRIM(RTRIM(f1.vendedor)) <> '12'
      AND REPLACE(f1.nit,'-','') <> '9014102580'`;
}
function ramaDevolucion() {
  return `
    SELECT
      ${UBIC},
      LTRIM(RTRIM(d1.vendedor)),
      k.referencia,
      k.nombre_producto,
      d1.nit,
      c.razon_social,
      c.telefonos,
      c.ciudad,
      d1.numero,
      0,
      CAST(0 AS DECIMAL(18,2)),
      CAST(0 AS DECIMAL(18,2)),
      CAST(d2.valor * d2.cantidad AS DECIMAL(18,2)),
      CAST(d2.cantidad AS DECIMAL(18,2))
    FROM dev_fac1_2000 d1
      INNER JOIN dev_fac2_2000 d2 ON d2.numero    = d1.numero
      INNER JOIN kardex        k  ON k.referencia = d2.referencia
      INNER JOIN clientes      c  ON c.nit        = d1.nit
    WHERE k.NUMPROVEE=@numprovee AND d1.mes=@mes AND d1.anulado=0
      AND c.activo=1 AND k.ACTIVO=1
      AND LTRIM(RTRIM(d1.vendedor)) <> '12'
      AND REPLACE(d1.nit,'-','') <> '9014102580'`;
}
const MOV = `${ramaFactura()}
    UNION ALL${ramaDevolucion()}`;

function req(pool, mes, numprovee) {
  return pool.request()
    .input('mes', sql.VarChar(6), mes)
    .input('numprovee', sql.Int, numprovee);
}

// ── TOTAL GENERAL (brutas, devoluciones, netas) ─────────────
async function total(mes, numprovee) {
  const pool = await getPool();
  const r = await req(pool, mes, numprovee).query(`
    SET ARITHABORT ON;
    SELECT
      SUM(bruta)                        AS brutas,
      SUM(dev)                          AS devoluciones,
      SUM(bruta) - SUM(dev)             AS netas,
      SUM(bruta_unid) - SUM(dev_unid)   AS unidades,
      COUNT(DISTINCT nit)               AS clientes,
      COUNT(DISTINCT referencia)        AS productos,
      COUNT(DISTINCT ubicacion)         AS ubicaciones,
      COUNT(DISTINCT vendedor)          AS vendedores,
      COUNT(DISTINCT CASE WHEN es_venta=1 THEN numero END) AS facturas
    FROM ( ${MOV} ) m
    OPTION (RECOMPILE);`);
  return r.recordset;
}

// ── Por UBICACION (neto) ────────────────────────────────────
async function bloque2(mes, numprovee) {
  const pool = await getPool();
  const r = await req(pool, mes, numprovee).query(`
    SET ARITHABORT ON;
    SELECT
      ubicacion,
      COUNT(DISTINCT nit)               AS clientes,
      SUM(bruta_unid) - SUM(dev_unid)   AS unidades,
      SUM(bruta)                        AS brutas,
      SUM(dev)                          AS devoluciones,
      SUM(bruta) - SUM(dev)             AS volumen
    FROM ( ${MOV} ) m
    GROUP BY ubicacion
    ORDER BY volumen DESC
    OPTION (RECOMPILE);`);
  return r.recordset;
}

// ── Por VENDEDOR (brutas, devoluciones, netas, ticket) ──────
async function bloque1(mes, numprovee) {
  const pool = await getPool();
  const r = await req(pool, mes, numprovee).query(`
    SET ARITHABORT ON;
    SELECT
      vendedor,
      COUNT(DISTINCT nit)               AS clientes,
      COUNT(DISTINCT ubicacion)         AS ubicaciones,
      COUNT(DISTINCT referencia)        AS productos,
      COUNT(DISTINCT CASE WHEN es_venta=1 THEN numero END) AS facturas,
      SUM(bruta_unid) - SUM(dev_unid)   AS unidades,
      SUM(bruta)                        AS brutas,
      SUM(dev)                          AS devoluciones,
      SUM(bruta) - SUM(dev)             AS volumen,
      (SUM(bruta) - SUM(dev)) / NULLIF(COUNT(DISTINCT nit),0) AS ticket
    FROM ( ${MOV} ) m
    GROUP BY vendedor
    ORDER BY volumen DESC
    OPTION (RECOMPILE);`);
  return r.recordset;
}

// ── MATRIZ vendedor × ubicacion (neto) ──────────────────────
async function matriz(mes, numprovee) {
  const pool = await getPool();
  const r = await req(pool, mes, numprovee).query(`
    SET ARITHABORT ON;
    SELECT
      vendedor, ubicacion,
      SUM(bruta) - SUM(dev)             AS volumen,
      SUM(bruta_unid) - SUM(dev_unid)   AS unidades
    FROM ( ${MOV} ) m
    GROUP BY vendedor, ubicacion
    ORDER BY vendedor, volumen DESC
    OPTION (RECOMPILE);`);
  return r.recordset;
}

// ── PRODUCTOS (neto) ────────────────────────────────────────
async function productos(mes, numprovee) {
  const pool = await getPool();
  const r = await req(pool, mes, numprovee).query(`
    SET ARITHABORT ON;
    SELECT
      referencia,
      MAX(descripcion)                  AS descripcion,
      ubicacion, vendedor,
      SUM(bruta_unid) - SUM(dev_unid)   AS unidades,
      SUM(bruta) - SUM(dev)             AS volumen
    FROM ( ${MOV} ) m
    GROUP BY referencia, ubicacion, vendedor
    ORDER BY volumen DESC
    OPTION (RECOMPILE);`);
  return r.recordset;
}

// ── CLIENTES (neto, con teléfono) ───────────────────────────
async function clientes(mes, numprovee) {
  const pool = await getPool();
  const r = await req(pool, mes, numprovee).query(`
    SET ARITHABORT ON;
    SELECT
      nit, ubicacion, vendedor,
      MAX(cliente)                      AS cliente,
      MAX(telefono)                     AS telefono,
      MAX(ciudad)                       AS ciudad,
      SUM(bruta_unid) - SUM(dev_unid)   AS unidades,
      SUM(bruta) - SUM(dev)             AS volumen
    FROM ( ${MOV} ) m
    GROUP BY nit, ubicacion, vendedor
    ORDER BY volumen DESC
    OPTION (RECOMPILE);`);
  return r.recordset;
}

// ── Meses disponibles ───────────────────────────────────────
async function mesesDisponibles() {
  const pool = await getPool();
  const r = await pool.request().query(`
    SELECT DISTINCT f1.mes AS mes
    FROM factura1_2000 f1
    WHERE f1.anulado = 0 AND LEN(f1.mes) = 6
    ORDER BY f1.mes DESC
    OPTION (RECOMPILE);`);
  return r.recordset.map(x => x.mes);
}

module.exports = { total, bloque1, bloque2, matriz, productos, clientes, mesesDisponibles };
