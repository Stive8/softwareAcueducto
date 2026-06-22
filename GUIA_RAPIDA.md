# GUÍA RÁPIDA - Sistema Acueducto Veredal

## ⚡ Comandos para Ejecutar

### 1. Instalar Dependencias
```bash
cd c:\Users\Brayhan\Documents\softwareAcueducto
npm install
```

Esto instalará:
- electron v28.0.0
- better-sqlite3 v9.2.2
- chart.js v4.4.1

### 2. Ejecutar la Aplicación

**Modo Normal:**
```bash
npm start
```

**Modo Desarrollo (con DevTools):**
```bash
npm run dev
```

## 📂 Estructura Completa

```
softwareAcueducto/
├── main.js                          # ✅ Proceso principal Electron
├── preload.js                       # ✅ Bridge IPC seguro
├── package.json                     # ✅ Dependencias
├── .gitignore                       # ✅ Archivos ignorados
├── README.md                        # ✅ Documentación completa
├── data/                            # 📁 Creada automáticamente
│   └── acueducto.db                 # 🗄️ Base de datos SQLite
├── assets/                          # 🎨 Recursos
│   └── README.md                    # Instrucciones para ícono
└── src/
    ├── database/
    │   ├── DatabaseService.js       # ✅ Servicio BD + migraciones
    │   └── migrations/
    │       └── 001_create_initial_tables.sql  # ✅ Migración inicial
    ├── repositories/                # 📊 Acceso a datos
    │   ├── CuentaRepository.js      # ✅ CRUD cuentas
    │   └── DashboardRepository.js   # ✅ Estadísticas
    ├── services/                    # 🎯 Lógica de negocio
    │   ├── CuentaService.js         # ✅ Validaciones cuentas
    │   └── DashboardService.js      # ✅ Lógica dashboard
    └── renderer/                    # 🎨 Frontend
        ├── index.html               # ✅ HTML principal
        ├── css/
        │   └── styles.css           # ✅ Estilos completos
        ├── js/
        │   ├── app.js               # ✅ Navegación y modal
        │   ├── dashboard.js         # ✅ Dashboard con Chart.js
        │   └── cuentas.js           # ✅ CRUD completo + paginación
        └── pages/                   # 📁 Para vistas futuras
```

## 🚀 Primera Ejecución

Al ejecutar por primera vez, el sistema automáticamente:

1. ✅ Crea la carpeta `data/`
2. ✅ Genera la base de datos `acueducto.db`
3. ✅ Ejecuta la migración inicial
4. ✅ Crea todas las tablas (Fase 1 + preparadas para fases siguientes)
5. ✅ Inserta datos iniciales:
   - 3 categorías: Residencial, Comercial, Institucional
   - Configuración inicial: saldos en 0, nombre del acueducto

## 📊 Funcionalidades Disponibles

### Dashboard (Página Inicial)
- 📈 Total cuentas activas, inactivas y suspendidas
- 💚 Cuentas al día vs en mora
- 💰 Ingresos del mes actual
- 💸 Gastos del mes actual
- 💵 Saldo en caja
- 🏦 Saldo en banco
- 📊 Gráfico ingresos vs gastos (últimos 6 meses)

### Módulo Cuentas
- 📋 Lista con paginación (10 por página)
- 🔍 Búsqueda por código o dirección
- 🎯 Filtros: estado y categoría
- ➕ Crear nueva cuenta
- ✏️ Editar cuenta existente
- 👁️ Ver detalle completo
- ⚠️ Suspender/Activar cuenta
- 🚫 NO se pueden eliminar cuentas (solo cambiar estado)

### Validaciones Implementadas
- ✅ Código obligatorio y único
- ✅ Dirección obligatoria
- ✅ No permite códigos duplicados
- ✅ Estados válidos: Activo, Inactivo, Suspendido
- ✅ Categorías: Residencial, Comercial, Institucional

## 🎨 Diseño

- **Colores**: Azul (#1e40af, #1e3a8a), blanco, grises
- **Menú lateral** con íconos y navegación clara
- **Diseño moderno** y limpio
- **Interfaz intuitiva** para usuarios básicos

## 🔮 Preparado para Fase 2 y siguientes

Tablas ya creadas en base de datos:
- ✅ propietarios
- ✅ cuenta_propietarios (historial)
- ✅ categorias
- ✅ cuenta_categorias (historial)
- ✅ tarifas (con historial)
- ✅ pagos
- ✅ gastos
- ✅ movimientos (caja/banco)
- ✅ configuracion

## 🛠️ Comandos Adicionales

### Ver la base de datos
```bash
# Instalar sqlite3 CLI globalmente (opcional)
npm install -g sqlite3

# Abrir la base de datos
sqlite3 data/acueducto.db

# Ver tablas
.tables

# Ver estructura de una tabla
.schema cuentas

# Salir
.quit
```

### Backup de base de datos
```bash
# Copiar archivo de base de datos
copy data\acueducto.db data\backup_acueducto_%date%.db
```

## 📝 Notas Importantes

1. **Base de datos**: Se crea automáticamente en `data/acueducto.db`
2. **Migraciones**: Se ejecutan automáticamente al iniciar
3. **No usar localStorage**: Toda persistencia en SQLite
4. **Códigos manuales**: El usuario debe ingresar el código (nunca autogenerado)
5. **No eliminar**: Solo cambiar estado de las cuentas
6. **100% Offline**: No requiere conexión a internet

## ❗ Solución de Problemas

### Error al instalar better-sqlite3
Si hay problemas compilando better-sqlite3:
```bash
npm install --global windows-build-tools
npm install
```

### La aplicación no inicia
Verificar versión de Node.js:
```bash
node --version
```
Debe ser v18 o superior.

### La base de datos no se crea
Verificar permisos de escritura en la carpeta del proyecto.

## 📧 Soporte

Para agregar nuevas funcionalidades, seguir el patrón:
1. Crear migración SQL
2. Crear/actualizar repositorio
3. Crear/actualizar servicio
4. Agregar handlers IPC en main.js
5. Exponer API en preload.js
6. Crear vista en renderer

---

**¡Sistema listo para usar! Ejecutar `npm install` y luego `npm start`**
