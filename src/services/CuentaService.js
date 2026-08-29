const CuentaRepository = require('../repositories/CuentaRepository');
const DashboardRepository = require('../repositories/DashboardRepository');

// Rango aproximado de Colombia: existe solo para atrapar el error de digitación más común
// (invertir latitud y longitud al copiar desde un mapa), no para validar un polígono exacto.
const COLOMBIA_LAT_MIN = -4.3;
const COLOMBIA_LAT_MAX = 13.5;
const COLOMBIA_LON_MIN = -82;
const COLOMBIA_LON_MAX = -66;

const PARES_COORDENADAS = [
  { lat: 'lat_acometida', lon: 'lon_acometida', etiqueta: 'la acometida' },
  { lat: 'lat_vivienda', lon: 'lon_vivienda', etiqueta: 'la vivienda' }
];

function estaInformado(valor) {
  return valor !== null && valor !== undefined && valor !== '';
}

// Cada pareja (acometida, vivienda) es independiente: o vienen ambas coordenadas completas y
// válidas, o no viene ninguna. Nunca se permite guardar media coordenada.
function validarCoordenadas(cuentaData) {
  for (const { lat, lon, etiqueta } of PARES_COORDENADAS) {
    const tieneLat = estaInformado(cuentaData[lat]);
    const tieneLon = estaInformado(cuentaData[lon]);

    if (!tieneLat && !tieneLon) continue;

    if (tieneLat !== tieneLon) {
      throw new Error(`Debe indicar tanto la latitud como la longitud de ${etiqueta}, o dejar ambas en blanco`);
    }

    const latNum = Number(cuentaData[lat]);
    const lonNum = Number(cuentaData[lon]);

    if (Number.isNaN(latNum) || Number.isNaN(lonNum)) {
      throw new Error(`Las coordenadas de ${etiqueta} deben ser números`);
    }

    if (latNum < -90 || latNum > 90 || lonNum < -180 || lonNum > 180) {
      throw new Error(`Las coordenadas de ${etiqueta} están fuera del rango válido de latitud/longitud`);
    }

    if (latNum < COLOMBIA_LAT_MIN || latNum > COLOMBIA_LAT_MAX || lonNum < COLOMBIA_LON_MIN || lonNum > COLOMBIA_LON_MAX) {
      throw new Error(`Las coordenadas de ${etiqueta} parecen estar fuera de Colombia; verifique que la latitud y la longitud no estén invertidas`);
    }
  }
}

class CuentaService {
  constructor(dbService) {
    this.repository = new CuentaRepository(dbService);
    this.dashboardRepo = new DashboardRepository(dbService);
  }

  getAll(params) {
    return this.repository.findAll(params);
  }

  // Métricas rápidas para la fila de stat-cards del listado de Cuentas: reutiliza el mismo
  // criterio de mora que ya usa el Dashboard (DashboardRepository.getCuentasEnMoraIds).
  getStats() {
    const stats = this.repository.getStats();
    return { ...stats, enMora: this.dashboardRepo.getCuentasEnMoraIds().length };
  }

  getById(id) {
    return this.repository.findById(id);
  }

  getCategorias() {
    return this.repository.getCategorias();
  }

  create(cuentaData) {
    if (!cuentaData.codigo || !cuentaData.codigo.trim()) {
      throw new Error('El código de cuenta es obligatorio');
    }

    if (!cuentaData.direccion || !cuentaData.direccion.trim()) {
      throw new Error('La dirección es obligatoria');
    }

    if (!cuentaData.categoria_id) {
      throw new Error('La categoría es obligatoria');
    }

    const existente = this.repository.findByCodigo(cuentaData.codigo);
    if (existente) {
      throw new Error('Ya existe una cuenta con ese código');
    }

    validarCoordenadas(cuentaData);

    return this.repository.create(cuentaData);
  }

  update(id, cuentaData) {
    if (!cuentaData.codigo || !cuentaData.codigo.trim()) {
      throw new Error('El código de cuenta es obligatorio');
    }

    if (!cuentaData.direccion || !cuentaData.direccion.trim()) {
      throw new Error('La dirección es obligatoria');
    }

    const cuenta = this.repository.findById(id);
    if (!cuenta) {
      throw new Error('Cuenta no encontrada');
    }

    if (cuenta.codigo !== cuentaData.codigo) {
      const existente = this.repository.findByCodigo(cuentaData.codigo);
      if (existente) {
        throw new Error('Ya existe otra cuenta con ese código');
      }
    }

    validarCoordenadas(cuentaData);

    this.repository.update(id, cuentaData);
  }
}

module.exports = CuentaService;
