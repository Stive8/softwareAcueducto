// Sesión activa del único usuario que puede estar usando esta app de escritorio a la vez.
// Vive en su propio módulo (en vez de una variable de main.js) porque envolverHandle.js y
// casi todos los archivos de src/ipc/*Handlers.js necesitan leer o mutar el mismo estado.
let sesionActual = null;

function getSesionActual() {
  return sesionActual;
}

function setSesionActual(sesion) {
  sesionActual = sesion;
}

function limpiarSesionActual() {
  sesionActual = null;
}

module.exports = { getSesionActual, setSesionActual, limpiarSesionActual };
