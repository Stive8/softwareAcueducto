// scripts/import-gastos/clasificar.js
const { canonicalizarIdentificacion } = require('./terceros-canonicos');

// Quita acentos usando el rango unicode de diacríticos combinables (escape explícito para que
// no dependa de cómo se copie/pegue el archivo).
function sinAcentos(s) {
  return String(s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase();
}

function normalizarNombre(s) {
  return sinAcentos(s).replace(/\s+/g, ' ').trim();
}

// Quita espacios; si trae DV de NIT (NNNNNNNNN-N) lo quita; devuelve el número canonicalizado o
// null si no hay dígitos usables (ej. '__', vacío). No intenta extraer cédulas embebidas en texto.
function normalizarIdentificacion(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  const conDV = s.match(/^(\d{6,12})-\d$/); // NIT con dígito de verificación
  if (conDV) s = conDV[1];
  s = s.replace(/\s+/g, '');
  if (!/^\d{3,13}$/.test(s)) return null;
  return canonicalizarIdentificacion(s);
}

function esNombreValido(nombre) {
  const s = String(nombre || '');
  // Un número de factura/documento como "FEP 10632" o "1901 100207215" trae letras y/o dígitos
  // mezclados con un formato de código; un nombre real no lleva dígitos.
  if (/\d/.test(s)) return false;
  return /[A-Za-zÁÉÍÓÚÑáéíóúñ]{2,}/.test(s);
}

function proponerTipoIdentificacion(idNormalizada, nombre) {
  // Heurística simple: 9-10 dígitos con razón social de empresa suele ser NIT; si no, cédula.
  const n = normalizarNombre(nombre);
  const pareceEmpresa = /(SAS|S A S|LTDA|S\.A|SA\b|FERRETERIA|SUMINISTROS|INGECOM|COMERCIO|CIA|HIERROS|DISTRIBUIDORA)/.test(n);
  if (idNormalizada && idNormalizada.length >= 9 && pareceEmpresa) return 'NIT';
  return 'Cédula de Ciudadanía';
}

// Tabla ordenada de reglas: primera coincidencia gana. Las claves están sin acentos y en
// mayúsculas; el concepto se compara igual. confianza: 'alta' para reglas específicas, 'media'
// para las genéricas por vocabulario (materiales/labor).
const REGLAS_TIPO_GASTO = [
  { claves: ['FONTANERO'], tipo: 'Honorarios', confianza: 'alta' },
  { claves: ['COBRO DE CARTERA'], tipo: 'Honorarios', confianza: 'alta' },
  { claves: ['BONO'], tipo: 'Bonificaciones', confianza: 'alta' },
  { claves: ['HONORARIOS', 'ASESORIA', 'CONTADOR', 'DECLARACION DE RENTA', 'ESTUDIO AMBIENTAL', 'TRIBUTARIA'], tipo: 'Honorarios', confianza: 'alta' },
  { claves: ['TASA USO', 'CORTOLIMA', 'IMPUESTO', 'CAMARA DE COMERCIO'], tipo: 'Impuestos', confianza: 'alta' },
  { claves: ['REFRIGERIO', 'GASEOSA', 'AGUA BRISA', 'CAFE', 'BOLSAS DE AGUA', 'HIDRATACION', 'NOVENA'], tipo: 'Refrigerios', confianza: 'alta' },
  { claves: ['IMPRESORA', 'PORTATIL', 'MEMORIA DDR', 'EQUIPO DE COMPUTO', 'MOVIL LIBRE'], tipo: 'Equipo de Cómputo', confianza: 'alta' },
  { claves: ['RESMA', 'FOLDER', 'TALONARIO', 'COSEDORA', 'TINTA', 'PLOTER', 'PENDON', 'MULTICOPIAS'], tipo: 'Papelería', confianza: 'alta' },
  { claves: ['SILLA', 'MESA', 'MOBILIARIO', 'ARCHIVO COLGANTE'], tipo: 'Mobiliario y Equipo de Oficina', confianza: 'alta' },
  { claves: ['ENERGIA', 'ELECTRIC'], tipo: 'Energía Eléctrica', confianza: 'alta' },
  { claves: ['INTERNET'], tipo: 'Internet', confianza: 'alta' },
  { claves: ['TELEFON', 'PLAN DE DATOS'], tipo: 'Telefonía', confianza: 'alta' },
  { claves: ['TRANSPORTE', 'GASOLINA', 'VIAJE DE ARENA', 'ACARREO'], tipo: 'Transporte', confianza: 'alta' },
  { claves: ['ARRENDAMIENTO', 'ARRIENDO', 'ESCAVADORA', 'EXCAVACION', 'RETRO', 'MAQUINARIA'], tipo: 'Arrendamiento de Maquinaria', confianza: 'alta' },
  { claves: ['LIMPIEZA', 'DESINFECCION'], tipo: 'Limpieza y Desinfección', confianza: 'alta' },
  // Materiales de acueducto (genérico, confianza media)
  { claves: ['TUBO', 'TUBERIA', 'UNION', 'CODO', 'COLLAR', 'ADAPTADOR', 'REGISTRO', 'SOLDADURA', 'VALVULA', 'MANGUERA', 'PVC', 'CINTA TEFLON', 'LUBRICANTE', 'NIPLE', 'BUJE', 'SEMICODO', 'TEE', 'LLAVE'], tipo: 'Accesorios y Materiales', confianza: 'media' },
  // Mano de obra ocasional (genérico, confianza media) — evaluado después de materiales.
  { claves: ['HORAS', 'DIA DE', 'MANO DE OBRA', 'APOYO A', 'APOYO EN', 'JORNAL', 'OBRA', 'INSTALACION'], tipo: 'Mano de Obra Ocasional', confianza: 'media' },
];

function clasificarTipoGasto(concepto) {
  const c = sinAcentos(concepto);
  for (const regla of REGLAS_TIPO_GASTO) {
    if (regla.claves.some((k) => c.includes(k))) {
      return { tipoGasto: regla.tipo, confianza: regla.confianza };
    }
  }
  return { tipoGasto: null, confianza: 'media' };
}

function resolverTercero({ nombre, identificacion }, { terceros }) {
  const idNorm = normalizarIdentificacion(identificacion);
  if (idNorm) {
    const existente = terceros.find((t) => t.numero_identificacion === idNorm);
    if (existente) return { modo: 'existente', terceroId: existente.id };
    if (esNombreValido(nombre)) {
      return {
        modo: 'nuevo',
        tipoIdentificacion: proponerTipoIdentificacion(idNorm, nombre),
        numeroIdentificacion: idNorm,
        nombreRazonSocial: nombre,
      };
    }
    // Hay número pero el "nombre" no sirve (raro): mejor no inventar razón social.
    return { modo: 'no_informado', nombreOriginal: nombre };
  }

  // Sin identificación: intentar match por nombre contra el catálogo ya poblado.
  if (esNombreValido(nombre)) {
    const nn = normalizarNombre(nombre);
    const porNombre = terceros.find((t) => t.nombre_norm === nn);
    if (porNombre) return { modo: 'revisar_nombre', terceroIdSugerido: porNombre.id, nombreOriginal: nombre };
  }
  return { modo: 'no_informado', nombreOriginal: nombre };
}

module.exports = {
  normalizarIdentificacion, esNombreValido, proponerTipoIdentificacion,
  clasificarTipoGasto, resolverTercero, normalizarNombre,
};
