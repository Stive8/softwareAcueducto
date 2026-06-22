# Sistema Administrativo - Acueducto Veredal

Sistema de escritorio 100% offline para la administración de acueductos veredales en Colombia.

## Stack Tecnológico

- **Electron**: Framework para aplicaciones de escritorio
- **SQLite**: Base de datos local con better-sqlite3
- **JavaScript Vanilla**: Frontend sin frameworks adicionales
- **Chart.js**: Visualización de datos
- **HTML/CSS**: Interfaz de usuario moderna

## Estructura del Proyecto

```
softwareAcueducto/
├── main.js                          # Proceso principal de Electron
├── preload.js                       # Bridge seguro entre main y renderer
├── package.json                     # Dependencias y scripts
├── data/                            # Base de datos SQLite (generada automáticamente)
│   └── acueducto.db
├── src/
│   ├── database/
│   │   ├── DatabaseService.js       # Servicio de base de datos
│   │   └── migrations/              # Migraciones SQL
│   │       └── 001_create_initial_tables.sql
│   ├── repositories/                # Capa de acceso a datos
│   │   ├── CuentaRepository.js
│   │   └── DashboardRepository.js
│   ├── services/                    # Lógica de negocio
│   │   ├── CuentaService.js
│   │   └── DashboardService.js
│   └── renderer/                    # Frontend
│       ├── index.html
│       ├── css/
│       │   └── styles.css
│       └── js/
│           ├── app.js               # Aplicación principal
│           ├── dashboard.js         # Módulo Dashboard
│           └── cuentas.js           # Módulo Cuentas
└── assets/                          # Recursos estáticos
```

## Arquitectura

### Capas de la Aplicación

1. **Capa de Presentación (Renderer)**
   - HTML/CSS/JS vanilla
   - Comunicación con backend vía IPC (Electron)

2. **Capa de Servicios**
   - Lógica de negocio
   - Validaciones
   - Orquestación de repositorios

3. **Capa de Repositorios**
   - Acceso directo a base de datos
   - Queries SQL
   - CRUD operations

4. **Capa de Persistencia**
   - SQLite con better-sqlite3
   - Sistema de migraciones
   - Integridad referencial

### Sistema de Migraciones

Las migraciones SQL se ejecutan automáticamente al iniciar la aplicación:
- Se crean en orden numérico: `001_nombre.sql`, `002_nombre.sql`, etc.
- Se registran en tabla `migrations` para evitar re-ejecución
- Permiten evolucionar el esquema sin perder datos

## Funcionalidades Implementadas (Fase 1)

### Dashboard
- Total de cuentas por estado (Activo/Inactivo/Suspendido)
- Cuentas al día vs en mora
- Ingresos del mes actual
- Gastos del mes actual
- Saldo en caja
- Saldo en banco
- Gráfico de ingresos vs gastos (últimos 6 meses)

### Módulo de Cuentas/Predios
- Listado con paginación
- Búsqueda por código o dirección
- Filtros por estado y categoría
- Crear cuenta con código manual (obligatorio)
- Editar cuenta existente
- Cambiar estado (nunca eliminar)
- Ver detalle completo de cuenta
- Campos: código, dirección, categoría, estado, observaciones, fechas

## Preparado para Fases Siguientes

El sistema está arquitectónicamente preparado para:

- **Propietarios**: Gestión de personas asociadas a cuentas
- **Historial de propietarios**: Trazabilidad de cambios de dueño
- **Categorías personalizadas**: Gestión de tipos de cuenta
- **Historial de categorías**: Cambios de categoría por cuenta
- **Tarifas**: Configuración de precios por categoría
- **Historial de tarifas**: Control de cambios de precios
- **Pagos**: Registro de pagos de usuarios
- **Recibos**: Generación de comprobantes
- **Gastos**: Control de egresos del acueducto
- **Caja y Banco**: Movimientos financieros
- **Configuración**: Parámetros del sistema
- **Seguridad**: Autenticación y permisos

Las tablas ya están creadas en la base de datos.

## Instalación y Ejecución

### Requisitos Previos
- Node.js 18 o superior
- Windows 10/11

### Comandos de Instalación

```bash
# 1. Instalar dependencias
npm install

# 2. Ejecutar aplicación en modo desarrollo
npm start

# 3. Ejecutar con DevTools abierto
npm run dev
```

### Primera Ejecución

Al ejecutar por primera vez:
1. Se crea automáticamente la carpeta `data/`
2. Se genera la base de datos `acueducto.db`
3. Se ejecutan todas las migraciones SQL
4. Se insertan datos iniciales (categorías, configuración)

## Base de Datos

### Tablas Principales (Fase 1)

- **cuentas**: Predios/cuentas del acueducto
- **categorias**: Tipos de cuenta (Residencial, Comercial, Institucional)
- **configuracion**: Parámetros del sistema

### Tablas Preparadas (Fases futuras)

- **propietarios**: Personas asociadas a cuentas
- **cuenta_propietarios**: Historial de propietarios por cuenta
- **cuenta_categorias**: Historial de categorías por cuenta
- **tarifas**: Precios por categoría
- **pagos**: Registros de pago
- **gastos**: Egresos del acueducto
- **movimientos**: Flujo de caja y banco

## Diseño de Interfaz

- **Colores**: Azul (#1e40af), blanco, grises
- **Menú lateral izquierdo** con íconos
- **Diseño limpio y moderno**
- **Fácil de usar** para usuarios con conocimientos básicos
- **Totalmente responsive**

## Buenas Prácticas Implementadas

- Separación de responsabilidades (repositorios, servicios, vistas)
- Context isolation en Electron (seguridad)
- Sistema de migraciones SQL versionado
- Validaciones en capa de servicio
- No se eliminan registros, solo se cambia estado
- Códigos manuales (no autogenerados)
- Persistencia 100% en SQLite (no localStorage)

## Desarrollo Futuro

Para agregar nuevas funcionalidades:

1. **Crear migración SQL** en `src/database/migrations/`
2. **Agregar repositorio** en `src/repositories/`
3. **Crear servicio** en `src/services/`
4. **Exponer IPC handlers** en `main.js`
5. **Agregar APIs** en `preload.js`
6. **Crear vista** en `src/renderer/js/`

## Licencia

Propietario
