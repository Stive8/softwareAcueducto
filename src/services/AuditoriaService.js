const AuditoriaRepository = require('../repositories/AuditoriaRepository');

class AuditoriaService {
  constructor(dbService) {
    this.repository = new AuditoriaRepository(dbService);
  }

  registrar(datos) {
    this.repository.registrar(datos);
  }

  getAll(params) {
    return this.repository.findAll(params);
  }
}

module.exports = AuditoriaService;
