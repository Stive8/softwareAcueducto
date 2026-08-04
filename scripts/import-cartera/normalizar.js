// Normalización de códigos de cuenta: quitar guiones y espacios, mayúsculas.
// Ver REGLAS_CARGA_INICIAL.md sección 10 -- verificado sin colisiones en los 5 archivos fuente.
function normalizarCodigo(codigo) {
  return String(codigo).toUpperCase().replace(/[-\s]/g, '');
}

module.exports = { normalizarCodigo };
