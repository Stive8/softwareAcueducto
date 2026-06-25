// Dashboard
const Dashboard = {
  chartInstance: null,

  async load() {
    const content = document.getElementById('page-content');
    content.innerHTML = `
      <div class="page-header">
        <h1>Dashboard</h1>
        <p>Resumen general del sistema</p>
      </div>

      <div id="alertasContainer"></div>

      <h3 class="stats-section-title">Estado financiero</h3>
      <div class="stats-grid" id="stats-grid-financiero"></div>

      <h3 class="stats-section-title">Estado operativo</h3>
      <div class="stats-grid" id="stats-grid-operativo"></div>

      <div class="chart-card">
        <h3>Ingresos vs Gastos (Últimos 6 meses)</h3>
        <canvas id="ingresosGastosChart"></canvas>
      </div>

      <h3 class="stats-section-title">Actividad reciente</h3>
      <div class="actividad-grid" id="actividad-grid"></div>
    `;

    await this.loadStats();
    await this.loadChart();
    await this.loadActividadReciente();
  },

  async loadStats() {
    try {
      const response = await window.api.dashboard.getStats();

      if (response.success) {
        this.renderAlertas(response.data);
        this.renderStats(response.data);
      } else {
        console.error('Error al cargar estadísticas:', response.error);
      }
    } catch (error) {
      console.error('Error:', error);
    }
  },

  renderAlertas(stats) {
    const container = document.getElementById('alertasContainer');
    const alertas = [];

    const sinTarifa = stats.categoriasSinTarifa || [];
    if (sinTarifa.length > 0) {
      alertas.push(`
        <strong>⚠️ Categorías sin tarifa configurada:</strong>
        ${sinTarifa.map(c => c.nombre).join(', ')}.
        No se podrán registrar pagos de sostenimiento para cuentas de estas categorías hasta que les asigne una tarifa
        (Categorías → Ver Historial de Tarifas → Nueva Tarifa).
      `);
    }

    // Umbral de 15 días: con un uso semanal típico, esto da margen de sobra antes de avisar,
    // pero sigue detectando a tiempo una cuenta de Google desconectada o sin internet por mucho tiempo.
    const UMBRAL_DIAS_RESPALDO = 15;
    const respaldoNube = stats.respaldoNube || {};
    if (respaldoNube.conectado && (respaldoNube.diasSinRespaldar === null || respaldoNube.diasSinRespaldar >= UMBRAL_DIAS_RESPALDO)) {
      const detalle = respaldoNube.diasSinRespaldar === null
        ? 'todavía no se ha subido ningún respaldo a la nube'
        : `lleva ${respaldoNube.diasSinRespaldar} días sin subir un respaldo a la nube`;
      alertas.push(`
        <strong>☁️ Respaldo en la nube desactualizado:</strong>
        este equipo está conectado a Google Drive, pero ${detalle}.
        Revise su conexión a internet o la cuenta conectada (Configuración → Respaldo en la Nube).
      `);
    }

    if (alertas.length === 0) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = alertas.map(texto => `
      <div style="padding: 14px 18px; background: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 6px; margin-bottom: 12px;">
        <p style="margin: 0; font-size: 0.9rem; color: #92400e;">${texto}</p>
      </div>
    `).join('');
  },

  renderStats(stats) {
    document.getElementById('stats-grid-financiero').innerHTML = App.renderStatsGrid([
      { titulo: 'Saldo Caja', valor: `$${this.formatNumber(stats.saldoCaja)}`, footer: 'Efectivo disponible', icono: 'wallet' },
      { titulo: 'Saldo Banco', valor: `$${this.formatNumber(stats.saldoBanco)}`, footer: 'Cuenta bancaria', icono: 'landmark' },
      { titulo: 'Cartera Pendiente', valor: `$${this.formatNumber(stats.carteraPendiente)}`, footer: `${stats.cuentasEnMora} cuentas en mora`, icono: 'trendingDown' },
      { titulo: 'Ingresos del Mes', valor: `$${this.formatNumber(stats.ingresosMes)}`, footer: 'Mes actual', icono: 'barChart' }
    ]);

    document.getElementById('stats-grid-operativo').innerHTML = App.renderStatsGrid([
      { titulo: 'Cuentas Activas', valor: stats.cuentasActivas, footer: `${stats.totalCuentas} en total`, icono: 'home' },
      { titulo: 'Cuentas Suspendidas', valor: stats.cuentasSuspendidas, footer: 'Requieren atención', icono: 'tag' },
      { titulo: 'Pagos Vencidos', valor: stats.cuentasEnMora, footer: 'Cuentas en mora', icono: 'fileText' },
      { titulo: 'Saldo a Favor', valor: stats.cuentasConSaldoAFavor, footer: 'Cuentas con pagos adelantados', icono: 'users' }
    ]);
  },

  async loadChart() {
    try {
      const response = await window.api.dashboard.getChartData();

      if (response.success) {
        this.renderChart(response.data);
      } else {
        console.error('Error al cargar datos del gráfico:', response.error);
      }
    } catch (error) {
      console.error('Error:', error);
    }
  },

  renderChart(data) {
    const ctx = document.getElementById('ingresosGastosChart');

    if (this.chartInstance) {
      this.chartInstance.destroy();
    }

    this.chartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: data.meses,
        datasets: [
          {
            label: 'Ingresos',
            data: data.ingresos,
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            tension: 0.4,
            fill: true
          },
          {
            label: 'Gastos',
            data: data.gastos,
            borderColor: '#ef4444',
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            tension: 0.4,
            fill: true
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: {
            position: 'top',
          },
          tooltip: {
            callbacks: {
              label: function(context) {
                let label = context.dataset.label || '';
                if (label) {
                  label += ': ';
                }
                label += '$' + context.parsed.y.toLocaleString('es-CO');
                return label;
              }
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              callback: function(value) {
                return '$' + value.toLocaleString('es-CO');
              }
            }
          }
        }
      }
    });
  },

  async loadActividadReciente() {
    const grid = document.getElementById('actividad-grid');
    try {
      const response = await window.api.dashboard.getActividadReciente();
      if (!response.success) {
        console.error('Error al cargar actividad reciente:', response.error);
        return;
      }
      grid.innerHTML = this.renderActividadReciente(response.data);
    } catch (error) {
      console.error('Error:', error);
    }
  },

  renderActividadReciente(data) {
    const lista = (items, vacioTexto, renderItem) => items.length === 0
      ? `<p class="actividad-vacio">${vacioTexto}</p>`
      : `<ul class="actividad-lista">${items.map(renderItem).join('')}</ul>`;

    const ultimosPagos = lista(data.ultimosPagos, 'Sin pagos registrados todavía', p => `
      <li>
        <span>Recibo #${p.numero_recibo} · ${p.cuenta_codigo} - ${p.propietario_nombre}</span>
        <span class="actividad-valor">$${this.formatNumber(p.total)}</span>
      </li>
    `);

    const ultimosGastos = lista(data.ultimosGastos, 'Sin gastos registrados todavía', g => `
      <li>
        <span>${g.concepto} · ${g.proveedor || 'Sin proveedor'}</span>
        <span class="actividad-valor">$${this.formatNumber(g.valor)}</span>
      </li>
    `);

    const ultimosMovimientos = lista(data.ultimosMovimientosCaja, 'Sin movimientos registrados todavía', m => `
      <li>
        <span>${m.tipo} · ${m.concepto || (m.destino ? `${m.origen} → ${m.destino}` : m.origen)}</span>
        <span class="actividad-valor">$${this.formatNumber(m.monto)}</span>
      </li>
    `);

    return `
      <div class="actividad-card">
        <h4>Últimos pagos</h4>
        ${ultimosPagos}
      </div>
      <div class="actividad-card">
        <h4>Últimos gastos</h4>
        ${ultimosGastos}
      </div>
      <div class="actividad-card">
        <h4>Últimos movimientos de caja</h4>
        ${ultimosMovimientos}
      </div>
    `;
  },

  formatNumber(num) {
    return Number(num || 0).toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }
};
