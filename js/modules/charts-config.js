/**
 * ARQUIVO: js/modules/charts-config.js
 * DESCRIÇÃO: Configurações visuais padronizadas para o Chart.js
 */

export const CHART_COLORS = {
    falta: '#ef4444',   // Red
    sobra: '#3b82f6',   // Blue
    avaria: '#f59e0b',  // Amber
    interna: '#a855f7', // Purple
    bars: '#6366f1',    // Indigo
    causador: '#f43f5e',// Rose
    identif: '#10b981', // Emerald
    text: '#cbd5e1',    // Slate 300
    grid: '#334155'     // Slate 700
};

export const COMMON_OPTIONS = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { 
        legend: { display: false } 
    },
    scales: {
        x: { 
            grid: { color: CHART_COLORS.grid }, 
            ticks: { color: CHART_COLORS.text } 
        },
        y: { 
            grid: { display: false }, // Limpa visualmente
            ticks: { color: '#fff', font: { weight: 'bold' } } 
        }
    }
};

export const DOUGHNUT_OPTIONS = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { 
        legend: { 
            position: 'right', 
            labels: { color: '#fff', font: { size: 12 }, padding: 15 } 
        } 
    }
};