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
      
      <div class="stats-grid" id="stats-grid">
        <div class="stat-card">
          <div class="stat-card-header">
            <span class="stat-card-title">Cargando...</span>
            <span class="stat-card-icon">⏳</span>
          </div>
          <div class="stat-card-value">-</div>
        </div>
      </div>

      <div class="chart-card">
        <h3>Ingresos vs Gastos (Últimos 6 meses)</h3>
        <canvas id="ingresosGastosChart"></canvas>
      </div>
    `;

    await this.loadStats();
    await this.loadChart();
  },

  async loadStats() {
    try {
      const response = await window.api.dashboard.getStats();
      
      if (response.success) {
        this.renderStats(response.data);
      } else {
        console.error('Error al cargar estadísticas:', response.error);
      }
    } catch (error) {
      console.error('Error:', error);
    }
  },

  renderStats(stats) {
    const statsGrid = document.getElementById('stats-grid');
    statsGrid.innerHTML = `
      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-title">Total Cuentas</span>
          <span class="stat-card-icon">📋</span>
        </div>
        <div class="stat-card-value">${stats.totalCuentas}</div>
        <div class="stat-card-footer">${stats.cuentasActivas} activas / ${stats.cuentasInactivas} inactivas</div>
      </div>

      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-title">Cuentas Suspendidas</span>
          <span class="stat-card-icon">⚠️</span>
        </div>
        <div class="stat-card-value">${stats.cuentasSuspendidas}</div>
        <div class="stat-card-footer">Requieren atención</div>
      </div>

      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-title">Cuentas al Día</span>
          <span class="stat-card-icon">💚</span>
        </div>
        <div class="stat-card-value">${stats.cuentasAlDia}</div>
        <div class="stat-card-footer">Han pagado recientemente</div>
      </div>

      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-title">Cuentas en Mora</span>
          <span class="stat-card-icon">🔴</span>
        </div>
        <div class="stat-card-value">${stats.cuentasEnMora}</div>
        <div class="stat-card-footer">Sin pagos recientes</div>
      </div>

      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-title">Saldo a Favor</span>
          <span class="stat-card-icon">⭐</span>
        </div>
        <div class="stat-card-value">${stats.cuentasConSaldoAFavor}</div>
        <div class="stat-card-footer">Pagos adelantados</div>
      </div>

      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-title">Ingresos Mes</span>
          <span class="stat-card-icon">📈</span>
        </div>
        <div class="stat-card-value">$${this.formatNumber(stats.ingresosMes)}</div>
        <div class="stat-card-footer">Mes actual</div>
      </div>

      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-title">Gastos Mes</span>
          <span class="stat-card-icon">📉</span>
        </div>
        <div class="stat-card-value">$${this.formatNumber(stats.gastosMes)}</div>
        <div class="stat-card-footer">Mes actual</div>
      </div>

      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-title">Saldo Caja</span>
          <span class="stat-card-icon">💵</span>
        </div>
        <div class="stat-card-value">$${this.formatNumber(stats.saldoCaja)}</div>
        <div class="stat-card-footer">Efectivo disponible</div>
      </div>

      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-title">Saldo Banco</span>
          <span class="stat-card-icon">🏦</span>
        </div>
        <div class="stat-card-value">$${this.formatNumber(stats.saldoBanco)}</div>
        <div class="stat-card-footer">Cuenta bancaria</div>
      </div>
    `;
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

  formatNumber(num) {
    return num.toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }
};
