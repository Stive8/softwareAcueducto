-- 022_cuentas_automaticas.sql
-- Tabla de configuración de las cuentas contables que el sistema usa automáticamente.
-- Reemplaza las referencias codificadas en el código fuente (startsWith '1105', '1110', etc.)
-- por entradas administrables desde la pantalla de Configuración Contable.
--
-- CAJA y BANCO apuntan al nodo "padre" de nivel 3 (1105 / 1110) y no a sus subcuentas,
-- porque la detección por prefijo de código cubre automáticamente todos los auxiliares
-- que se creen bajo ese nodo (ej. 1105001, 111005, 111010…).

CREATE TABLE cuentas_automaticas (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  clave               TEXT    NOT NULL UNIQUE,
  nombre              TEXT    NOT NULL,
  descripcion         TEXT,
  -- Solo el administrador puede cambiar esta cuenta desde la UI.
  cuenta_contable_id  INTEGER NOT NULL REFERENCES plan_cuentas(id),
  -- 0 = la clave es requerida por el sistema y no puede quedar sin cuenta asignada.
  configurable        INTEGER NOT NULL DEFAULT 1,
  fecha_actualizacion DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Semilla con los valores que antes estaban codificados en AsientoContableService.js
INSERT INTO cuentas_automaticas (clave, nombre, descripcion, cuenta_contable_id, configurable) VALUES
  ('CAJA',
   'Caja',
   'Cuenta de Caja para registrar movimientos en efectivo. El sistema busca por prefijo de código, de modo que todas sus subcuentas también se consideran Caja.',
   (SELECT id FROM plan_cuentas WHERE codigo = '1105'),
   1),

  ('BANCO',
   'Banco',
   'Cuenta Bancaria para registrar movimientos por transferencia. El sistema busca por prefijo de código, cubriendo todas las cuentas bancarias registradas.',
   (SELECT id FROM plan_cuentas WHERE codigo = '1110'),
   1),

  ('CARTERA_USUARIOS',
   'Cartera de Usuarios',
   'Cuenta de activo donde se registran los créditos y débitos de saldo a favor de propietarios (AplicacionSaldoFavor / AbonoSaldoFavor). Corresponde a Clientes - Cartera de Usuarios.',
   (SELECT id FROM plan_cuentas WHERE codigo = '1305'),
   1);
